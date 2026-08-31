//! Tauri command handlers for embedded terminal sessions.
//!
//! These are thin proxies onto the `spur-daemon` process, which owns the one
//! `SessionManager` and therefore the PTYs — that is what lets sessions
//! survive quitting or crashing this app. Each command is one control request
//! over the daemon's Unix socket ([`DaemonClient`]).
//!
//! Two kinds of connection carry what the frontend cannot ask for:
//!
//! - **One events drain per app** ([`spawn_events_drain`]), opened the moment
//!   the control client is established. It carries every session's lifecycle —
//!   including sessions this app never started, which is the whole reason it
//!   exists: a shell begun from the phone, the CLI, or another window is a
//!   thing the app used to learn about only by polling `Op::List`.
//! - **A per-session drain** ([`ensure_drain`]) for each *mounted* pane, which
//!   carries what is addressed to that pane: raw PTY output, its geometry, and
//!   its own exit. An unmounted session costs no connection at all now — the
//!   status-only drains the sidebar used to need are the events channel's job.
//!
//! The two never emit the same event ([`drain_stream`] has the reasoning): a
//! transition the frontend reads as "somebody else did this to me" must arrive
//! exactly once, by exactly one route.
//!
//! The command signatures and emitted event/payload shapes are fixed by the
//! project's canonical wire contract (all JSON `camelCase`) and are unchanged
//! from when the manager ran in-process — the frontend cannot tell the
//! difference.

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::Engine as _;
use log::{error, info, warn};
use serde::Serialize;
use spur::daemon::{
    DaemonClient, Event, EventsHandle, Op, ReplayPayload, StreamFrame, StreamHandle, B64,
};
use spur::terminal::{SessionStatus, TerminalSummary};
use tauri::{AppHandle, Emitter};

use super::daemon;

/// Message returned by every terminal command when the daemon cannot be reached.
/// The panel gates itself off via `terminals_available`, so this is a backstop
/// rather than something a user should normally see.
const DAEMON_UNAVAILABLE: &str = "The terminal daemon is not running. Restart Review to try again.";

/// "Everything you know about the session list may be stale — list again."
/// Emitted on every (re)connect of the events drain and on a `lagged` frame,
/// which are precisely the two moments the channel's ordering guarantee does
/// not hold.
const SESSIONS_INVALIDATED: &str = "terminal:sessions-invalidated";

/// First gap before re-dialing the events channel after it ends, and the
/// ceiling the gap doubles up to. The channel is the app's only push
/// notification about sessions, so it is worth re-dialing indefinitely — a
/// socket connect every few seconds is nothing, and giving up would leave a
/// window that survived a blip showing a session list that stopped moving.
const EVENTS_RETRY_MIN: Duration = Duration::from_millis(100);
const EVENTS_RETRY_MAX: Duration = Duration::from_secs(5);

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
    /// Whether the one events drain has been started. Set once, by whichever
    /// command first established the client; the task itself owns its
    /// reconnects from then on.
    events_drain: AtomicBool,
    /// Sessions with a live output drain, so a re-mount or a repeated
    /// `terminal_replay` cannot start a second stream for the same session.
    ///
    /// Only *mounted* panes appear here. Sidebar dots and titles used to need
    /// a status-only drain per listed session; they ride the events channel
    /// now, so a session nobody is looking at holds no connection at all.
    drains: Arc<Mutex<HashSet<String>>>,
    /// The workspace ids the queue held the last time anything read it — what
    /// [`needs_routing`] answers a `started` frame from without touching the
    /// filesystem. Refreshed by every [`terminal_list`], which reads the queue
    /// anyway.
    ///
    /// Empty means *unpopulated*, never "there are no workspaces": nothing has
    /// read the queue yet, or the read failed. Both are "don't know", which
    /// routes.
    known_workspaces: KnownWorkspaces,
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
            events_drain: AtomicBool::new(false),
            drains: Arc::new(Mutex::new(HashSet::new())),
            known_workspaces: Arc::new(Mutex::new(HashSet::new())),
        }
    }

    /// A cloned control client, attaching to (or spawning) the daemon the first
    /// time one is asked for. Cloning is an `Arc` bump and keeps command futures
    /// free of borrows from Tauri state.
    ///
    /// Also where the app's one events drain is born: the connection existing
    /// is exactly the condition for watching it, and starting the drain here
    /// means no command has to remember to.
    async fn client(&self, app: &AppHandle) -> Result<DaemonClient, String> {
        let client = self.establish(|| daemon::ensure_daemon(app)).await?;
        if !self.events_drain.swap(true, Ordering::Relaxed) {
            spawn_events_drain(
                app.clone(),
                client.clone(),
                Arc::clone(&self.known_workspaces),
            );
        }
        Ok(client)
    }

    /// The control client if one has already been established — never spawning
    /// a daemon to produce one.
    ///
    /// What `workspace_list` uses. Cleanup and derived titles both want the daemon's
    /// answer, but neither is a reason to *start* a daemon, and a
    /// version-mismatch respawn (which kills every live session) is emphatically
    /// not something listing the workspace queue should be able to trigger. Terminal
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

