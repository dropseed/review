//! A single PTY-backed terminal session: spawn, stream, and tear down.
//!
//! Threading model: one dedicated **reader thread** per session does blocking
//! reads on the PTY master. For each chunk it runs, in order: append to the
//! scrollback ring, call each registered [`OutputSink`] (synchronously, in
//! order), then fan the chunk out to subscribers.
//! On EOF it reaps the child's exit code, finalizes status, notifies sinks, and
//! emits a final [`TerminalMessage::Exit`]. All other methods
//! (`write`/`resize`/`kill`) are called from arbitrary threads and coordinate
//! through mutexes.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use anyhow::{anyhow, Context, Result};
use bytes::Bytes;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tokio::sync::mpsc::error::TrySendError;
use tokio::sync::mpsc::Sender;

use super::ring::Ring;
use super::status::StatusScanner;
use super::vt::{self, VtThread};
use super::{
    now_millis, shell_integration, Phase, SessionSpec, SessionStatus, TerminalId, TerminalMessage,
    TerminalSummary,
};

const READ_BUFFER_SIZE: usize = 8 * 1024;

/// A hook that observes raw PTY output on the reader thread.
///
/// Sinks run **on the PTY reader thread, in registration order, synchronously
/// before subscriber fan-out** for each chunk — so a slow sink stalls the whole
/// session. Keep `on_output` cheap (forward to a channel; never block). The only
/// sink today is the VT-thread forwarder installed by [`Session::spawn`].
pub(crate) trait OutputSink: Send {
    /// Called for each chunk of raw bytes read from the PTY, in order.
    fn on_output(&mut self, chunk: &[u8]);
    /// Called once after the PTY reaches EOF (child exited or was killed).
    fn on_exit(&mut self) {}
}

/// State shared between the session handle, its reader thread, and the poller.
struct Shared {
    id: TerminalId,
    ring: Ring,
    subscribers: Mutex<Vec<Sender<TerminalMessage>>>,
    /// The last published wire status (read by `status`/`summary`).
    status: Mutex<SessionStatus>,
    /// The status engine: OSC/bell scanner + phase state machine.
    scanner: Mutex<StatusScanner>,
    exited: AtomicBool,
    exit_code: Mutex<Option<i32>>,
    /// Owned child handle, used by the reader thread to reap the exit code.
    child: Mutex<Box<dyn Child + Send + Sync>>,
}

impl Shared {
    /// Rebuild the status from the scanner and, if anything changed, publish it:
    /// store it as the current status and fan a [`TerminalMessage::Status`] out
    /// to subscribers. Called from the reader thread, the poller, and `write`.
    ///
    /// Status building is quick and non-blocking — it holds only the scanner
    /// lock. Content peek is pulled separately via [`Session::peek`], never here.
    fn publish_status(&self) {
        let status = self.scanner.lock().unwrap().build_status();
        *self.status.lock().unwrap() = status.clone();
        fanout(&self.subscribers, &TerminalMessage::Status(status));
    }
}

/// A live terminal session. Stored as `Arc<Session>` by the manager.
pub struct Session {
    shared: Arc<Shared>,
    repo_path: String,
    /// The workspace this session belongs to. Mutable — a session can be moved
    /// between workspaces (`Op::AssignWorkspace`) without being restarted.
    workspace_id: Mutex<Option<String>>,
    cwd: String,
    /// The shell's process id (== its process group, since it's a session
    /// leader). The poller compares this to the PTY foreground pgid.
    shell_pid: Option<i32>,
    size: Mutex<(u16, u16)>,
    /// Signals the child to terminate from any thread (independent of `wait`).
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    /// Writable side of the PTY master (stdin to the child).
    writer: Mutex<Box<dyn std::io::Write + Send>>,
    /// The PTY master; dropped on `kill` to help the reader unblock via EOF.
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    reader_handle: Mutex<Option<JoinHandle<()>>>,
    /// The per-session VT screen-state actor (content peek). Resizes are
    /// forwarded to it; `kill` shuts it down and joins it. `None` only after
    /// teardown has taken it.
    vt: Mutex<Option<VtThread>>,
}

