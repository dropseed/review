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

use super::events::{EventBus, SessionEvent};
use super::ring::Ring;
use super::status::StatusScanner;
use super::vt::{self, PendingPeek, VtThread};
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
    /// The manager-wide event bus (see [`super::events`]).
    events: EventBus,
    /// Whether the manager has accepted this session into its map and announced
    /// it. Until then nothing about this session may be published: a session
    /// spawned and then thrown away (a duplicate id) was never in anyone's
    /// list, and an event naming its id would be read as being about the *live*
    /// session it collided with.
    announced: AtomicBool,
    /// Whether [`SessionEvent::Removed`] has already gone out. Several paths
    /// converge on "this session has left the list" — an explicit kill, the
    /// poller reaping an exited shell, `shutdown_all` — and the list may only
    /// lose it once.
    removal_announced: AtomicBool,
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
        // The same object, to the clients watching the whole daemon rather
        // than this one session — but only built when one of them exists. A
        // status is a deep clone, and every transition of every session makes
        // one; a daemon nobody has opened an events connection to should not
        // pay for a copy it will hand to nobody.
        if self.wants_events() {
            self.publish_event(SessionEvent::Status(status.clone()));
        }
        fanout(&self.subscribers, &TerminalMessage::Status(status));
    }

    /// Publish to the manager-wide bus, unless this session was never accepted.
    ///
    /// Never called while holding a lock the event's construction needs, so the
    /// bus can't participate in a lock cycle with `status`, `size`, or
    /// `subscribers`.
    fn publish_event(&self, event: SessionEvent) {
        if self.wants_events() {
            self.events.publish(event);
        }
    }

    /// Whether an event published now would reach anyone: this session is
    /// announced, and something is watching the bus. Checked before *building*
    /// an event that costs a clone — [`Self::publish_event`] takes an owned one.
    fn wants_events(&self) -> bool {
        self.announced.load(Ordering::SeqCst) && self.events.has_subscribers()
    }

    /// Announce that this session has left the list — at most once, whichever
    /// path gets there first.
    fn announce_removed(&self) {
        if self.announced.load(Ordering::SeqCst)
            && !self.removal_announced.swap(true, Ordering::SeqCst)
        {
            self.events.publish(SessionEvent::Removed {
                id: self.id.clone(),
            });
        }
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
    ///
    /// `events` is the manager-wide bus, but a freshly spawned session is
    /// **silent** on it until [`Session::announce_started`]: whoever spawned it
    /// may still reject it, and a rejected session was never in the list.
    pub fn spawn(spec: SessionSpec, events: EventBus) -> Result<Self> {
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
        // Which session this is, so anything running inside it can name itself
        // to `review terminal`. The workspace is deliberately not exported:
        // attribution can change under a running shell (a drag in the app is an
        // `AssignWorkspace`), so it has to be asked for live, not frozen here.
        cmd.env(super::TERMINAL_ID_ENV, &id.0);
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
            events,
            announced: AtomicBool::new(false),
            removal_announced: AtomicBool::new(false),
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

    /// Take this session out of its silent state: publish it to the
    /// manager-wide bus and start publishing everything that happens to it.
    ///
    /// Called once, by the manager, after the session is in the map — so a
    /// subscriber that reacts by re-listing already finds it there. The
    /// summary is built *before* arming, since the bus must not be reachable
    /// from inside a lock the summary needs.
    pub(crate) fn announce_started(&self) {
        let summary = self.summary();
        self.shared
            .events
            .publish(SessionEvent::Started(Box::new(summary)));
        self.shared.announced.store(true, Ordering::SeqCst);
    }

    /// Move this session to another workspace, or to none.
    pub fn assign_workspace(&self, workspace_id: Option<String>) {
        *self.workspace_id.lock().unwrap() = workspace_id.clone();
        // Unconditional, including a re-assignment to the workspace it is
        // already in: `AssignWorkspace` is an explicit act by some client, and
        // every consumer of this applies it idempotently. Nothing is gained by
        // making the daemon compare strings to suppress it.
        self.shared.publish_event(SessionEvent::WorkspaceAssigned {
            id: self.shared.id.clone(),
            workspace_id,
        });
    }

    /// Whether the child has exited (EOF reached).
    pub fn has_exited(&self) -> bool {
        self.shared.exited.load(Ordering::SeqCst)
    }

    /// A clone of the current status.
    pub fn status(&self) -> SessionStatus {
        self.shared.status.lock().unwrap().clone()
    }

    /// The PTY's current grid.
    pub fn size(&self) -> (u16, u16) {
        *self.size.lock().unwrap()
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
            // One lock hold for the whole payload, so two concurrent writers
            // never interleave their chunks.
            let mut writer = self.writer.lock().unwrap();
            let mut chunks = pty_write_chunks(data).peekable();
            while let Some(chunk) = chunks.next() {
                writer.write_all(chunk).context("Failed to write to pty")?;
                writer.flush().context("Failed to flush pty")?;
                if chunks.peek().is_some() {
                    std::thread::sleep(PTY_WRITE_PAUSE);
                }
            }
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
    ///
    /// A resize to the size the session already has is a no-op — no ioctl, no
    /// fan-out. That keeps a client's confirmation of its own resize from
    /// echoing forever, and keeps re-mounts from spamming SIGWINCH.
    pub fn resize(&self, cols: u16, rows: u16) -> Result<()> {
        if self.has_exited() {
            return Err(anyhow!("terminal {} has exited", self.shared.id));
        }
        // One guard held across compare → ioctl → record → fan-out, so two
        // concurrent resizes serialize: interleaved, the recorded size (and
        // the no-op guard reading it) could disagree with the kernel's real
        // winsize forever, and the last Resized fanned out must name the size
        // the PTY actually ended at.
        let mut size = self.size.lock().unwrap();
        if *size == (cols, rows) {
            return Ok(());
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
        *size = (cols, rows);
        // Keep the peek grid's dimensions in step with the live terminal.
        if let Some(vt) = self.vt.lock().unwrap().as_ref() {
            vt.send_resize(cols, rows);
        }
        // Tell every attached client: they all share this one grid, and any of
        // them rendering at the old size is now rendering wrong. The bus hears
        // it too, for the clients that are watching the daemon rather than this
        // one session — and only for a real change, same as the fan-out.
        fanout(
            &self.shared.subscribers,
            &TerminalMessage::Resized { cols, rows },
        );
        self.shared.publish_event(SessionEvent::Resized {
            id: self.shared.id.clone(),
            cols,
            rows,
        });
        Ok(())
    }

    /// A fresh plain-text screen snapshot from the VT actor, or `None` if
    /// unavailable (actor timed out, or the session has been torn down).
    ///
    /// `scrollback` is how many rows of history above the visible screen to
    /// include; `0` is the visible screen alone.
    pub fn peek(&self, scrollback: u32) -> Option<String> {
        self.vt
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|vt| vt.peek(scrollback))
    }

    /// [`Self::peek`] without the wait — see [`VtThread::request_peek`]. What a
    /// caller rendering several sessions uses to get every actor working before
    /// it waits on any of them.
    pub fn request_peek(&self, scrollback: u32) -> Option<PendingPeek> {
        self.vt
            .lock()
            .unwrap()
            .as_ref()
            .and_then(|vt| vt.request_peek(scrollback))
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
        // Normally the reader thread already said this on its way out (the
        // join above waited for it). The backstop is for the paths where it
        // cannot have: a second kill, or a session whose reader never ran.
        self.shared.announce_removed();
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
            // `SessionManager::list` hides an exited session from this moment
            // — the poller's later reap only frees it — so exiting is also
            // leaving the list, and the bus has to say both.
            shared.publish_event(SessionEvent::Exited {
                id: shared.id.clone(),
                exit_code: code,
            });
            shared.announce_removed();
        })
        .expect("failed to spawn terminal reader thread")
}

/// The largest single write the PTY master ever sees, and the gap between two
/// of them within one `write`.
///
/// The kernel tty queue hands a raw-mode reader a 1024-byte burst first and the
/// rest in a second `read()`, so one large write reaches the foreground program
/// as two — and a TUI with a paste heuristic (Claude Code) takes the first
/// burst as a paste and only the tail as typed text. Chunks written back to
/// back are coalesced into that same first read, so the size alone changes
/// nothing; the pause is what makes the reader see them separately. The cost
/// is proportional to the payload and paid under the writer lock, so a very
/// large paste serializes other writers to that session for its duration.
/// Canonical mode (a shell at its prompt) still drops everything past its
/// 1024-byte input limit — the line discipline's rule, which no chunking helps.
const PTY_WRITE_CHUNK: usize = 512;
const PTY_WRITE_PAUSE: std::time::Duration = std::time::Duration::from_millis(10);

/// Split a PTY write into flush-sized chunks (see [`PTY_WRITE_CHUNK`]).
///
/// Boundary-aware: a chunk never ends inside an escape sequence or a
/// multi-byte UTF-8 character, because the pause after it would be read as
/// part of the input — a bare ESC followed by silence is the Escape key to
/// Ink and Claude Code (which cancels a bracketed paste mid-marker), and a torn
/// UTF-8 sequence is two garbage bytes. The cut moves back to just before
/// the ESC or lead byte; only a single sequence longer than the chunk size
/// is cut hard.
fn pty_write_chunks(data: &[u8]) -> impl Iterator<Item = &[u8]> {
    let mut rest = data;
    std::iter::from_fn(move || {
        if rest.is_empty() {
            return None;
        }
        let mut end = rest.len().min(PTY_WRITE_CHUNK);
        if end < rest.len() {
            let safe = safe_split_point(rest, end);
            if safe > 0 {
                end = safe;
            }
        }
        let (chunk, tail) = rest.split_at(end);
        rest = tail;
        Some(chunk)
    })
}

/// The largest split point `<= at` in `data` that does not fall inside a
/// sequence (escape or UTF-8) that started before it. `0` means no such
/// point exists — the sequence at the start is itself longer than `at`.
fn safe_split_point(data: &[u8], at: usize) -> usize {
    // Walk the sequences from the start; cheap, since `at` is at most one
    // chunk. Whatever sequence contains `at` starts at `start` — cut there.
    let mut i = 0;
    while i < at {
        let len = sequence_len(&data[i..]);
        if i + len > at {
            return i;
        }
        i += len;
    }
    at
}

/// Length of the sequence beginning at `data[0]`: an ESC sequence up to and
/// including its final byte, a UTF-8 character up to its last continuation
/// byte, else one byte. An unterminated sequence runs to the end of `data`.
fn sequence_len(data: &[u8]) -> usize {
    let first = data[0];
    if first == 0x1b {
        // ESC alone is one byte (what `--key esc` sends). `ESC [` opens a
        // CSI sequence: parameter and intermediate bytes (0x20..=0x3F) up to
        // a final byte 0x40..=0x7E, so `\e[200~` ends at `~` and `\e[1;5C`
        // at `C`. `ESC O` (SS3, the arrow keys in application mode) takes
        // exactly one more byte. Anything else is ESC + intermediates
        // (0x20..=0x2F) + one final byte.
        let Some(&intro) = data.get(1) else {
            return 1;
        };
        let mut n = 2;
        match intro {
            b'[' => {
                while n < data.len() {
                    let b = data[n];
                    n += 1;
                    if (0x40..=0x7e).contains(&b) {
                        break;
                    }
                }
            }
            b'O' => n = (n + 1).min(data.len()),
            _ => {
                let mut b = intro;
                while (0x20..=0x2f).contains(&b) && n < data.len() {
                    b = data[n];
                    n += 1;
                }
            }
        }
        return n;
    }
    let width = match first {
        0xc0..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf7 => 4,
        _ => return 1,
    };
    // Trust the continuation bytes that are actually there; stop early at
    // the first byte that is not one so a torn input can't swallow text.
    let mut n = 1;
    while n < width && n < data.len() && (data[n] & 0xc0) == 0x80 {
        n += 1;
    }
    n
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;

    #[test]
    fn pty_writes_are_chunked_under_the_tty_read_boundary() {
        // Empty stays empty (no zero-length write).
        assert_eq!(pty_write_chunks(b"").count(), 0);
        // A small write goes out whole.
        let small = vec![b'x'; PTY_WRITE_CHUNK];
        assert_eq!(
            pty_write_chunks(&small).collect::<Vec<_>>(),
            vec![&small[..]]
        );
        // 1538 bytes (the reported failing send) becomes three full chunks and a tail.
        let big: Vec<u8> = (0..1538u32).map(|i| b'a' + (i % 26) as u8).collect();
        let chunks: Vec<&[u8]> = pty_write_chunks(&big).collect();
        assert_eq!(
            chunks.iter().map(|c| c.len()).collect::<Vec<_>>(),
            vec![512, 512, 512, 2]
        );
        assert!(chunks.iter().all(|c| c.len() < 1024));
        // Concatenated back, nothing is lost or reordered.
        assert_eq!(chunks.concat(), big);
    }

    #[test]
    fn pty_writes_never_split_inside_an_escape_sequence() {
        // A bracketed-paste marker straddling the 512 boundary: 509 bytes of
        // text, then `\e[200~` (6 bytes) spanning 509..515.
        let mut data = vec![b'a'; 509];
        data.extend_from_slice(b"\x1b[200~");
        data.extend_from_slice(&[b'b'; 300]);
        let chunks: Vec<&[u8]> = pty_write_chunks(&data).collect();
        assert_eq!(chunks[0].len(), 509, "cut lands just before the ESC");
        assert!(chunks[1].starts_with(b"\x1b[200~"));
        assert_eq!(chunks.concat(), data);
        // Same for a marker that starts exactly at the boundary minus one.
        let mut data = vec![b'a'; 511];
        data.extend_from_slice(b"\x1b[201~xyz");
        let chunks: Vec<&[u8]> = pty_write_chunks(&data).collect();
        assert_eq!(chunks[0].len(), 511);
        assert_eq!(chunks[1], b"\x1b[201~xyz");

        // A lone ESC (as `--key esc` sends) is one byte, and text after it
        // is still chunked normally.
        assert_eq!(sequence_len(b"\x1b"), 1);
        assert_eq!(sequence_len(b"\x1b[200~rest"), 6);
        assert_eq!(sequence_len(b"\x1bOA"), 3);
        assert_eq!(sequence_len(b"\x1b[1;5Cx"), 6);

        // A single sequence longer than a chunk is cut hard, not looped on.
        let mut data = vec![0x1b, b'['];
        data.extend(std::iter::repeat_n(b'1', PTY_WRITE_CHUNK + 10));
        data.push(b'm');
        let chunks: Vec<&[u8]> = pty_write_chunks(&data).collect();
        assert_eq!(chunks[0].len(), PTY_WRITE_CHUNK);
        assert_eq!(chunks.concat(), data);
    }

    #[test]
    fn pty_writes_never_split_inside_a_utf8_character() {
        // 510 ASCII bytes, then a 4-byte emoji spanning 510..514.
        let mut data = vec![b'a'; 510];
        data.extend_from_slice("🙂".as_bytes());
        data.extend_from_slice(&[b'b'; 100]);
        let chunks: Vec<&[u8]> = pty_write_chunks(&data).collect();
        assert_eq!(chunks[0].len(), 510);
        assert!(chunks[1].starts_with("🙂".as_bytes()));
        for c in &chunks {
            assert!(std::str::from_utf8(c).is_ok(), "chunk is valid UTF-8");
        }
        assert_eq!(chunks.concat(), data);

        // A 3-byte char with its lead byte at 511.
        let mut data = vec![b'a'; 511];
        data.extend_from_slice("é€".as_bytes());
        let chunks: Vec<&[u8]> = pty_write_chunks(&data).collect();
        assert_eq!(chunks[0].len(), 511);
        assert_eq!(chunks[1], "é€".as_bytes());
    }

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
