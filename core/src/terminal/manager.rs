//! The single interface for creating and driving terminal sessions.
//!
//! [`SessionManager`] owns every [`Session`] keyed by [`TerminalId`]. Both the
//! Tauri desktop and Axum web transports call into this one type.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use anyhow::{anyhow, Result};
use tokio::sync::mpsc::{self, Receiver};

use super::poll::Poller;
use super::session::Session;
use super::{SessionSpec, SessionStatus, TerminalId, TerminalMessage, TerminalSummary};

/// The session map, shared with the foreground [`Poller`] so it can iterate live
/// sessions without a back-reference to the manager.
type SessionMap = Arc<Mutex<HashMap<TerminalId, Arc<Session>>>>;

/// Bound on a subscriber's output channel. A subscriber that falls this far
/// behind is dropped (see [`super::session`] fan-out); it can reattach and
/// replay the scrollback ring.
pub const SUBSCRIBER_CHANNEL_CAPACITY: usize = 1024;

/// A newly attached subscription: the scrollback to replay first, then a stream
/// of live [`TerminalMessage`]s.
pub struct Subscription {
    /// Scrollback bytes to render before applying live output.
    pub replay: Vec<u8>,
    /// Live message stream (bounded; slow consumers are dropped).
    pub rx: Receiver<TerminalMessage>,
}

