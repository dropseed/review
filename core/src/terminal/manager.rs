//! The single interface for creating and driving terminal sessions.
//!
//! [`SessionManager`] owns every [`Session`] keyed by [`TerminalId`]. The
//! `spur-daemon` process owns the one instance and serves it to the desktop
//! app over the daemon protocol.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use anyhow::{anyhow, Result};
use tokio::sync::mpsc::{self, Receiver};

use super::events::{EventBus, EventSubscription};
use super::poll::Poller;
use super::session::Session;
use super::vt::{PendingPeek, PEEK_TIMEOUT};
use super::{SessionSpec, SessionStatus, TerminalId, TerminalMessage, TerminalSummary};

/// The session map, shared with the foreground [`Poller`] so it can iterate live
/// sessions without a back-reference to the manager.
type SessionMap = Arc<Mutex<HashMap<TerminalId, Arc<Session>>>>;

/// Bound on a subscriber's output channel. A subscriber that falls this far
/// behind is dropped (see [`super::session`] fan-out); it can reattach and
/// replay the scrollback ring.
pub const SUBSCRIBER_CHANNEL_CAPACITY: usize = 1024;

/// A newly attached subscription: a stream of live [`TerminalMessage`]s.
pub struct Subscription {
    /// Live message stream (bounded; slow consumers are dropped).
    ///
    /// Live output only: scrollback is fetched separately (`SessionManager::replay`)
    /// so it arrives resync-trimmed and paired with the byte cursor that lets a
    /// client de-duplicate it against this stream.
    pub rx: Receiver<TerminalMessage>,
}

/// Owns all live terminal sessions.
pub struct SessionManager {
    sessions: SessionMap,
    /// The shared foreground poller, started lazily on the first `start`.
    poller: Mutex<Option<Poller>>,
    /// The manager-wide event bus every session publishes into. See
    /// [`super::events`] for the invariant it maintains.
    events: EventBus,
}