impl Session {
    /// Spawn a shell in a fresh PTY and start streaming its output.
    ///
    /// The reader thread runs one internal [`OutputSink`] — the VT-thread
    /// forwarder that feeds the content-peek grid.
    pub fn spawn(spec: SessionSpec) -> Result<Self> {
        let SessionSpec {
            terminal_id: id,
            repo_path,
            workspace_id,
            cwd,
            shell,
            cols,
            rows,
            env,
        } = spec;
        let repo_path = repo_path.to_string_lossy().into_owned();

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .context("Failed to open pty")?;

        let shell = resolve_shell(shell);
        let mut cmd = CommandBuilder::new(&shell);
        cmd.cwd(&cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        // Programs branch on these to decide what the terminal can do — and
        // agents in particular check them before enabling richer input or
        // output. Without them Review is indistinguishable from a bare xterm.
        cmd.env("TERM_PROGRAM", "Review");
        cmd.env("TERM_PROGRAM_VERSION", env!("CARGO_PKG_VERSION"));
        // Enable OSC 133 shell integration for zsh (no-op for other shells).
        // Applied before the caller's env so an explicit override still wins.
        if let Some(injected) = shell_integration::injection_env(&shell) {
            for (key, value) in injected {
                cmd.env(key, value);
            }
        }
        for (key, value) in &env {
            cmd.env(key, value);
        }
        let cwd = cwd.to_string_lossy().into_owned();

        let child = pair
            .slave
            .spawn_command(cmd)
            .with_context(|| format!("Failed to spawn shell {}", shell.display()))?;

        // The child is a session leader (portable-pty calls setsid), so its pid
        // is its process group id — what the poller compares the foreground
        // group against.
        let shell_pid = child.process_id().and_then(|pid| i32::try_from(pid).ok());

        // Drop the slave handle so that once the child exits, all slave-side fds
        // are closed and the master read returns EOF.
        drop(pair.slave);

        let killer = child.clone_killer();
        let reader = pair
            .master
            .try_clone_reader()
            .context("Failed to clone pty reader")?;
        let writer = pair
            .master
            .take_writer()
            .context("Failed to take pty writer")?;

        let scanner = StatusScanner::new(id.clone(), Some(cwd.clone()));
        let status = scanner.current_status();

        // Spin up the per-session VT screen-state actor. Its engine is built on
        // the actor thread (some engines are !Send), fed via an output sink on
        // the reader thread, and read back on demand through the stored handle.
        let vt = VtThread::spawn(&id.0, vt::default_engine_factory(cols, rows));
        let sinks: Vec<Box<dyn OutputSink>> = vec![Box::new(vt.output_sink())];

        let shared = Arc::new(Shared {
            id: id.clone(),
            ring: Ring::new(),
            subscribers: Mutex::new(Vec::new()),
            status: Mutex::new(status),
            scanner: Mutex::new(scanner),
            exited: AtomicBool::new(false),
            exit_code: Mutex::new(None),
            child: Mutex::new(child),
        });

        let reader_handle = spawn_reader_thread(Arc::clone(&shared), reader, sinks);

        Ok(Self {
            shared,
            repo_path,
            workspace_id: Mutex::new(workspace_id),
            cwd,
            shell_pid,
            size: Mutex::new((cols, rows)),
            killer: Mutex::new(killer),
            writer: Mutex::new(writer),
            master: Mutex::new(Some(pair.master)),
            reader_handle: Mutex::new(Some(reader_handle)),
            vt: Mutex::new(Some(vt)),
        })
    }

    /// The repo this session belongs to (as a lossy path string).
    pub fn repo_path(&self) -> &str {
        &self.repo_path
    }

    /// Move this session to another workspace, or to none.
    pub fn assign_workspace(&self, workspace_id: Option<String>) {
        *self.workspace_id.lock().unwrap() = workspace_id;
    }

    /// Whether the child has exited (EOF reached).
    pub fn has_exited(&self) -> bool {
        self.shared.exited.load(Ordering::SeqCst)
    }

    /// A clone of the current status.
    pub fn status(&self) -> SessionStatus {
        self.shared.status.lock().unwrap().clone()
    }

    /// A summary of this session for `list`/`start` responses.
    pub fn summary(&self) -> TerminalSummary {
        let (cols, rows) = *self.size.lock().unwrap();
        let status = self.status();
        TerminalSummary {
            id: self.shared.id.clone(),
            repo_path: self.repo_path.clone(),
            workspace_id: self.workspace_id.lock().unwrap().clone(),
            cwd: self.cwd.clone(),
            title: status.title.clone(),
            cols,
            rows,
            status,
        }
    }

    /// The scrollback for a cold reattach, paired with the byte cursor it ends
    /// at (so the client can deduplicate live output against the replay), and
    /// trimmed so the replay can't start inside a half-dropped escape sequence.
    /// See [`Ring::snapshot_for_replay`].
    ///
    /// [`Ring::snapshot_for_replay`]: super::ring::Ring::snapshot_for_replay
    pub fn snapshot_for_replay(&self) -> (Vec<u8>, u64) {
        self.shared.ring.snapshot_for_replay()
    }

    /// Register a subscriber, returning its receiver. The caller pairs this with
    /// a scrollback snapshot to reconstruct the current screen.
    pub fn add_subscriber(&self, tx: Sender<TerminalMessage>) {
        self.shared.subscribers.lock().unwrap().push(tx);
    }

    /// Write bytes to the child's stdin. Errors if the session has exited.
    ///
    /// A user write clears any pending "needs attention" bell overlay.
    pub fn write(&self, data: &[u8]) -> Result<()> {
        if self.has_exited() {
            return Err(anyhow!("terminal {} has exited", self.shared.id));
        }
        {
            let mut writer = self.writer.lock().unwrap();
            writer.write_all(data).context("Failed to write to pty")?;
            writer.flush().context("Failed to flush pty")?;
        }
        if self.shared.scanner.lock().unwrap().on_write() {
            self.shared.publish_status();
        }
        Ok(())
    }

    /// The shell's process group id (see [`Session::shell_pid`] field docs).
    /// Used by the poller to detect whether the shell is at a prompt.
    pub fn shell_pid(&self) -> Option<i32> {
        self.shell_pid
    }

    /// The PTY's current foreground process group, or `None` if the master has
    /// been dropped (the session was killed). portable-pty performs the
    /// `tcgetpgrp` internally — no `unsafe` here.
    pub fn foreground_pgid(&self) -> Option<i32> {
        // `process_group_leader` returns `libc::pid_t` (an `i32`), so no
        // conversion is needed.
        self.master
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|master| master.process_group_leader())
    }