/// The child's exit code (`null` if unknown), under both names it goes out
/// as: `terminal:exit:{id}` for the mounted pane, off that pane's own stream,
/// and `terminal:exited` for the global roll-up, off the events drain. One
/// shape, two audiences — never both for the same listener.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalExitPayload {
    id: String,
    exit_code: Option<i32>,
}

/// `terminal:workspace-assigned` payload — a session moved to another
/// workspace card, or off every card (`null`).
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWorkspaceAssignedPayload {
    id: String,
    workspace_id: Option<String>,
}

/// `terminal:removed` payload — the daemon has stopped listing this session.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRemovedPayload {
    id: String,
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

/// The registry of sessions with a live output drain.
type Drains = Mutex<HashSet<String>>;

/// Workspace ids last seen in the queue — see [`TerminalState::known_workspaces`].
type KnownWorkspaces = Arc<Mutex<HashSet<String>>>;

/// Ensure exactly one task is pumping this session's PTY output into
/// `terminal:output:{id}` events.
///
/// Idempotent: a second call for a session that is already being drained starts
/// no second stream, so a hot re-mount or a repeated `terminal_replay` cannot
/// double-emit. The slot is released when the stream ends, which lets a later
/// call re-establish the pump if the connection dropped.
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
) {
    if is_draining(&state.drains, &terminal_id) {
        return;
    }

    let stream = match client.open_stream(&terminal_id).await {
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
fn is_draining(drains: &Drains, id: &str) -> bool {
    drains
        .lock()
        .expect("terminal drains poisoned")
        .contains(id)
}

/// Take the drain slot for a session; `false` if a task already holds it.
fn claim_drain(drains: &Drains, id: &str) -> bool {
    drains
        .lock()
        .expect("terminal drains poisoned")
        .insert(id.to_owned())
}

/// Give the drain slot back once the stream has ended.
fn release_drain(drains: &Drains, id: &str) {
    drains.lock().expect("terminal drains poisoned").remove(id);
}

/// Pump one mounted pane's stream into Tauri events until it ends.
///
/// **What this emits and what the events drain emits is a split by audience,
/// not by frame type, and the two must not overlap.** Everything here is
/// addressed to *this pane* — `terminal:output:{id}`, `terminal:resized:{id}`,
/// `terminal:exit:{id}` — and the pane reads them as its own stream's history:
/// the registry treats the first resize on the stream as the opening size
/// announcement and every later one as "somebody else resized me", which is
/// what raises the "sized elsewhere" badge. A second copy of a resize arriving
/// from the app-wide drain would badge a pane for its own resize. So geometry
/// and the per-session exit stay here, sourced from the one connection whose
/// ordering the pane is entitled to reason about.
///
/// Status is the exception that proves the rule: it is dropped here because it
/// is not pane-scoped in that sense — the frontend treats each status as a
/// fresh snapshot — and the events drain carries `terminal:status-changed` for
/// every session rather than only mounted ones.
async fn drain_stream(app: AppHandle, mut stream: StreamHandle, id: &str) {
    let output_evt = format!("terminal:output:{id}");
    let resized_evt = format!("terminal:resized:{id}");
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
            StreamFrame::Status(_) => {}
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

/// Start the app's one events drain: every session's lifecycle, re-emitted as
/// the Tauri events the frontend already listens for.
///
/// Runs for the life of the app, re-dialing whenever the connection ends. Each
/// successful open — the first one included — announces
/// [`SESSIONS_INVALIDATED`] first, because the channel's guarantee is only
/// "the list you took *after* opening this, plus every frame since". A list
/// taken before this connection existed, or while it was down, is exactly the
/// list that guarantee does not cover.
fn spawn_events_drain(app: AppHandle, client: DaemonClient, known: KnownWorkspaces) {
    tokio::spawn(async move {
        let mut gap = EVENTS_RETRY_MIN;
        loop {
            match client.open_events().await {
                Ok(events) => {
                    gap = EVENTS_RETRY_MIN;
                    let _ = app.emit(SESSIONS_INVALIDATED, ());
                    drain_events(&app, &client, &known, events).await;
                    warn!("[terminal] the daemon's event channel ended; re-dialing");
                }
                Err(e) => warn!("[terminal] could not watch the daemon's events: {e:#}"),
            }
            tokio::time::sleep(gap).await;
            gap = (gap * 2).min(EVENTS_RETRY_MAX);
        }
    });
}

/// Translate one events connection into Tauri events until it ends.
///
/// One session's frame must never delay another's, so nothing in this loop
/// waits on anything slower than an `emit`. The routing a stray `started`
/// needs — a filesystem walk and a `git` invocation — goes onto its own task
/// for exactly that reason.
async fn drain_events(
    app: &AppHandle,
    client: &DaemonClient,
    known: &KnownWorkspaces,
    mut events: EventsHandle,
) {
    while let Some(event) = events.recv().await {
        match event {
            Event::Started { session } => {
                let mut summary: TerminalSummary = match serde_json::from_value(session) {
                    Ok(summary) => summary,
                    Err(e) => {
                        warn!("[terminal] malformed started event: {e}");
                        continue;
                    }
                };
                let _ = app.emit("terminal:started", &summary);

                // A session can be born anywhere — the CLI, the phone, a raw
                // daemon client — and name a workspace this queue never heard
                // of, which is a terminal the sidebar cannot draw. Settling
                // that costs a filesystem walk and a `git` invocation, so it
                // rides its own task: awaited here it would hold up every
                // other session's events behind one shell's routing.
                //
                // Nothing is lost by going out first. The routing's own
                // `AssignWorkspace` comes back as a `workspaceAssigned` frame,
                // which the frontend applies to the session it already has.
                //
                // And the far commoner case skips the task entirely: this
                // app's own starts route *before* they ask the daemon, so
                // their summary already names a workspace the queue holds.
                if needs_routing(&summary, known) {
                    let client = client.clone();
                    tokio::spawn(async move { reroute_stray(&client, &mut summary).await });
                }
            }
            Event::Status { status } => {
                // Retyping the status restores the exact event shape the
                // frontend saw when the manager was in-process. A decode
                // failure means daemon/app skew, which the version check at
                // startup already rules out — drop it rather than emit garbage.
                match serde_json::from_value::<SessionStatus>(status) {
                    Ok(status) => {
                        // One route, app-wide. Status is not pane-scoped —
                        // every listener treats it as a fresh snapshot keyed by
                        // `status.id` — so a second per-session copy of the
                        // same frame would only be two ways to hear one thing.
                        let _ = app.emit("terminal:status-changed", &status);
                    }
                    Err(e) => warn!("[terminal] malformed status event: {e}"),
                }
            }
            // Deliberately not forwarded: geometry is pane-scoped, and the
            // mounted pane already has it from its own stream. See the split
            // documented on `drain_stream` — a second copy here would badge a
            // pane "sized elsewhere" for a resize it performed itself.
            Event::Resized { .. } => {}
            Event::WorkspaceAssigned {
                terminal_id,
                workspace_id,
            } => {
                let _ = app.emit(
                    "terminal:workspace-assigned",
                    &TerminalWorkspaceAssignedPayload {
                        id: terminal_id,
                        workspace_id,
                    },
                );
            }
            // The global roll-up only. `terminal:exit:{id}` is the mounted
            // pane's own event and comes off its own stream, which is also the
            // connection that has the last of its output ahead of the exit.
            Event::Exited {
                terminal_id,
                exit_code,
            } => {
                let _ = app.emit(
                    "terminal:exited",
                    &TerminalExitPayload {
                        id: terminal_id,
                        exit_code,
                    },
                );
            }
            Event::Removed { terminal_id } => {
                let _ = app.emit(
                    "terminal:removed",
                    &TerminalRemovedPayload { id: terminal_id },
                );
            }
            Event::Lagged => {
                warn!("[terminal] fell behind the daemon's events; re-listing");
                let _ = app.emit(SESSIONS_INVALIDATED, ());
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
#[allow(
    clippy::too_many_arguments,
    reason = "these parameters are the IPC signature the two clients call; \
              collapsing them into a struct changes the wire shape"
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

    // The app's front door routes, exactly as `spur terminal start` does:
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
            spur::workspace::router::route_to(cwd.as_ref(), workspace_id.as_deref())
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
    ensure_drain(app, &state, &client, terminal_id.clone()).await;

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

/// List sessions.
///
/// Opens no connections of its own any more: phase dots and titles for
/// sessions whose pane was never mounted come from the events drain, which
/// covers every session for the price of one connection instead of one each.
///
/// Still the app's reconciler, though: anything that arrives without a
/// workspace it can be shown under is routed here, before the frontend ever
/// sees it. The events drain does the same for each `started` frame, which
/// makes this the backstop for the ways attribution goes stale with nothing
/// starting — a workspace removed by hand, a cleanup sweep while this app was
/// not looking.
#[tauri::command]
pub async fn terminal_list(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    repo_path: Option<String>,
) -> Result<Vec<TerminalSummary>, String> {
    let client = state.client(&app).await?;
    let mut summaries: Vec<TerminalSummary> = request(&client, Op::List { repo_path }).await?;
    reroute_strays(&client, &mut summaries, Some(&state.known_workspaces)).await;
    Ok(summaries)
}

/// Whether a freshly started session has to be routed before the sidebar can
/// draw it — answered from [`TerminalState::known_workspaces`], so the common
/// case costs no queue read at all.
///
/// Wrong in the safe direction only. A cache that has gone stale can say
/// "route" about a session that needs none, which costs one task that finds
/// nothing to do; it cannot say "don't route" about a genuine stray, because
/// an id it has never seen is not in the set, and an unpopulated set (nothing
/// has read the queue, or the read failed) is "don't know" rather than "there
/// are no workspaces".
fn needs_routing(summary: &TerminalSummary, known: &KnownWorkspaces) -> bool {
    let Some(workspace_id) = summary.workspace_id.as_ref() else {
        return true;
    };
    let known = known.lock().expect("known workspaces poisoned");
    known.is_empty() || !known.contains(workspace_id)
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
/// shell — on every `terminal_list`, rewrote `workspaces.json`, fired a work-changed
/// event, and left phantoms in the queue that were reaped and re-minted on the
/// next list. Nothing downstream can undo that; only not asking can.
///
/// [`land`]: spur::workspace::router::land
async fn reroute_strays(
    client: &DaemonClient,
    summaries: &mut [TerminalSummary],
    known: Option<&KnownWorkspaces>,
) {
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

    let landed = route_strays(listed, known).await;
    apply_landings(client, summaries, landed).await;
}

/// [`reroute_strays`] for one session, which is what the events drain has: a
/// `started` frame carries a single summary, and the routing question it asks
/// is the same one, so it asks it the same way rather than in a second copy.
async fn reroute_stray(client: &DaemonClient, summary: &mut TerminalSummary) {
    // Refreshes no cache: this runs off a `started` frame, one session at a
    // time and often concurrently, and the queue read it makes covers only
    // whatever moment that one session happened to ask in. `terminal_list`
    // owns the cache, because a list is the read that saw the whole queue.
    reroute_strays(client, std::slice::from_mut(summary), None).await;
}

/// Decide a workspace for each `(id, workspace_id, cwd)` the queue cannot
/// already show, off-thread. Returns only the sessions that need moving.
async fn route_strays(
    listed: Vec<(String, Option<String>, String)>,
    cache: Option<&KnownWorkspaces>,
) -> HashMap<String, String> {
    let routed = tokio::task::spawn_blocking(move || {
        let known: HashSet<String> = match spur::workspace::list() {
            Ok(state) => state.workspaces.into_iter().map(|ws| ws.id).collect(),
            Err(e) => {
                // Unreadable queue: every session would look like a stray, so
                // routing them all would be maximally wrong. Do nothing — and
                // report an empty set, which the cache reads as "don't know".
                warn!("[terminal] could not read the workspace queue: {e}");
                return (HashSet::new(), HashMap::new());
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
            let location = spur::workspace::router::locate(cwd.as_ref());
            match spur::workspace::router::land(&location, None) {
                Ok(landing) => {
                    by_cwd.insert(cwd, landing.workspace.id.clone());
                    landed.insert(id, landing.workspace.id);
                }
                Err(e) => warn!("[terminal] could not route {id}: {e}"),
            }
        }
        (known, landed)
    })
    .await;

    match routed {
        Ok((known, landed)) => {
            if let Some(cache) = cache {
                // The queue as this read saw it, plus whatever `land` minted
                // afterwards — `known` was taken before the routing loop, so
                // the new workspaces are not in it, and leaving them out would
                // make the next `started` re-route a session that just landed.
                let mut cache = cache.lock().expect("known workspaces poisoned");
                *cache = known;
                cache.extend(landed.values().cloned());
            }
            landed
        }
        Err(e) => {
            warn!("[terminal] routing panicked: {e}");
            HashMap::new()
        }
    }
}

/// Tell the daemon where each stray landed, and patch the summaries so the
/// caller's copy agrees without a second `Op::List`.
async fn apply_landings(
    client: &DaemonClient,
    summaries: &mut [TerminalSummary],
    landed: HashMap<String, String>,
) {
    // Already only the strays — see the filter in `route_strays`.
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

    // A replay is a pane mounting — a cold reattach (new window, or the app
    // reopened onto a daemon that kept running), or a re-mount. It is the one
    // moment a session needs its own connection: nothing else this app does
    // wants raw PTY bytes.
    ensure_drain(app, &state, &client, terminal_id).await;

    Ok(TerminalReplay {
        data_b64: payload.data_b64,
        cursor: payload.cursor,
        status,
    })
}

/// Every named session's visible screen, in one round trip.
///
/// What the terminal overview polls, and the only peek this app makes: a grid
/// of N cards was N single-session peeks every two seconds, N control round
/// trips and N renders, for a screen that shows them side by side. Ids the
/// daemon does not know are absent from the map rather than an error — a card
/// whose session has just gone is a missing entry, not a failed poll for every
/// other card on screen.
#[tauri::command]
pub async fn terminal_peek_many(
    app: AppHandle,
    state: tauri::State<'_, TerminalState>,
    terminal_ids: Vec<String>,
) -> Result<HashMap<String, String>, String> {
    let client = state.client(&app).await?;
    client
        .peek_many(&terminal_ids)
        .await
        .map_err(|e| format!("{e:#}"))
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

    /// The `started` fast path: a session already sitting in a workspace the
    /// queue holds is drawn where it says it is, and nothing walks a filesystem
    /// to confirm it. Everything else routes — including when the cache has
    /// never been filled, which is "don't know" rather than "no workspaces".
    #[test]
    fn only_a_session_the_queue_can_already_show_skips_routing() {
        // Through the wire shape, which is how a real one arrives.
        fn summary(workspace_id: Option<&str>) -> TerminalSummary {
            serde_json::from_value(serde_json::json!({
                "id": "t1",
                "repoPath": "/repo",
                "workspaceId": workspace_id,
                "cwd": "/repo",
                "title": null,
                "cols": 80,
                "rows": 24,
                "status": {
                    "id": "t1",
                    "phase": "idle",
                    "attentionMessage": null,
                    "runningCommand": null,
                    "lastExitCode": null,
                    "cwd": null,
                    "title": null,
                    "enteredStateAt": 0,
                    "shellIntegrationActive": false,
                },
            }))
            .expect("a summary in its wire shape")
        }

        let known: KnownWorkspaces = Arc::new(Mutex::new(HashSet::new()));
        assert!(
            needs_routing(&summary(Some("aaaa1111")), &known),
            "an unpopulated cache knows nothing, so it cannot vouch for anything"
        );

        known.lock().unwrap().insert("aaaa1111".to_owned());
        assert!(!needs_routing(&summary(Some("aaaa1111")), &known));
        assert!(needs_routing(&summary(Some("bbbb2222")), &known));
        assert!(needs_routing(&summary(None), &known));
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

    #[test]
    fn workspace_and_removed_payloads_serialize_camel_case() {
        let assigned = serde_json::to_value(TerminalWorkspaceAssignedPayload {
            id: "t1".into(),
            workspace_id: None,
        })
        .unwrap();
        assert_eq!(assigned["id"], "t1");
        assert!(
            assigned["workspaceId"].is_null(),
            "off every card is null, not a missing key"
        );
        assert!(assigned.get("workspace_id").is_none());

        let removed = serde_json::to_value(TerminalRemovedPayload { id: "t2".into() }).unwrap();
        assert_eq!(removed["id"], "t2");
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

    /// The events drain is started once and only once, however many commands
    /// race to establish the client — a second one would double every status,
    /// exit and start event the frontend sees.
    #[test]
    fn the_events_drain_is_claimed_once() {
        let state = detached_state();

        assert!(
            !state.events_drain.swap(true, Ordering::Relaxed),
            "the first caller starts it"
        );
        assert!(
            state.events_drain.swap(true, Ordering::Relaxed),
            "every later caller finds it already running"
        );
    }
}
