//! Tauri command handlers for embedded terminal sessions.
//!
//! These are thin proxies onto the `review-daemon` process, which owns the one
//! `SessionManager` and therefore the PTYs — that is what lets sessions
//! survive quitting or crashing this app. Each command is one control request
//! over the daemon's Unix socket ([`DaemonClient`]); live PTY output arrives on
//! a second, per-session connection and is re-emitted as Tauri events (see
//! [`ensure_drain`]).
//!
//! The command signatures and emitted event/payload shapes are fixed by the
//! project's canonical wire contract (all JSON `camelCase`) and are unchanged
//! from when the manager ran in-process — the frontend cannot tell the
//! difference.

use std::collections::HashSet;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::Engine as _;
use log::{error, info, warn};
use review::daemon::{DaemonClient, Op, ReplayPayload, StreamFrame, StreamHandle};
use review::terminal::{SessionStatus, TerminalSummary};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use super::daemon;

/// Message returned by every terminal command when the daemon cannot be reached.
/// The panel gates itself off via `terminals_available`, so this is a backstop
/// rather than something a user should normally see.
const DAEMON_UNAVAILABLE: &str = "The terminal daemon is not running. Restart Review to try again.";

/// Tauri-managed handle to the terminal daemon, shared by all windows.
pub struct TerminalState {
    /// The control connection, established on **first use** rather than at
    /// startup — see [`TerminalState::client`]. Empty until some terminal
    /// command (usually the frontend's `terminals_available` probe) needs it,
    /// which keeps a daemon spawn or version respawn off the path the window
    /// waits on, and keeps a failed first attempt retryable: the slot stays
    /// empty, so the next command tries again.
    ///
    /// Once filled it is never replaced. A daemon that dies *while* the app runs
    /// is deliberately not reconnected to — its sessions died with it, so a
    /// relaunch is the honest recovery.
    client: tokio::sync::Mutex<Option<DaemonClient>>,
    /// Socket path, used to open per-session stream connections.
    socket: PathBuf,
    /// Sessions with a live drain task, so a re-mount or a repeated
    /// `terminal_replay` cannot start a second stream for the same session.
    drains: Arc<Mutex<HashSet<String>>>,
}

impl TerminalState {
    /// State for a daemon that has not been contacted yet.
    pub fn new(socket: PathBuf) -> Self {
        Self {
            client: tokio::sync::Mutex::new(None),
            socket,
            drains: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// A cloned control client, attaching to (or spawning) the daemon the first
    /// time one is asked for. Cloning is an `Arc` bump and keeps command futures
    /// free of borrows from Tauri state.
    async fn client(&self, app: &AppHandle) -> Result<DaemonClient, String> {
        self.establish(|| daemon::ensure_daemon(app)).await
    }

    /// [`Self::client`] with the ensure step injected, so the lazy slot's
    /// behavior is testable without an `AppHandle`.
    ///
    /// The lock is deliberately held across the ensure: concurrent commands
    /// during startup must queue behind the one attempt rather than race to
    /// spawn competing daemons.
    async fn establish<F, Fut>(&self, ensure: F) -> Result<DaemonClient, String>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = anyhow::Result<DaemonClient>>,
    {
        let mut slot = self.client.lock().await;
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        match ensure().await {
            Ok(client) => Ok(slot.insert(client).clone()),
            Err(e) => {
                error!("[terminal] terminal daemon unavailable: {e:#}");
                Err(DAEMON_UNAVAILABLE.to_owned())
            }
        }
    }
}

/// Standard base64 engine used for every bytes-over-events payload.
const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// `terminal:output:{id}` payload — raw PTY bytes (base64-encoded) tagged with
/// the scrollback byte cursor (`seq`) they end at, so a reattaching pane can
/// deduplicate live output against a `terminal_replay` snapshot.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputPayload {
    id: String,
    data_b64: String,
    seq: u64,
}

/// `terminal:exit:{id}` payload — the child's exit code (`null` if unknown).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitPayload {
    id: String,
    exit_code: Option<i32>,
}

/// Return shape of `terminal_replay` — scrollback bytes, the byte cursor those
/// bytes end at, and current status.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReplay {
    data_b64: String,
    cursor: u64,
    status: SessionStatus,
}