    /// Fold a poller observation into the session status, publishing if it
    /// changed. `at_prompt` is whether the shell itself is the PTY's foreground
    /// process group and `command` its resolved command name — both derived by
    /// the [`poller`](super::poll), which already computes `at_prompt` to decide
    /// which groups need a command lookup, so it isn't recomputed here.
    pub fn apply_poll(&self, at_prompt: bool, command: Option<String>) {
        let changed = self
            .shared
            .scanner
            .lock()
            .unwrap()
            .on_poll(at_prompt, command);
        if changed {
            self.shared.publish_status();
        }
    }

    /// Resize the PTY. Errors if the session has exited.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        if self.has_exited() {
            return Err(anyhow!("terminal {} has exited", self.shared.id));
        }
        if let Some(master) = self.master.lock().unwrap().as_ref() {
            master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .context("Failed to resize pty")?;
        }
        *self.size.lock().unwrap() = (cols, rows);
        // Keep the peek grid's dimensions in step with the live terminal.
        if let Some(vt) = self.vt.lock().unwrap().as_ref() {
            vt.send_resize(cols, rows);
        }
        Ok(())
    }

    /// A fresh plain-text screen snapshot from the VT actor, or `None` if
    /// unavailable (actor timed out, or the session has been torn down).
    pub fn peek(&self) -> Option<String> {
        self.vt.lock().unwrap().as_ref().and_then(VtThread::peek)
    }

    /// Terminate the child and join the reader thread. Idempotent.
    pub fn kill(&self) -> Result<()> {
        // Signal the child; ignore errors (it may already be gone).
        let _ = self.killer.lock().unwrap().kill();
        // Drop the master so the reader unblocks via EOF if it hasn't already.
        drop(self.master.lock().unwrap().take());
        // Wait for the reader thread to finish finalizing status and fan-out.
        if let Some(handle) = self.reader_handle.lock().unwrap().take() {
            let _ = handle.join();
        }
        // Shut down the VT actor and join it (no leaked thread). The reader's
        // on_exit already best-effort signaled it; this guarantees the join.
        if let Some(vt) = self.vt.lock().unwrap().take() {
            vt.shutdown_and_join();
        }
        Ok(())
    }
}