/// Owns all live terminal sessions.
pub struct SessionManager {
    sessions: SessionMap,
    /// The shared foreground poller, started lazily on the first `start`.
    poller: Mutex<Option<Poller>>,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            poller: Mutex::new(None),
        }
    }

    /// Spawn a session and register it, starting the shared poller on the first
    /// call. Errors if a session with the same id already exists.
    pub fn start(&self, spec: SessionSpec) -> Result<TerminalSummary> {
        let id = spec.terminal_id.clone();
        let session = Arc::new(Session::spawn(spec)?);
        let summary = session.summary();

        let mut sessions = self.sessions.lock().unwrap();
        if sessions.contains_key(&id) {
            drop(sessions);
            let _ = session.kill();
            return Err(anyhow!("terminal {id} already exists"));
        }
        sessions.insert(id, session);
        drop(sessions);

        self.ensure_poller();
        Ok(summary)
    }

    /// Start the shared foreground poller if it isn't already running.
    fn ensure_poller(&self) {
        let mut poller = self.poller.lock().unwrap();
        if poller.is_none() {
            *poller = Some(Poller::start(Arc::clone(&self.sessions)));
        }
    }

    /// Summaries of all live sessions, optionally filtered to one repo path.
    ///
    /// Exited sessions are never returned even if the poller hasn't reaped them
    /// from the map yet, so a fresh reload never shows a zombie tab.
    pub fn list(&self, repo_path: Option<&str>) -> Vec<TerminalSummary> {
        self.sessions
            .lock()
            .unwrap()
            .values()
            .filter(|session| !session.has_exited())
            .filter(|session| repo_path.is_none_or(|path| session.repo_path() == path))
            .map(|session| session.summary())
            .collect()
    }

    /// Write bytes to a session's stdin.
    pub fn write(&self, id: &TerminalId, data: &[u8]) -> Result<()> {
        self.get(id)?.write(data)
    }

    /// Resize a session's PTY.
    pub fn resize(&self, id: &TerminalId, cols: u16, rows: u16) -> Result<()> {
        self.get(id)?.resize(cols, rows)
    }

    /// Terminate a session's child, join its threads, and drop it from the map.
    ///
    /// Errors if the session is unknown — so a second `kill` of the same id (or a
    /// kill after the session already exited and was reaped) fails cleanly rather
    /// than silently succeeding. Removal happens *after* teardown so a caller that
    /// observes the error knows the session is fully gone.
    pub fn kill(&self, id: &TerminalId) -> Result<()> {
        let session = self.get(id)?;
        let result = session.kill();
        self.sessions.lock().unwrap().remove(id);
        result
    }

    /// The current scrollback, byte cursor, and status of a session (for a cold
    /// reattach). The cursor is the ring's end-offset at the moment the
    /// scrollback was copied; the client replays the bytes, then drops any live
    /// chunk whose `seq` is `<=` the cursor to avoid double-rendering.
    pub fn replay(&self, id: &TerminalId) -> Result<(Vec<u8>, u64, SessionStatus)> {
        let session = self.get(id)?;
        let (bytes, cursor) = session.snapshot_with_offset();
        Ok((bytes, cursor, session.status()))
    }

    /// A fresh plain-text screen snapshot for a session (popover content peek).
    ///
    /// Renders the current screen through the session's VT actor with a hard
    /// timeout. Errors if the session is unknown, or if the actor did not answer
    /// in time (e.g. the session has exited).
    pub fn peek(&self, id: &TerminalId) -> Result<String> {
        self.get(id)?
            .peek()
            .ok_or_else(|| anyhow!("terminal {id} peek unavailable"))
    }

    /// Attach a new subscriber: returns the scrollback to replay plus a live
    /// stream. Subscribe *before* the first write to avoid missing output.
    pub fn subscribe(&self, id: &TerminalId) -> Result<Subscription> {
        let session = self.get(id)?;
        let (tx, rx) = mpsc::channel(SUBSCRIBER_CHANNEL_CAPACITY);
        session.add_subscriber(tx);
        Ok(Subscription {
            replay: session.snapshot(),
            rx,
        })
    }

    /// Kill every session and clear the registry (app shutdown).
    pub fn shutdown_all(&self) {
        // Stop the poller before tearing down sessions so it can't observe a
        // half-killed session.
        if let Some(poller) = self.poller.lock().unwrap().take() {
            poller.stop();
        }
        let sessions: Vec<Arc<Session>> = self
            .sessions
            .lock()
            .unwrap()
            .drain()
            .map(|(_, session)| session)
            .collect();
        for session in sessions {
            let _ = session.kill();
        }
    }

    fn get(&self, id: &TerminalId) -> Result<Arc<Session>> {
        self.sessions
            .lock()
            .unwrap()
            .get(id)
            .cloned()
            .ok_or_else(|| anyhow!("no such terminal {id}"))
    }

    /// Number of sessions still held in the map (test-only: asserts reaping
    /// actually frees a session rather than just hiding it from `list`).
    #[cfg(test)]
    fn session_count(&self) -> usize {
        self.sessions.lock().unwrap().len()
    }
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::Phase;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    fn spec(id: &str) -> SessionSpec {
        let tmp = std::env::temp_dir();
        let mut spec = SessionSpec::new(id, tmp.clone(), tmp);
        spec.shell = Some(PathBuf::from("/bin/sh"));
        spec
    }

    /// Poll a receiver until its accumulated output contains `needle`.
    fn wait_for_output(
        rx: &mut Receiver<TerminalMessage>,
        needle: &str,
        timeout: Duration,
    ) -> bool {
        let deadline = Instant::now() + timeout;
        let mut acc: Vec<u8> = Vec::new();
        while Instant::now() < deadline {
            match rx.try_recv() {
                Ok(TerminalMessage::Output { data, .. }) => {
                    acc.extend_from_slice(&data);
                    if String::from_utf8_lossy(&acc).contains(needle) {
                        return true;
                    }
                }
                Ok(_) => {}
                Err(mpsc::error::TryRecvError::Empty) => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(mpsc::error::TryRecvError::Disconnected) => return false,
            }
        }
        false
    }

    #[test]
    fn subscriber_receives_echoed_output() {
        let manager = SessionManager::new();
        let id = TerminalId::from("echo-test");
        manager.start(spec("echo-test")).unwrap();

        let mut sub = manager.subscribe(&id).unwrap();
        manager.write(&id, b"echo hello-world\n").unwrap();

        assert!(
            wait_for_output(&mut sub.rx, "hello-world", Duration::from_secs(5)),
            "did not receive echoed output"
        );
        manager.kill(&id).unwrap();
    }

    #[test]
    fn replay_returns_scrollback_after_the_fact() {
        let manager = SessionManager::new();
        let id = TerminalId::from("replay-test");
        manager.start(spec("replay-test")).unwrap();

        let mut sub = manager.subscribe(&id).unwrap();
        manager.write(&id, b"echo replay-probe\n").unwrap();
        assert!(wait_for_output(
            &mut sub.rx,
            "replay-probe",
            Duration::from_secs(5)
        ));

        // A cold reattach sees the same bytes in the scrollback ring, and the
        // cursor is the end-offset those bytes reach.
        let (bytes, cursor, _status) = manager.replay(&id).unwrap();
        assert!(String::from_utf8_lossy(&bytes).contains("replay-probe"));
        assert_eq!(cursor as usize, bytes.len());
        manager.kill(&id).unwrap();
    }

    #[test]
    fn kill_terminates_delivers_exit_and_blocks_writes() {
        let manager = SessionManager::new();
        let id = TerminalId::from("kill-test");
        manager.start(spec("kill-test")).unwrap();
        let mut sub = manager.subscribe(&id).unwrap();

        manager.kill(&id).unwrap();

        // kill() joined the reader thread, so the Exit message is already queued.
        let mut saw_exit = false;
        loop {
            match sub.rx.try_recv() {
                Ok(TerminalMessage::Exit(_)) => {
                    saw_exit = true;
                    break;
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
        assert!(saw_exit, "no Exit message after kill");

        // Writing to a dead session errors.
        assert!(manager.write(&id, b"noop\n").is_err());
    }

    #[test]
    fn kill_removes_session_from_map_and_list() {
        let manager = SessionManager::new();
        let id = TerminalId::from("reap-kill");
        manager.start(spec("reap-kill")).unwrap();
        assert_eq!(manager.list(None).len(), 1);

        manager.kill(&id).unwrap();

        assert!(manager.list(None).is_empty(), "killed session still listed");
        assert_eq!(manager.session_count(), 0, "killed session not dropped");
    }

    #[test]
    fn double_kill_errors_cleanly() {
        let manager = SessionManager::new();
        let id = TerminalId::from("double-kill");
        manager.start(spec("double-kill")).unwrap();

        assert!(manager.kill(&id).is_ok());
        // The session is gone from the map, so a second kill fails rather than
        // silently succeeding.
        assert!(manager.kill(&id).is_err(), "second kill should error");
    }

    #[test]
    fn exited_shell_is_reaped_from_the_map() {
        let manager = SessionManager::new();
        let id = TerminalId::from("reap-exit");
        manager.start(spec("reap-exit")).unwrap();

        // The shell exits on its own; the reader hits EOF and the poller reaps
        // the session out of the map within a tick or two.
        manager.write(&id, b"exit\n").unwrap();

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut reaped = false;
        while Instant::now() < deadline {
            if manager.session_count() == 0 {
                reaped = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(reaped, "exited shell was never reaped from the map");
        assert!(manager.list(None).is_empty());

        manager.shutdown_all();
    }

    #[test]
    fn list_filters_by_repo_path() {
        let manager = SessionManager::new();
        let tmp = std::env::temp_dir();

        let mut spec_a = SessionSpec::new("a", tmp.join("repo-a"), tmp.clone());
        spec_a.shell = Some(PathBuf::from("/bin/sh"));
        let mut spec_b = SessionSpec::new("b", tmp.join("repo-b"), tmp.clone());
        spec_b.shell = Some(PathBuf::from("/bin/sh"));

        manager.start(spec_a).unwrap();
        manager.start(spec_b).unwrap();

        assert_eq!(manager.list(None).len(), 2);
        let repo_a = tmp.join("repo-a").to_string_lossy().into_owned();
        let only_a = manager.list(Some(&repo_a));
        assert_eq!(only_a.len(), 1);
        assert_eq!(only_a[0].id, TerminalId::from("a"));

        manager.shutdown_all();
        assert_eq!(manager.list(None).len(), 0);
    }

    /// Drain `rx` until a `Status` message satisfies `pred`, or time out.
    fn wait_for_status<F: Fn(&SessionStatus) -> bool>(
        rx: &mut Receiver<TerminalMessage>,
        pred: F,
        timeout: Duration,
    ) -> Option<SessionStatus> {
        let deadline = Instant::now() + timeout;
        while Instant::now() < deadline {
            match rx.try_recv() {
                Ok(TerminalMessage::Status(status)) => {
                    if pred(&status) {
                        return Some(status);
                    }
                }
                Ok(_) => {}
                Err(mpsc::error::TryRecvError::Empty) => {
                    std::thread::sleep(Duration::from_millis(10));
                }
                Err(mpsc::error::TryRecvError::Disconnected) => return None,
            }
        }
        None
    }

    #[test]
    fn poller_reports_running_command_and_working_phase() {
        let manager = SessionManager::new();
        let id = TerminalId::from("poll-test");
        manager.start(spec("poll-test")).unwrap();
        let mut sub = manager.subscribe(&id).unwrap();

        // Run a long command; the poller (500ms tick) should notice the
        // foreground process group change and name it via `ps`.
        manager.write(&id, b"sleep 5\n").unwrap();

        let status = wait_for_status(
            &mut sub.rx,
            |s| s.running_command.as_deref() == Some("sleep"),
            Duration::from_secs(3),
        );
        let status = status.expect("poller did not report running command 'sleep'");
        // No shell integration for /bin/sh, so the poller drives the phase.
        assert_eq!(status.phase, Phase::Working);

        // Killing the session lets the poller drop it (via has_exited) without
        // panicking; give it a tick, then tear everything down.
        manager.kill(&id).unwrap();
        std::thread::sleep(Duration::from_millis(600));
        manager.shutdown_all();
    }

    #[test]
    fn peek_reflects_echoed_marker_then_kill_joins_vt() {
        let manager = SessionManager::new();
        let id = TerminalId::from("peek-e2e");
        manager.start(spec("peek-e2e")).unwrap();

        // Wait until the marker has actually been produced on the PTY.
        let mut sub = manager.subscribe(&id).unwrap();
        manager.write(&id, b"echo peek-marker-xyz\n").unwrap();
        assert!(wait_for_output(
            &mut sub.rx,
            "peek-marker-xyz",
            Duration::from_secs(5)
        ));

        // The VT actor consumes the same bytes asynchronously; poll the fresh
        // screen render until it reflects the marker (or time out).
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut peeked = None;
        while Instant::now() < deadline {
            if let Ok(text) = manager.peek(&id) {
                if text.contains("peek-marker-xyz") {
                    peeked = Some(text);
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            peeked.is_some(),
            "peek never reflected the echoed marker: {peeked:?}"
        );

        // kill() shuts down and joins the VT thread; if it leaked or wedged this
        // call would hang the test (also under --test-threads=1).
        manager.kill(&id).unwrap();

        // After teardown, peek fails rather than hanging.
        assert!(manager.peek(&id).is_err());
    }

    /// Locate a zsh binary, or `None` if the platform doesn't have one.
    fn find_zsh() -> Option<PathBuf> {
        for candidate in [
            "/bin/zsh",
            "/usr/bin/zsh",
            "/usr/local/bin/zsh",
            "/opt/homebrew/bin/zsh",
        ] {
            let path = PathBuf::from(candidate);
            if path.exists() {
                return Some(path);
            }
        }
        None
    }

    #[test]
    fn zsh_shell_integration_reports_exit_codes() {
        use crate::review::central::tests::ENV_LOCK;

        let Some(zsh) = find_zsh() else {
            eprintln!("skipping: no zsh binary found");
            return;
        };

        let _lock = ENV_LOCK.lock().unwrap();
        // Materialize the integration ZDOTDIR under a throwaway REVIEW_HOME, and
        // point the user's ZDOTDIR at an empty dir so zsh doesn't source the real
        // (potentially slow/interactive) user config during the test.
        let review_home = tempfile::TempDir::new().unwrap();
        let user_zdotdir = tempfile::TempDir::new().unwrap();
        std::env::set_var("REVIEW_HOME", review_home.path());
        std::env::set_var("ZDOTDIR", user_zdotdir.path());

        let manager = SessionManager::new();
        let id = TerminalId::from("zsh-test");
        let tmp = std::env::temp_dir();
        let mut spec = SessionSpec::new("zsh-test", tmp.clone(), tmp);
        spec.shell = Some(zsh);
        manager.start(spec).unwrap();
        let mut sub = manager.subscribe(&id).unwrap();

        // `true` exits 0, `false` exits 1; OSC 133 D marks report each code.
        manager.write(&id, b"true\n").unwrap();
        let zero = wait_for_status(
            &mut sub.rx,
            |s| s.shell_integration_active && s.last_exit_code == Some(0),
            Duration::from_secs(10),
        );
        assert!(
            zero.is_some(),
            "expected shell integration active with exit code 0"
        );

        manager.write(&id, b"false\n").unwrap();
        let one = wait_for_status(
            &mut sub.rx,
            |s| s.shell_integration_active && s.last_exit_code == Some(1),
            Duration::from_secs(10),
        );
        assert!(one.is_some(), "expected exit code 1 after `false`");

        manager.shutdown_all();
        std::env::remove_var("ZDOTDIR");
        std::env::remove_var("REVIEW_HOME");
    }
}
