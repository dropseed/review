//! Git commit with streaming output — callback-based for flexibility.

use anyhow::Context;
use log::{debug, info};
use std::io::BufRead;
use std::path::Path;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use crate::sources::local_git::LocalGitSource;

use super::{CommitOutputLine, CommitResult, CommitStream};

/// Spawn a thread that reads lines from a pipe and calls `on_line` for each.
fn spawn_stream_reader(
    pipe: Option<impl std::io::Read + Send + 'static>,
    stream: CommitStream,
    on_line: Arc<dyn Fn(CommitOutputLine) + Send + Sync>,
    seq: Arc<AtomicU64>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let Some(pipe) = pipe else { return };
        let reader = std::io::BufReader::new(pipe);
        for line in reader.lines().flatten() {
            let s = seq.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            on_line(CommitOutputLine {
                text: line,
                stream,
                seq: s,
            });
        }
    })
}

/// Run `git commit` with streaming stdout/stderr output via a callback.
///
/// The `on_line` callback is called from background threads as each line
/// of output is produced. It must be `Send + Sync + 'static`.
pub fn git_commit_streaming(
    repo_path: &Path,
    message: &str,
    on_line: impl Fn(CommitOutputLine) + Send + Sync + 'static,
) -> anyhow::Result<CommitResult> {
    debug!("[git_commit] repo_path={}", repo_path.display());

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
    let mut child = source
        .spawn_commit(message)
        .context("Failed to spawn git commit")?;

    let seq = Arc::new(AtomicU64::new(0));
    let on_line = Arc::new(on_line);

    let stdout_thread = spawn_stream_reader(
        child.stdout.take(),
        CommitStream::Stdout,
        on_line.clone(),
        seq.clone(),
    );
    let stderr_thread =
        spawn_stream_reader(child.stderr.take(), CommitStream::Stderr, on_line, seq);

    let status = child.wait().context("Failed to wait for git commit")?;

    let _ = stdout_thread.join();
    let _ = stderr_thread.join();

    if status.success() {
        let commit_hash = source.get_head_short_hash().ok();
        info!("[git_commit] SUCCESS");
        Ok(CommitResult {
            success: true,
            commit_hash,
            summary: "Commit created successfully".to_owned(),
        })
    } else {
        let code = status.code().unwrap_or(-1);
        info!("[git_commit] FAILED: exit code {code}");
        Ok(CommitResult {
            success: false,
            commit_hash: None,
            summary: format!("git commit exited with code {code}"),
        })
    }
}