/// Resolve the shell to run: explicit override, then `$SHELL`, then `/bin/zsh`.
fn resolve_shell(shell: Option<PathBuf>) -> PathBuf {
    if let Some(shell) = shell {
        return shell;
    }
    if let Some(env_shell) = std::env::var_os("SHELL") {
        if !env_shell.is_empty() {
            return PathBuf::from(env_shell);
        }
    }
    PathBuf::from("/bin/zsh")
}

/// Send a message to every subscriber, dropping any that are full or closed.
///
/// Uses non-blocking `try_send`, so a slow or dead subscriber is removed rather
/// than stalling output to healthy ones.
fn fanout(subscribers: &Mutex<Vec<Sender<TerminalMessage>>>, message: &TerminalMessage) {
    let mut subs = subscribers.lock().unwrap();
    subs.retain(|tx| match tx.try_send(message.clone()) {
        Ok(()) => true,
        Err(TrySendError::Full(_) | TrySendError::Closed(_)) => false,
    });
}

/// Spawn the per-session reader thread. See the module docs for the ordering
/// contract this thread guarantees.
fn spawn_reader_thread(
    shared: Arc<Shared>,
    mut reader: Box<dyn std::io::Read + Send>,
    mut sinks: Vec<Box<dyn OutputSink>>,
) -> JoinHandle<()> {
    std::thread::Builder::new()
        .name(format!("terminal-{}", shared.id))
        .spawn(move || {
            let mut buf = [0u8; READ_BUFFER_SIZE];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let chunk = &buf[..n];
                        // `append` returns the cumulative byte cursor after this
                        // chunk; stamp it on the Output so reattaching clients can
                        // deduplicate replay against live output.
                        let seq = shared.ring.append(chunk);
                        for sink in &mut sinks {
                            sink.on_output(chunk);
                        }
                        fanout(
                            &shared.subscribers,
                            &TerminalMessage::Output {
                                data: Bytes::copy_from_slice(chunk),
                                seq,
                            },
                        );
                        // Scan for OSC 133 / bell / title / OSC 7 and publish any
                        // status change to subscribers.
                        if shared.scanner.lock().unwrap().feed(chunk) {
                            shared.publish_status();
                        }
                    }
                    Err(err) if err.kind() == std::io::ErrorKind::Interrupted => {}
                    Err(_) => break,
                }
            }

            // EOF (or read error): reap the exit code and finalize.
            let code = shared
                .child
                .lock()
                .unwrap()
                .wait()
                .ok()
                .map(|status| i32::try_from(status.exit_code()).unwrap_or(-1));
            *shared.exit_code.lock().unwrap() = code;
            shared.exited.store(true, Ordering::SeqCst);

            // Lifecycle finalization of status (the live phase machine is a
            // later phase; here we only record the terminal's exit).
            {
                let mut status = shared.status.lock().unwrap();
                status.phase = Phase::Idle;
                status.last_exit_code = code;
                status.entered_state_at = now_millis();
            }

            for sink in &mut sinks {
                sink.on_exit();
            }
            fanout(&shared.subscribers, &TerminalMessage::Exit(code));
        })
        .expect("failed to spawn terminal reader thread")
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[test]
    fn fanout_drops_slow_subscriber_but_keeps_healthy_one() {
        let subs: Mutex<Vec<Sender<TerminalMessage>>> = Mutex::new(Vec::new());

        // Healthy subscriber: roomy channel, always has space.
        let (fast_tx, mut fast_rx) = mpsc::channel::<TerminalMessage>(8);
        // Slow subscriber: tiny channel we never drain.
        let (slow_tx, _slow_rx) = mpsc::channel::<TerminalMessage>(2);
        subs.lock().unwrap().push(fast_tx);
        subs.lock().unwrap().push(slow_tx);

        // Fan out more messages than the slow channel can hold.
        for _ in 0..5 {
            fanout(
                &subs,
                &TerminalMessage::Output {
                    data: Bytes::from_static(b"x"),
                    seq: 0,
                },
            );
        }

        // The slow subscriber filled up and was dropped; the healthy one remains.
        assert_eq!(subs.lock().unwrap().len(), 1);

        // The healthy subscriber received every message.
        let mut fast_count = 0;
        while fast_rx.try_recv().is_ok() {
            fast_count += 1;
        }
        assert_eq!(fast_count, 5);
    }
}