/// Run one control op and decode its Ok payload into `T`.
async fn request<T: serde::de::DeserializeOwned>(
    client: &DaemonClient,
    op: Op,
) -> Result<T, String> {
    let value = client.request(op).await.map_err(|e| e.to_string())?;
    serde_json::from_value(value).map_err(|e| format!("unexpected daemon response: {e}"))
}

/// Ensure exactly one task is pumping this session's daemon stream into Tauri
/// events.
///
/// Idempotent: a second call for a session that is already being drained is a
/// no-op, so a hot re-mount or a repeated `terminal_replay` cannot double-emit.
/// The slot is released when the stream ends, which lets a later
/// `terminal_replay` re-establish the pump if the connection dropped.
///
/// The subscription is established *before* the calling command returns. The
/// daemon discards a fresh subscription's scrollback (clients are expected to
/// fetch it with `Op::Replay`), and a freshly started session is the one case
/// where the frontend never replays — so anything written between subscribing
/// and returning would simply be lost. Connecting first also makes this
/// cancellation-safe: the slot is claimed only once there is a stream to hand
/// to the task that will release it.
async fn ensure_drain(app: AppHandle, state: &TerminalState, terminal_id: String) {
    if is_draining(&state.drains, &terminal_id) {
        return;
    }

    let stream = match DaemonClient::open_stream(&state.socket, &terminal_id).await {
        Ok(stream) => stream,
        Err(e) => {
            warn!("[terminal] could not open the output stream for {terminal_id}: {e}");
            return;
        }
    };
    if !claim_drain(&state.drains, &terminal_id) {
        // Another call won the race while we were connecting; drop this
        // connection, which drops its daemon-side subscription.
        return;
    }

    let drains = Arc::clone(&state.drains);
    tokio::spawn(async move {
        drain_stream(app, stream, &terminal_id).await;
        release_drain(&drains, &terminal_id);
    });
}

/// Whether a task already holds this session's drain slot.
fn is_draining(drains: &Mutex<HashSet<String>>, id: &str) -> bool {
    drains
        .lock()
        .expect("terminal drains poisoned")
        .contains(id)
}

/// Take the drain slot for a session; `false` if a task already holds it.
fn claim_drain(drains: &Mutex<HashSet<String>>, id: &str) -> bool {
    drains
        .lock()
        .expect("terminal drains poisoned")
        .insert(id.to_owned())
}

/// Give the drain slot back once the stream has ended.
fn release_drain(drains: &Mutex<HashSet<String>>, id: &str) {
    drains.lock().expect("terminal drains poisoned").remove(id);
}

/// Pump one session's stream connection into Tauri events until it ends.
///
/// A dumb pump by design: the slow-consumer re-subscribe that used to live here
/// is now the daemon's job, so this task only translates frames to events.
async fn drain_stream(app: AppHandle, mut stream: StreamHandle, id: &str) {
    let output_evt = format!("terminal:output:{id}");
    let status_evt = format!("terminal:status:{id}");
    let exit_evt = format!("terminal:exit:{id}");

    while let Some(frame) = stream.recv().await {
        match frame {
            StreamFrame::Output { seq, data } => {
                // The wire keeps output raw for speed; the Tauri event stays
                // base64 so the frontend contract is untouched.
                let payload = TerminalOutputPayload {
                    id: id.to_owned(),
                    data_b64: B64.encode(&data),
                    seq,
                };
                let _ = app.emit(&output_evt, &payload);
            }
            StreamFrame::Status(raw) => {
                // Retyping the status restores the exact event shape the
                // frontend saw when the manager was in-process. A decode failure
                // means daemon/app protocol skew, which the version check at
                // startup already rules out — drop it rather than emit garbage.
                match serde_json::from_value::<SessionStatus>(raw) {
                    Ok(status) => {
                        // Per-session listeners plus a global roll-up for badges.
                        let _ = app.emit(&status_evt, &status);
                        let _ = app.emit("terminal:status-changed", &status);
                    }
                    Err(e) => warn!("[terminal] malformed status for {id}: {e}"),
                }
            }
            StreamFrame::Exit { exit_code } => {
                let _ = app.emit(
                    &exit_evt,
                    &TerminalExitPayload {
                        id: id.to_owned(),
                        exit_code,
                    },
                );
                return;
            }
            StreamFrame::Error { message } => {
                warn!("[terminal] daemon closed the stream for {id}: {message}");
                return;
            }
        }
    }
}

