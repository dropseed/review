//! Shared test harness: a real daemon served on a temp socket.
//!
//! Used by every test in this crate that exercises the daemon wire end-to-end
//! (`server.rs`, `cli/terminal.rs`), so daemon startup/teardown details live
//! in one place.

use std::path::{Path, PathBuf};
use std::time::Duration;

use tokio::task::JoinHandle;

use super::{serve, DaemonClient, Op};

/// Anything slower than this in a local round trip is a hang, not slowness.
pub(crate) const TIMEOUT: Duration = Duration::from_secs(10);

/// A daemon serving on a socket inside a temp dir, torn down on drop.
pub(crate) struct Harness {
    pub(crate) socket: PathBuf,
    pub(crate) dir: tempfile::TempDir,
    pub(crate) task: JoinHandle<()>,
}

impl Harness {
    pub(crate) async fn start() -> Self {
        let dir = tempfile::TempDir::new().unwrap();
        let socket = dir.path().join("daemon.sock");
        let task = tokio::spawn({
            let socket = socket.clone();
            async move {
                serve(socket).await.unwrap();
            }
        });
        // Wait for the listener to exist before connecting.
        let deadline = tokio::time::Instant::now() + TIMEOUT;
        while !socket.exists() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
        Self { socket, dir, task }
    }

    pub(crate) async fn client(&self) -> DaemonClient {
        DaemonClient::connect(&self.socket).await.unwrap()
    }
}

impl Drop for Harness {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// An `Op::Start` for a `/bin/sh` session in a temp-dir "repo".
pub(crate) fn start_op(id: &str, repo: &Path) -> Op {
    let path = repo.to_string_lossy().into_owned();
    Op::Start {
        terminal_id: id.to_owned(),
        repo_path: path.clone(),
        cwd: path,
        cols: 80,
        rows: 24,
        shell: Some("/bin/sh".into()),
        workspace_id: None,
    }
}
