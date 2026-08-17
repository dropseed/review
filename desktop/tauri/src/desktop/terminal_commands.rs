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

use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use base64::Engine as _;
use log::{error, info, warn};
use review::daemon::{DaemonClient, Op, ReplayPayload, StreamFrame, StreamHandle, B64};
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
    /// Sessions with a live drain task, so a re-mount or a repeated
    /// `terminal_replay` cannot start a second stream for the same session.
    ///
    /// The flag is whether the drain forwards raw output. `terminal_list`
    /// opens status-only drains (`false`) so sidebar dots and titles stay live
    /// for sessions whose pane was never mounted; opening a pane upgrades the
    /// drain in place (`terminal_start`/`terminal_replay` pass `true`).
    drains: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

impl Default for TerminalState {
    fn default() -> Self {
        Self::new()
    }
}

impl TerminalState {
    /// State for a daemon that has not been contacted yet.
    pub fn new() -> Self {
        Self {
            client: tokio::sync::Mutex::new(None),
            drains: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// A cloned control client, attaching to (or spawning) the daemon the first
    /// time one is asked for. Cloning is an `Arc` bump and keeps command futures
    /// free of borrows from Tauri state.
    async fn client(&self, app: &AppHandle) -> Result<DaemonClient, String> {
        self.establish(|| daemon::ensure_daemon(app)).await
    }

    /// The control client if one has already been established — never spawning
    /// a daemon to produce one.
    ///
    /// What `work_list` uses. Cleanup and derived titles both want the daemon's
    /// answer, but neither is a reason to *start* a daemon, and a
    /// version-mismatch respawn (which kills every live session) is emphatically
    /// not something listing the work queue should be able to trigger. Terminal
    /// commands open the connection; this rides along once it exists, and treats
    /// "not yet" as "don't know".
    pub async fn connected(&self) -> Option<DaemonClient> {
        self.client.lock().await.clone()
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

/// `terminal:resized:{id}` payload — the PTY's new size, after any client
/// (this window, another window, the CLI, a browser tab) resized it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizedPayload {
    id: String,
    cols: u16,
    rows: u16,
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
    client.request_as(op).await.map_err(|e| format!("{e:#}"))
}

/// The per-session drain registry: session id → "forward raw output" flag.
type Drains = Mutex<HashMap<String, Arc<AtomicBool>>>;

/// Ensure exactly one task is pumping this session's daemon stream into Tauri
/// events.
///
/// Idempotent: a second call for a session that is already being drained
/// starts no second stream, so a hot re-mount or a repeated `terminal_replay`
/// cannot double-emit — but if it asks for output on a status-only drain, the
/// existing drain is upgraded in place. The slot is released when the stream
/// ends, which lets a later call re-establish the pump if the connection
/// dropped.
///
/// The subscription is established *before* the calling command returns. The
/// daemon discards a fresh subscription's scrollback (clients are expected to
/// fetch it with `Op::Replay`), and a freshly started session is the one case
/// where the frontend never replays — so anything written between subscribing
/// and returning would simply be lost. Connecting first also makes this
/// cancellation-safe: the slot is claimed only once there is a stream to hand
/// to the task that will release it.
async fn ensure_drain(
    app: AppHandle,
    state: &TerminalState,
    client: &DaemonClient,
    terminal_id: String,
    output: bool,
) {
    if upgrade_drain(&state.drains, &terminal_id, output) {
        return;
    }

    let stream = match client.open_stream(&terminal_id).await {
        Ok(stream) => stream,
        Err(e) => {
            warn!("[terminal] could not open the output stream for {terminal_id}: {e}");
            return;
        }
    };
    let Some(emit_output) = claim_drain(&state.drains, &terminal_id, output) else {
        // Another call won the race while we were connecting (claim_drain
        // already applied any upgrade to the winner); drop this connection,
        // which drops its daemon-side subscription.
        return;
    };

    let drains = Arc::clone(&state.drains);
    tokio::spawn(async move {
        drain_stream(app, stream, &terminal_id, &emit_output).await;
        release_drain(&drains, &terminal_id);
    });
}

/// If a task already holds this session's drain slot, note it — upgrading the
/// drain to forward output when asked to — and return `true`.
fn upgrade_drain(drains: &Drains, id: &str, output: bool) -> bool {
    match drains.lock().expect("terminal drains poisoned").get(id) {
        Some(emit_output) => {
            if output {
                emit_output.store(true, Ordering::Relaxed);
            }
            true
        }
        None => false,
    }
}

/// Take the drain slot for a session, returning its output flag; `None` if a
/// task already holds it (upgraded, as in [`upgrade_drain`]).
fn claim_drain(drains: &Drains, id: &str, output: bool) -> Option<Arc<AtomicBool>> {
    match drains
        .lock()
        .expect("terminal drains poisoned")
        .entry(id.to_owned())
    {
        Entry::Occupied(existing) => {
            if output {
                existing.get().store(true, Ordering::Relaxed);
            }
            None
        }
        Entry::Vacant(slot) => Some(Arc::clone(slot.insert(Arc::new(AtomicBool::new(output))))),
    }
}

/// Give the drain slot back once the stream has ended.
fn release_drain(drains: &Drains, id: &str) {
    drains.lock().expect("terminal drains poisoned").remove(id);
}

/// Pump one session's stream connection into Tauri events until it ends.
///
/// A dumb pump by design: the slow-consumer re-subscribe that used to live here
/// is now the daemon's job, so this task only translates frames to events.
/// Output frames are dropped while `emit_output` is false (a status-only drain
/// for a session no pane has attached to) — the pane that eventually attaches
/// replays scrollback and dedups by `seq`, so nothing is lost by skipping.
async fn drain_stream(
    app: AppHandle,
    mut stream: StreamHandle,
    id: &str,
    emit_output: &AtomicBool,
) {
    let output_evt = format!("terminal:output:{id}");
    let status_evt = format!("terminal:status:{id}");
    let resized_evt = format!("terminal:resized:{id}");
    let exit_evt = format!("terminal:exit:{id}");

    while let Some(frame) = stream.recv().await {
        match frame {
            StreamFrame::Output { seq, data } => {
                if !emit_output.load(Ordering::Relaxed) {
                    continue;
                }
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
            // Not gated on `emit_output`: a status-only drain still carries
            // geometry, so a pane that mounts later starts at the right grid.
            StreamFrame::Resized { cols, rows } => {
                let _ = app.emit(
                    &resized_evt,
                    &TerminalResizedPayload {
                        id: id.to_owned(),
                        cols,
                        rows,
                    },
                );
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

/// What `terminal_start` answers with: the session, and where it landed.
///
/// The landing rides along because the app has the same question the CLI does
/// — "which workspace is this terminal in, and did opening it invent one?" —
/// and the frontend needs the answer to draw the session at all: it groups
/// terminals by `workspaceId`, so a workspace the queue hasn't heard of yet is
/// a terminal with nowhere to appear.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStarted {
    session: TerminalSummary,
    workspace: LandedIn,
}

/// The landing, flattened to what a client actually reads: which workspace,
/// and whether the queue has to go and fetch it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandedIn {
    id: String,
    /// Whether getting here minted the workspace — a queue entry the frontend
    /// does not have yet.
    created: bool,
}

#[tauri::command]
pub async fn terminal_start(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    repo_path: String,
    cwd: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
    workspace_id: Option<String>,
) -> Result<TerminalStarted, String> {
    let t0 = Instant::now();
    let client = state.client(&app).await?;

    // An empty cwd means the caller has no directory to offer: a workspace
    // holding no claim has none of its own, and the *previous* screen's
    // checkout is the one directory it must not inherit. Home is the neutral
    // answer (see `router::land`).
    let cwd = if cwd.is_empty() {
        dirs::home_dir()
            .ok_or("Could not determine the home directory.")?
            .to_string_lossy()
            .into_owned()
    } else {
        cwd
    };

    // The app's front door routes, exactly as `review terminal start` does:
    // every session is born in a workspace, and the daemon is told which one at
    // birth rather than being asked to guess later. Off-thread because routing
    // walks the filesystem and shells out to git.
    //
    // `workspace_id` is the caller naming the workspace — the stage's own "+",
    // which knows which workspace the user is looking at. Naming one lands the
    // session there and writes nothing: what a workspace shows is answered by
    // its repo tabs, not by where a shell happened to open.
    let landing = {
        let cwd = cwd.clone();
        tokio::task::spawn_blocking(move || {
            review::work::router::route_to(cwd.as_ref(), workspace_id.as_deref())
        })
        .await
        .map_err(|e| format!("routing panicked: {e}"))?
        .map_err(|e| e.to_string())?
    };

    let summary: TerminalSummary = request(
        &client,
        Op::Start {
            terminal_id: terminal_id.clone(),
            repo_path,
            cwd,
            cols,
            rows,
            shell,
            workspace_id: Some(landing.workspace.id.clone()),
        },
    )
    .await?;

    // Subscribe after start (the session now exists); the fresh session's replay
    // is empty, so the drain just carries live output.
    ensure_drain(app, &state, &client, terminal_id.clone(), true).await;

    info!(
        "[terminal_start] {terminal_id} in {} in {:?}",
        landing.workspace.id,
        t0.elapsed()
    );
    Ok(TerminalStarted {
        session: summary,
        workspace: LandedIn {
            id: landing.workspace.id,
            created: landing.created,
        },
    })
}

/// Move a session to another workspace — the drag of a terminal onto a card.
///
/// Attribution is the daemon's, so this is the only way the app changes it;
/// there is no second copy of the answer to keep in step.
#[tauri::command]
pub async fn terminal_assign_workspace(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    workspace_id: Option<String>,
) -> Result<(), String> {
    let client = state.client(&app).await?;
    request(
        &client,
        Op::AssignWorkspace {
            terminal_id,
            workspace_id,
        },
    )
    .await
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
    client
        .write(&terminal_id, data.as_bytes())
        .await
        .map_err(|e| e.to_string())
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

/// List sessions — and make sure each one has at least a status-only drain, so
/// sidebar phase dots and titles keep updating for sessions whose pane was
/// never opened in this app run. Restored sessions otherwise only ever show
/// the snapshot taken here.
///
/// Also the app's reconciler: anything that arrives without a workspace it can
/// be shown under is routed here, before the frontend ever sees it.
#[tauri::command]
pub async fn terminal_list(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    repo_path: Option<String>,
) -> Result<Vec<TerminalSummary>, String> {
    let client = state.client(&app).await?;
    let mut summaries: Vec<TerminalSummary> = request(&client, Op::List { repo_path }).await?;
    reroute_strays(&client, &mut summaries).await;
    for summary in &summaries {
        ensure_drain(app.clone(), &state, &client, summary.id.to_string(), false).await;
    }
    Ok(summaries)
}

/// Give every session a workspace the queue can actually show it under.
///
/// Sessions are born routed on both surfaces, so this is a fallback, not a
/// path — but the ways attribution can go stale are real and all lead to the
/// same place: a session whose workspace nobody has heard of is a terminal the
/// sidebar cannot draw. It happens when a raw daemon client started one, when
/// the workspace was removed by hand, and when cleanup reaped one while this app
/// was not looking.
///
/// Re-routing by the session's own cwd is what makes it self-healing rather than
/// arbitrary: it lands wherever anything else in that directory lands. Failures
/// are logged and left — the next list tries again.
///
/// **The stray filter runs before any routing, and that ordering is the whole
/// correctness of this function.** [`land`] is a *write*: it mints a workspace
/// whenever nothing is attached to the directory. Routing every listed session
/// and filtering afterwards therefore invented a workspace for each correctly
/// attributed shell — one per checked-out-elsewhere branch, one per `$HOME`
/// shell — on every `terminal_list`, rewrote `work.json`, fired a work-changed
/// event, and left phantoms in the queue that were reaped and re-minted on the
/// next list. Nothing downstream can undo that; only not asking can.
///
/// [`land`]: review::work::router::land
async fn reroute_strays(client: &DaemonClient, summaries: &mut [TerminalSummary]) {
    // One blocking hop for the whole reconcile, not one per stray. The first
    // list on a fresh build is exactly the case where *every* session is a
    // stray — attribution is younger than the sessions — so the K-stray path
    // is the one that has to be cheap, not the zero-stray one.
    let listed: Vec<(String, Option<String>, String)> = summaries
        .iter()
        .map(|summary| {
            (
                summary.id.to_string(),
                summary.workspace_id.clone(),
                summary.cwd.clone(),
            )
        })
        .collect();

    let routed = tokio::task::spawn_blocking(move || {
        let known: HashSet<String> = match review::work::list() {
            Ok(state) => state.workspaces.into_iter().map(|ws| ws.id).collect(),
            Err(e) => {
                // Unreadable queue: every session would look like a stray, so
                // routing them all would be maximally wrong. Do nothing.
                warn!("[terminal] could not read the work queue: {e}");
                return HashMap::new();
            }
        };

        // Locating a directory walks the filesystem and shells out to git, so
        // sessions sharing a cwd — several shells in one checkout, the common
        // shape — resolve it once between them.
        let mut by_cwd: HashMap<String, String> = HashMap::new();
        let mut landed: HashMap<String, String> = HashMap::new();
        for (id, workspace_id, cwd) in listed {
            // A session the queue can already show is left alone entirely.
            if workspace_id.is_some_and(|id| known.contains(&id)) {
                continue;
            }
            if let Some(workspace_id) = by_cwd.get(&cwd) {
                landed.insert(id, workspace_id.clone());
                continue;
            }
            let location = review::work::router::locate(cwd.as_ref());
            match review::work::router::land(&location, None) {
                Ok(landing) => {
                    by_cwd.insert(cwd, landing.workspace.id.clone());
                    landed.insert(id, landing.workspace.id);
                }
                Err(e) => warn!("[terminal] could not route {id}: {e}"),
            }
        }
        landed
    })
    .await;

    let landed = match routed {
        Ok(landed) => landed,
        Err(e) => {
            warn!("[terminal] routing panicked: {e}");
            return;
        }
    };

    // Already only the strays — see the filter above.
    let assignments = summaries
        .iter()
        .filter_map(|summary| {
            let workspace_id = landed.get(&summary.id.to_string())?.clone();
            let id = summary.id.to_string();
            Some(async move {
                let result = client
                    .request(Op::AssignWorkspace {
                        terminal_id: id.clone(),
                        workspace_id: Some(workspace_id.clone()),
                    })
                    .await;
                (id, workspace_id, result)
            })
        })
        .collect::<Vec<_>>();

    if assignments.is_empty() {
        return;
    }

    for (id, workspace_id, result) in futures::future::join_all(assignments).await {
        match result {
            Ok(_) => {
                info!("[terminal] re-routed {id} into {workspace_id}");
                if let Some(summary) = summaries.iter_mut().find(|s| s.id.to_string() == id) {
                    summary.workspace_id = Some(workspace_id);
                }
            }
            Err(e) => warn!("[terminal] could not attribute {id}: {e:#}"),
        }
    }
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
    // that kept running). If `terminal_list` already opened a status-only drain
    // for this session, this upgrades it to carry output.
    ensure_drain(app, &state, &client, terminal_id, true).await;

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
        TerminalState::new()
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

        assert!(
            claim_drain(&state.drains, "t1", true).is_some(),
            "first claim wins"
        );
        assert!(
            claim_drain(&state.drains, "t1", true).is_none(),
            "a second claim for the same session is refused"
        );
        assert!(
            claim_drain(&state.drains, "t2", true).is_some(),
            "a different session claims independently"
        );
    }

    /// The drain task releases its claim when the stream ends, so a later
    /// `terminal_replay` can re-establish the pump.
    #[test]
    fn a_released_session_can_be_claimed_again() {
        let state = detached_state();

        assert!(claim_drain(&state.drains, "t1", true).is_some());
        release_drain(&state.drains, "t1");
        assert!(
            !upgrade_drain(&state.drains, "t1", false),
            "no longer draining"
        );
        assert!(
            claim_drain(&state.drains, "t1", true).is_some(),
            "released, so claimable"
        );
    }

    /// `ensure_drain`'s fast path: a session already being pumped is recognized
    /// without opening a second connection to the daemon.
    #[test]
    fn a_claimed_session_reports_as_draining() {
        let state = detached_state();

        assert!(!upgrade_drain(&state.drains, "t1", false));
        assert!(claim_drain(&state.drains, "t1", true).is_some());
        assert!(upgrade_drain(&state.drains, "t1", false));
        assert!(
            !upgrade_drain(&state.drains, "t2", false),
            "only the claimed one"
        );
    }

    /// A status-only drain (opened by `terminal_list`) starts with output off,
    /// and a later output claim for the same session — a pane attaching —
    /// flips the *existing* drain's flag rather than starting a second stream.
    #[test]
    fn an_output_claim_upgrades_a_status_only_drain() {
        let state = detached_state();

        let flag = claim_drain(&state.drains, "t1", false).expect("first claim wins");
        assert!(
            !flag.load(Ordering::Relaxed),
            "status-only until a pane attaches"
        );

        assert!(claim_drain(&state.drains, "t1", true).is_none());
        assert!(
            flag.load(Ordering::Relaxed),
            "racing claim upgraded the holder"
        );
    }

    /// The fast path applies the same upgrade: asking for output on an existing
    /// status-only drain flips it, while a status-only ask leaves it alone.
    #[test]
    fn the_fast_path_upgrades_but_never_downgrades() {
        let state = detached_state();

        let flag = claim_drain(&state.drains, "t1", false).unwrap();
        assert!(upgrade_drain(&state.drains, "t1", false));
        assert!(
            !flag.load(Ordering::Relaxed),
            "status-only ask changes nothing"
        );

        assert!(upgrade_drain(&state.drains, "t1", true));
        assert!(flag.load(Ordering::Relaxed), "output ask upgrades");

        assert!(upgrade_drain(&state.drains, "t1", false));
        assert!(flag.load(Ordering::Relaxed), "and never downgrades");
    }
}