impl SessionManager {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            poller: Mutex::new(None),
            events: EventBus::new(),
        }
    }

    /// Watch everything that happens to every session — the push counterpart of
    /// polling [`Self::list`].
    ///
    /// Take a `list` *after* this call and apply each event to it in order, and
    /// the result is always the list `list` would return. See [`super::events`].
    pub fn subscribe_events(&self) -> EventSubscription {
        self.events.subscribe()
    }

    /// Spawn a session and register it, starting the shared poller on the first
    /// call. Errors if a session with the same id already exists.
    pub fn start(&self, spec: SessionSpec) -> Result<TerminalSummary> {
        let id = spec.terminal_id.clone();
        let session = Arc::new(Session::spawn(spec, self.events.clone())?);

        let mut sessions = self.sessions.lock().unwrap();
        if sessions.contains_key(&id) {
            drop(sessions);
            // This one was never in the list, so nothing about it may ever
            // reach the bus: it is born silent and dies that way, rather than
            // emitting events under an id the *live* session owns.
            let _ = session.kill();
            return Err(anyhow!("terminal {id} already exists"));
        }
        sessions.insert(id, Arc::clone(&session));
        drop(sessions);

        // Announce only once the session is findable: a subscriber that reacts
        // to `started` by re-listing must not be told about one `list` would
        // then deny.
        session.announce_started();
        let summary = session.summary();

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

    /// Move a session to another workspace (or to none).
    ///
    /// The id is opaque here — the daemon never reads the workspace queue, so it
    /// neither validates the workspace exists nor reacts when it stops existing.
    pub fn assign_workspace(&self, id: &TerminalId, workspace_id: Option<String>) -> Result<()> {
        self.get(id)?.assign_workspace(workspace_id);
        Ok(())
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
        let (bytes, cursor) = session.snapshot_for_replay();
        Ok((bytes, cursor, session.status()))
    }

    /// A fresh plain-text screen snapshot for a session (popover content peek),
    /// preceded by `scrollback` rows of the history immediately above the
    /// visible screen — `0` is the visible screen alone, `u32::MAX` everything
    /// the engine still holds.
    ///
    /// Renders through the session's VT actor with a hard timeout. Errors if the
    /// session is unknown, or if the actor did not answer in time (e.g. the
    /// session has exited).
    pub fn peek_with(&self, id: &TerminalId, scrollback: u32) -> Result<String> {
        self.get(id)?
            .peek(scrollback)
            .ok_or_else(|| anyhow!("terminal {id} peek unavailable"))
    }

    /// Visible screens for many sessions at once, keyed by id — what a grid of
    /// terminal cards asks for instead of one [`Self::peek_with`] per card.
    ///
    /// An id this manager does not know, or whose actor did not answer in time,
    /// is simply absent from the map: the caller is asking about a *set* of
    /// sessions, and one of them having just exited is the ordinary case rather
    /// than a reason to fail the rest.
    ///
    /// **Every request goes out before any reply is waited on**, and the whole
    /// batch shares one deadline. Each session renders on its own actor thread,
    /// so the renders were always concurrent; it was the *waiting* that was
    /// serial, which made a screenful of cards cost the sum of their timeouts
    /// instead of the longest one — seconds of a stalled poll for one wedged
    /// session among many healthy ones.
    pub fn peek_many(&self, ids: &[String]) -> HashMap<String, String> {
        let pending: Vec<(&String, PendingPeek)> = ids
            .iter()
            .filter_map(|id| {
                let session = self.get(&TerminalId::from(id.as_str())).ok()?;
                Some((id, session.request_peek(0)?))
            })
            .collect();

        let deadline = Instant::now() + PEEK_TIMEOUT;
        pending
            .into_iter()
            .filter_map(|(id, pending)| Some((id.clone(), pending.wait(deadline)?)))
            .collect()
    }

    /// Attach a new subscriber to a session's live stream. Subscribe *before*
    /// the first write to avoid missing output.
    pub fn subscribe(&self, id: &TerminalId) -> Result<Subscription> {
        let session = self.get(id)?;
        let (tx, rx) = mpsc::channel(SUBSCRIBER_CHANNEL_CAPACITY);
        session.add_subscriber(tx);
        Ok(Subscription { rx })
    }

    /// The PTY's current grid, for a stream's opening announcement.
    pub fn size(&self, id: &TerminalId) -> Result<(u16, u16)> {
        Ok(self.get(id)?.size())
    }

    /// Kill every session and clear the registry (app shutdown).
    ///
    /// **Every host process must call this on every death path.** portable-pty
    /// spawns each child via `setsid`, so children are session leaders in their
    /// own process groups — they are NOT in the host's group and would not be
    /// reaped by a process-group signal on exit. (Closing the PTY master does
    /// send SIGHUP as a backstop, but that only fires on an orderly fd
    /// teardown.) Idempotent: a second call just drains an empty map.
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
    use crate::terminal::events::SessionEvent;
    use crate::terminal::Phase;
    use std::path::PathBuf;
    use std::time::{Duration, Instant};

    /// Drain the bus until `found` matches an event, or `timeout` elapses.
    /// Returns every event seen, so a caller can assert on the whole sequence.
    fn drain_events_until<F: Fn(&SessionEvent) -> bool>(
        sub: &mut EventSubscription,
        found: F,
        timeout: Duration,
    ) -> Vec<SessionEvent> {
        let deadline = Instant::now() + timeout;
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            match sub.rx.try_recv() {
                Ok(event) => {
                    let done = found(&event);
                    seen.push(event);
                    if done {
                        return seen;
                    }
                }
                Err(tokio::sync::broadcast::error::TryRecvError::Empty) => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(_) => break,
            }
        }
        seen
    }

    /// Everything currently queued on the bus, without waiting for more.
    fn drain_events(sub: &mut EventSubscription) -> Vec<SessionEvent> {
        let mut seen = Vec::new();
        while let Ok(event) = sub.rx.try_recv() {
            seen.push(event);
        }
        seen
    }

    fn is_removed(event: &SessionEvent, wanted: &str) -> bool {
        matches!(event, SessionEvent::Removed { id } if id.0 == wanted)
    }

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
    fn session_env_carries_its_own_terminal_id() {
        let manager = SessionManager::new();
        let id = TerminalId::from("whoami-test");
        manager.start(spec("whoami-test")).unwrap();

        let mut sub = manager.subscribe(&id).unwrap();
        // The brackets keep the echoed command line (which contains the
        // variable name, not its value) from satisfying the needle.
        manager
            .write(&id, b"echo mine=[$SPUR_TERMINAL_ID]\n")
            .unwrap();

        assert!(
            wait_for_output(&mut sub.rx, "mine=[whoami-test]", Duration::from_secs(5)),
            "the shell did not inherit SPUR_TERMINAL_ID"
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

    /// Is `pid` still alive? (`kill -0` semantics, via `/bin/kill` so the
    /// test doesn't need its own libc binding.)
    fn pid_is_alive(pid: u32) -> bool {
        std::process::Command::new("/bin/kill")
            .args(["-0", &pid.to_string()])
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    /// Start a shell, run `command` in its foreground, and return the pid the
    /// shell printed for it (the command must echo `$$` first).
    fn start_with_foreground_job(id: &str, command: &str) -> (SessionManager, TerminalId, u32) {
        let manager = SessionManager::new();
        let tid = TerminalId::from(id);
        manager.start(spec(id)).unwrap();
        let mut sub = manager.subscribe(&tid).unwrap();
        manager
            .write(&tid, format!("{command}\n").as_bytes())
            .unwrap();
        // Wait for the printed value, not the echo of `$$`.
        assert!(
            wait_for_output(&mut sub.rx, "PID=", Duration::from_secs(5)),
            "job never printed its pid"
        );
        std::thread::sleep(Duration::from_millis(200));
        let text = String::from_utf8_lossy(&manager.replay(&tid).unwrap().0).into_owned();
        // The terminal echoes the typed command (`PID=$$`) before the job
        // prints the real value, so take the last occurrence.
        let pid: u32 = text
            .rsplit("PID=")
            .next()
            .and_then(|rest| rest.split(|c: char| !c.is_ascii_digit()).next())
            .and_then(|digits| digits.parse().ok())
            .expect("pid in output");
        assert!(pid_is_alive(pid));
        (manager, tid, pid)
    }

    #[test]
    fn kill_takes_the_foreground_job_down_with_the_shell() {
        // A plain sleep in the shell's group dies on the SIGHUP.
        let (manager, id, pid) =
            start_with_foreground_job("kill-fg", "sh -c 'echo PID=$$; exec sleep 300'");
        manager.kill(&id).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert!(!pid_is_alive(pid), "foreground job survived kill");
    }

    #[test]
    fn kill_escalates_past_a_job_that_ignores_hangup_and_term() {
        // The job traps SIGHUP and SIGTERM; only the SIGKILL escalation ends it.
        let (manager, id, pid) = start_with_foreground_job(
            "kill-stubborn",
            "sh -c 'trap \"\" HUP TERM; echo PID=$$; while :; do sleep 1; done'",
        );
        let started = std::time::Instant::now();
        manager.kill(&id).unwrap();
        std::thread::sleep(Duration::from_millis(100));
        assert!(!pid_is_alive(pid), "stubborn job survived kill");
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "kill took {:?}",
            started.elapsed()
        );
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
    fn resize_fans_out_to_subscribers_and_skips_no_ops() {
        let manager = SessionManager::new();
        let id = TerminalId::from("resize-fanout");
        manager.start(spec("resize-fanout")).unwrap();
        let mut sub = manager.subscribe(&id).unwrap();

        // A real change reaches every subscriber…
        manager.resize(&id, 100, 30).unwrap();
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut resized = None;
        while resized.is_none() && Instant::now() < deadline {
            match sub.rx.try_recv() {
                Ok(TerminalMessage::Resized { cols, rows }) => resized = Some((cols, rows)),
                Ok(_) => {}
                Err(mpsc::error::TryRecvError::Empty) => {
                    std::thread::sleep(Duration::from_millis(5));
                }
                Err(mpsc::error::TryRecvError::Disconnected) => break,
            }
        }
        assert_eq!(resized, Some((100, 30)), "resize never fanned out");
        assert_eq!(manager.list(None)[0].cols, 100);

        // …and repeating the same size is a no-op: no echo storm between
        // clients confirming each other's resizes.
        manager.resize(&id, 100, 30).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        let mut extra = 0;
        while let Ok(message) = sub.rx.try_recv() {
            if matches!(message, TerminalMessage::Resized { .. }) {
                extra += 1;
            }
        }
        assert_eq!(extra, 0, "an unchanged resize must not fan out");

        manager.kill(&id).unwrap();
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
    fn workspace_attribution_rides_the_summary_and_can_be_reassigned() {
        let manager = SessionManager::new();
        let id = TerminalId::from("workspace-test");
        let mut spec = spec("workspace-test");
        spec.workspace_id = Some("0a1b2c3d".to_owned());
        let summary = manager.start(spec).unwrap();
        assert_eq!(summary.workspace_id.as_deref(), Some("0a1b2c3d"));

        // Reassignment is live — the session keeps running under a new owner.
        manager
            .assign_workspace(&id, Some("beefcafe".to_owned()))
            .unwrap();
        assert_eq!(
            manager.list(None)[0].workspace_id.as_deref(),
            Some("beefcafe")
        );

        manager.assign_workspace(&id, None).unwrap();
        assert_eq!(manager.list(None)[0].workspace_id, None);

        manager.kill(&id).unwrap();
        // An unknown session errors rather than silently doing nothing.
        assert!(manager.assign_workspace(&id, None).is_err());
    }

    /// The bus has to narrate a session's whole life, because a subscriber's
    /// only other source of truth is the `list` it took when it subscribed.
    #[test]
    fn the_bus_narrates_start_resize_reassign_and_teardown() {
        let manager = SessionManager::new();
        let id = TerminalId::from("bus-life");
        let mut sub = manager.subscribe_events();

        let summary = manager.start(spec("bus-life")).unwrap();
        let started = drain_events_until(
            &mut sub,
            |e| matches!(e, SessionEvent::Started(_)),
            Duration::from_secs(5),
        );
        match started.last() {
            Some(SessionEvent::Started(announced)) => {
                assert_eq!(announced.id, summary.id);
                assert_eq!(
                    (announced.cols, announced.rows),
                    (summary.cols, summary.rows)
                );
            }
            other => panic!("start did not announce the session: {other:?}"),
        }

        // A real resize is announced; repeating the same size is not, exactly
        // as it is not fanned out to the session's own subscribers.
        manager.resize(&id, 100, 30).unwrap();
        let resized = drain_events_until(
            &mut sub,
            |e| {
                matches!(
                    e,
                    SessionEvent::Resized {
                        cols: 100,
                        rows: 30,
                        ..
                    }
                )
            },
            Duration::from_secs(5),
        );
        assert!(
            resized.iter().any(|e| matches!(
                e,
                SessionEvent::Resized {
                    cols: 100,
                    rows: 30,
                    ..
                }
            )),
            "a real resize was never announced: {resized:?}"
        );
        manager.resize(&id, 100, 30).unwrap();
        std::thread::sleep(Duration::from_millis(50));
        assert!(
            !drain_events(&mut sub)
                .iter()
                .any(|e| matches!(e, SessionEvent::Resized { .. })),
            "an unchanged resize must not reach the bus"
        );

        manager
            .assign_workspace(&id, Some("beefcafe".to_owned()))
            .unwrap();
        let assigned = drain_events_until(
            &mut sub,
            |e| matches!(e, SessionEvent::WorkspaceAssigned { .. }),
            Duration::from_secs(5),
        );
        assert!(
            assigned.iter().any(|e| matches!(
                e,
                SessionEvent::WorkspaceAssigned { id: got, workspace_id: Some(w) }
                    if got == &id && w == "beefcafe"
            )),
            "reassignment never reached the bus: {assigned:?}"
        );

        // Teardown says both things, in order: the child is gone, and the
        // session is out of the list.
        manager.kill(&id).unwrap();
        let torn_down = drain_events_until(
            &mut sub,
            |e| is_removed(e, "bus-life"),
            Duration::from_secs(5),
        );
        let exited = torn_down
            .iter()
            .position(|e| matches!(e, SessionEvent::Exited { .. }));
        let removed = torn_down.iter().position(|e| is_removed(e, "bus-life"));
        assert!(exited.is_some(), "no Exited on teardown: {torn_down:?}");
        assert!(removed.is_some(), "no Removed on teardown: {torn_down:?}");
        assert!(
            exited < removed,
            "Removed must follow Exited: {torn_down:?}"
        );
    }

    /// `list` hides an exited session immediately — long before the poller
    /// reaps it — so a shell exiting on its own has to reach the bus as a
    /// removal too, or a subscriber's list keeps a session `list` denies.
    #[test]
    fn a_shell_that_exits_on_its_own_leaves_the_list_on_the_bus() {
        let manager = SessionManager::new();
        let id = TerminalId::from("bus-exit");
        let mut sub = manager.subscribe_events();
        manager.start(spec("bus-exit")).unwrap();

        manager.write(&id, b"exit\n").unwrap();

        let seen = drain_events_until(
            &mut sub,
            |e| is_removed(e, "bus-exit"),
            Duration::from_secs(5),
        );
        assert!(
            seen.iter()
                .any(|e| matches!(e, SessionEvent::Exited { .. })),
            "a natural exit was never announced: {seen:?}"
        );
        assert!(
            seen.iter().any(|e| is_removed(e, "bus-exit")),
            "an exited session never left the list on the bus: {seen:?}"
        );
        assert!(manager.list(None).is_empty(), "list still shows it");

        // The poller reaping it later must not say `Removed` a second time —
        // the list can only lose a session once.
        std::thread::sleep(Duration::from_millis(700));
        assert!(
            !drain_events(&mut sub)
                .iter()
                .any(|e| is_removed(e, "bus-exit")),
            "the reap announced a second removal"
        );

        manager.shutdown_all();
    }

    /// A session spawned and then rejected for a duplicate id was never in the
    /// list. Nothing about it may reach the bus — least of all an event naming
    /// the id the *live* session owns.
    #[test]
    fn a_rejected_duplicate_never_reaches_the_bus() {
        let manager = SessionManager::new();
        let id = TerminalId::from("bus-dupe");
        manager.start(spec("bus-dupe")).unwrap();

        // Subscribe after the real session exists, so anything seen from here
        // on can only be the orphan's.
        let mut sub = manager.subscribe_events();
        assert!(manager.start(spec("bus-dupe")).is_err());
        std::thread::sleep(Duration::from_millis(100));
        assert!(
            drain_events(&mut sub).is_empty(),
            "the rejected session published events under a live session's id"
        );
        assert_eq!(manager.list(None).len(), 1, "the live session survived");

        manager.kill(&id).unwrap();
    }

    /// `shutdown_all` empties the list, so every session in it has to leave the
    /// list on the bus too.
    #[test]
    fn shutdown_all_removes_every_session_on_the_bus() {
        let manager = SessionManager::new();
        let mut sub = manager.subscribe_events();
        manager.start(spec("bus-all-1")).unwrap();
        manager.start(spec("bus-all-2")).unwrap();

        manager.shutdown_all();

        // Teardown order is the map's, so wait for the last removal rather than
        // a particular one.
        let outstanding = std::cell::Cell::new(2);
        let seen = drain_events_until(
            &mut sub,
            |e| {
                if matches!(e, SessionEvent::Removed { .. }) {
                    outstanding.set(outstanding.get() - 1);
                }
                outstanding.get() == 0
            },
            Duration::from_secs(5),
        );
        for id in ["bus-all-1", "bus-all-2"] {
            assert!(
                seen.iter().any(|e| is_removed(e, id)),
                "{id} never left the list on the bus: {seen:?}"
            );
        }
    }

    /// The peek's history is opt-in: the depth a caller asks for reaches the
    /// engine, and asking for none is the screen alone.
    #[test]
    fn peek_takes_a_scrollback_depth_and_many_ids_at_once() {
        let manager = SessionManager::new();
        let id = TerminalId::from("peek-batch");
        manager.start(spec("peek-batch")).unwrap();

        let mut sub = manager.subscribe(&id).unwrap();
        manager.write(&id, b"echo batch-marker\n").unwrap();
        assert!(wait_for_output(
            &mut sub.rx,
            "batch-marker",
            Duration::from_secs(5)
        ));

        // One round trip covers the sessions that exist and quietly omits the
        // ones that do not.
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut screens = HashMap::new();
        while Instant::now() < deadline {
            screens = manager.peek_many(&["peek-batch".to_owned(), "nobody".to_owned()]);
            if screens
                .get("peek-batch")
                .is_some_and(|s| s.contains("batch-marker"))
            {
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert!(
            screens
                .get("peek-batch")
                .is_some_and(|s| s.contains("batch-marker")),
            "peek_many never reflected the marker: {screens:?}"
        );
        assert!(
            !screens.contains_key("nobody"),
            "an unknown id must be omitted, not raised: {screens:?}"
        );

        assert!(manager.peek_with(&id, u32::MAX).is_ok());

        manager.kill(&id).unwrap();
        assert!(manager.peek_with(&id, 0).is_err());
        assert!(manager.peek_many(&["peek-batch".to_owned()]).is_empty());
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
            if let Ok(text) = manager.peek_with(&id, 0) {
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
        assert!(manager.peek_with(&id, 0).is_err());
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
        use crate::home::tests::ENV_LOCK;

        let Some(zsh) = find_zsh() else {
            eprintln!("skipping: no zsh binary found");
            return;
        };

        let _lock = ENV_LOCK.lock().unwrap();
        // Materialize the integration ZDOTDIR under a throwaway SPUR_HOME, and
        // point the user's ZDOTDIR at an empty dir so zsh doesn't source the real
        // (potentially slow/interactive) user config during the test.
        let spur_home = tempfile::TempDir::new().unwrap();
        let user_zdotdir = tempfile::TempDir::new().unwrap();
        std::env::set_var("SPUR_HOME", spur_home.path());
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
        std::env::remove_var("SPUR_HOME");
    }
}