#[tauri::command]
#[expect(
    clippy::too_many_arguments,
    reason = "each argument is a distinct field of the terminal_start wire contract"
)]
pub async fn terminal_start(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    repo_path: String,
    cwd: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<TerminalSummary, String> {
    let t0 = Instant::now();
    let client = state.client(&app).await?;

    let summary: TerminalSummary = request(
        &client,
        Op::Start {
            terminal_id: terminal_id.clone(),
            repo_path,
            cwd,
            cols,
            rows,
            shell,
        },
    )
    .await?;

    // Subscribe after start (the session now exists); the fresh session's replay
    // is empty, so the drain just carries live output.
    ensure_drain(app, &state, terminal_id.clone()).await;

    info!("[terminal_start] {terminal_id} in {:?}", t0.elapsed());
    Ok(summary)
}

/// Whether embedded terminals are supported right now.
///
/// True only when the daemon can be reached and still answers — the panel gates
/// itself off otherwise. As the frontend's first terminal call this is usually
/// what establishes the connection (see [`TerminalState::client`]). Web mode has
/// no terminals at all: its `/api/terminal/available` route is gone, so the
/// frontend probe fails there and reports unavailable.
#[tauri::command]
pub async fn terminals_available(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
) -> Result<bool, String> {
    let Ok(client) = state.client(&app).await else {
        return Ok(false);
    };
    Ok(client.request(Op::Available).await.is_ok())
}

#[tauri::command]
pub async fn terminal_write(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let client = state.client(&app).await?;
    request(
        &client,
        Op::Write {
            terminal_id,
            // The control channel is JSON; PTY input is arbitrary bytes.
            data_b64: B64.encode(data.as_bytes()),
        },
    )
    .await
}

#[tauri::command]
pub async fn terminal_resize(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let client = state.client(&app).await?;
    request(
        &client,
        Op::Resize {
            terminal_id,
            cols,
            rows,
        },
    )
    .await
}

#[tauri::command]
pub async fn terminal_kill(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
) -> Result<(), String> {
    let client = state.client(&app).await?;
    request(&client, Op::Kill { terminal_id }).await
}

#[tauri::command]
pub async fn terminal_list(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    repo_path: Option<String>,
) -> Result<Vec<TerminalSummary>, String> {
    let client = state.client(&app).await?;
    request(&client, Op::List { repo_path }).await
}

#[tauri::command]
pub async fn terminal_replay(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
) -> Result<TerminalReplay, String> {
    let client = state.client(&app).await?;
    let payload: ReplayPayload = request(
        &client,
        Op::Replay {
            terminal_id: terminal_id.clone(),
        },
    )
    .await?;
    let status: SessionStatus = serde_json::from_value(payload.status)
        .map_err(|e| format!("unexpected daemon response: {e}"))?;

    // A replay is a cold reattach (new window, or the app reopened onto a daemon
    // that kept running) — the only other moment a session needs its stream
    // (re)established.
    ensure_drain(app, &state, terminal_id).await;

    Ok(TerminalReplay {
        data_b64: payload.data_b64,
        cursor: payload.cursor,
        status,
    })
}

#[tauri::command]
pub async fn terminal_peek(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
) -> Result<String, String> {
    let client = state.client(&app).await?;
    request(&client, Op::Peek { terminal_id }).await
}

/// Kill every live session across every repo/window, but keep the daemon
/// serving. This is the governance "shut down all background sessions"
/// action — distinct from quitting the daemon process entirely, which is not
/// exposed to the frontend.
#[tauri::command]
pub async fn terminal_shutdown_all_background(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
) -> Result<(), String> {
    let client = state.client(&app).await?;
    request(&client, Op::ShutdownAllSessions).await
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A state whose daemon has never been contacted — the shape every app
    /// launch starts in. Enough to exercise `ensure_drain`'s bookkeeping, which
    /// never touches the client.
    fn detached_state() -> TerminalState {
        TerminalState::new(PathBuf::from("/nonexistent/daemon.sock"))
    }

    #[test]
    fn output_payload_serializes_camel_case() {
        let payload = TerminalOutputPayload {
            id: "abc".into(),
            data_b64: "AA==".into(),
            seq: 7,
        };
        let value = serde_json::to_value(&payload).unwrap();
        assert_eq!(value["id"], "abc");
        assert_eq!(value["dataB64"], "AA==");
        assert_eq!(value["seq"], 7);
        assert!(value.get("data_b64").is_none());
    }

    #[test]
    fn exit_payload_serializes_camel_case_with_null_code() {
        let payload = TerminalExitPayload {
            id: "x".into(),
            exit_code: None,
        };
        let value = serde_json::to_value(&payload).unwrap();
        assert_eq!(value["id"], "x");
        assert!(value["exitCode"].is_null());
        assert!(value.get("exit_code").is_none());
    }

    #[test]
    fn base64_round_trips_raw_pty_bytes() {
        let raw: &[u8] = b"\x1b]133;A\x07hi\xff\x00world";
        let encoded = B64.encode(raw);
        let decoded = B64.decode(encoded).unwrap();
        assert_eq!(decoded, raw);
    }

    /// The empty slot must actually run the ensure, and a failure must surface
    /// as the user-facing message rather than an internal one.
    #[tokio::test]
    async fn an_empty_slot_ensures_the_daemon() {
        let state = detached_state();
        let mut attempts = 0;

        let error = state
            .establish(|| {
                attempts += 1;
                std::future::ready(Err(anyhow::anyhow!("no sidecar binary")))
            })
            .await
            .unwrap_err();

        assert_eq!(attempts, 1, "the empty slot must attempt an ensure");
        assert_eq!(error, DAEMON_UNAVAILABLE);
    }

    /// A failed ensure must stay retryable — this is the case where the daemon
    /// is fine but the *first* connect timed out (a freshly notarized sidecar
    /// being verified, say). Before, terminals stayed dead for the whole run.
    #[tokio::test]
    async fn a_failed_ensure_is_retried_on_the_next_command() {
        let state = detached_state();
        let mut attempts = 0;

        for _ in 0..2 {
            let _ = state
                .establish(|| {
                    attempts += 1;
                    std::future::ready(Err(anyhow::anyhow!("connect timed out")))
                })
                .await;
        }

        assert_eq!(attempts, 2, "a failure must not poison the slot");
    }

    /// A second `ensure_drain` for a session already being pumped must not start
    /// a second stream — that is what would double-emit output on a hot re-mount
    /// or a repeated `terminal_replay`.
    #[test]
    fn a_session_can_only_be_claimed_once_at_a_time() {
        let state = detached_state();

        assert!(claim_drain(&state.drains, "t1"), "first claim wins");
        assert!(
            !claim_drain(&state.drains, "t1"),
            "a second claim for the same session is refused"
        );
        assert!(
            claim_drain(&state.drains, "t2"),
            "a different session claims independently"
        );
    }

    /// The drain task releases its claim when the stream ends, so a later
    /// `terminal_replay` can re-establish the pump.
    #[test]
    fn a_released_session_can_be_claimed_again() {
        let state = detached_state();

        assert!(claim_drain(&state.drains, "t1"));
        release_drain(&state.drains, "t1");
        assert!(!is_draining(&state.drains, "t1"), "no longer draining");
        assert!(claim_drain(&state.drains, "t1"), "released, so claimable");
    }

    /// `ensure_drain`'s fast path: a session already being pumped is recognized
    /// without opening a second connection to the daemon.
    #[test]
    fn a_claimed_session_reports_as_draining() {
        let state = detached_state();

        assert!(!is_draining(&state.drains, "t1"));
        assert!(claim_drain(&state.drains, "t1"));
        assert!(is_draining(&state.drains, "t1"));
        assert!(!is_draining(&state.drains, "t2"), "only the claimed one");
    }
}
