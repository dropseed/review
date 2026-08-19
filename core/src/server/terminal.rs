//! Web-mode terminal bridge: `/api/terminal/*` onto the `review-daemon`.
//!
//! PTYs live in the daemon process (see [`crate::daemon`]), never here. This
//! module is a **thin client** of the daemon's Unix control socket in exactly
//! the sense the desktop app is: it attaches to a daemon that is already
//! running and never spawns one. A browser tab therefore drives the same
//! sessions the desktop app does, and closing either leaves them alone.
//!
//! Two transports, matching what `desktop/ui/api/` speaks:
//!
//! - **POST** for control (start/write/resize/kill/list/replay/peek), mirroring
//!   the semantics of `desktop/tauri/src/desktop/terminal_commands.rs`.
//! - **One WebSocket per session** (`/api/terminal/{id}/ws`) for live output,
//!   which is where the Tauri path emits `terminal:output:{id}` events instead.
//!   The wire is fixed by `desktop/ui/api/terminal-socket.ts`: server→client
//!   binary frames are `[8-byte BE u64 seq][raw PTY bytes]`, text frames are
//!   `{"t":"status",…}` / `{"t":"resize","cols":N,"rows":N}` (another client
//!   resized the shared PTY) / `{"t":"exit","exitCode":…}`; client→server
//!   binary is stdin and text is `{"t":"resize","cols":N,"rows":N}`.
//!
//! Control payloads pass straight through as `serde_json::Value` — the daemon
//! already speaks the frontend's camelCase, and re-typing them would drag
//! `crate::terminal` (and its PTY stack, and Zig) into every web build. See the
//! decoupling note in [`crate::daemon::protocol`].

use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, post};
use axum::{Json, Router};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::handlers::{internal_err, ApiResult};
use super::origin_allowed;
use crate::daemon::{
    DaemonClient, Op, StreamFrame, StreamHandle, ERR_CLOSED, ERR_CONNECTING, ERR_SENDING,
};

/// Close code meaning "this session no longer exists" — the one close the
/// frontend must not retry (`SESSION_GONE_CODE` in `terminal-socket.ts`).
const SESSION_GONE: u16 = 4404;

/// How often an idle socket is pinged.
const KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);

/// How long a socket may go without *any* inbound frame — a pong included —
/// before it is treated as half-open and dropped. Two and a half intervals, so
/// one lost ping is not a disconnect.
const KEEPALIVE_TIMEOUT: Duration = Duration::from_secs(75);

// ============================================================
// Shared state
// ============================================================

/// The web server's handle on the terminal daemon.
///
/// Cheap to clone (one `Arc`), so it rides in axum `State` and every handler
/// gets its own copy without borrowing from the router.
#[derive(Clone, Debug, Default)]
pub(super) struct TerminalBridge {
    inner: Arc<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    /// The socket to dial, when something other than the review home's default
    /// decides it (tests). `None` resolves [`crate::daemon::socket_path`] at
    /// use time, so a server started before the review home exists still works.
    socket: Option<PathBuf>,
    /// The control connection, established on **first use** — a web server that
    /// nobody opens a terminal in never talks to the daemon at all, and a failed
    /// first attempt leaves the slot empty so the next request retries.
    client: tokio::sync::Mutex<Option<DaemonClient>>,
}

impl TerminalBridge {
    /// A bridge onto the review home's daemon socket.
    pub(super) fn new() -> Self {
        Self::default()
    }

    /// A bridge onto an explicit socket — the daemon test harness's.
    #[cfg(test)]
    fn with_socket(socket: PathBuf) -> Self {
        Self {
            inner: Arc::new(Inner {
                socket: Some(socket),
                client: tokio::sync::Mutex::new(None),
            }),
        }
    }

    fn socket(&self) -> anyhow::Result<PathBuf> {
        match &self.inner.socket {
            Some(socket) => Ok(socket.clone()),
            None => crate::daemon::socket_path(),
        }
    }

    /// A cloned control client, connecting on first use.
    ///
    /// The lock is held across the connect so concurrent requests queue behind
    /// one attempt rather than opening a connection each.
    async fn client(&self) -> anyhow::Result<DaemonClient> {
        let mut slot = self.inner.client.lock().await;
        if let Some(client) = slot.as_ref() {
            return Ok(client.clone());
        }
        let client = DaemonClient::connect(&self.socket()?).await?;
        Ok(slot.insert(client).clone())
    }

    /// Run one daemon call, reconnecting once if the cached connection turned
    /// out to be dead.
    ///
    /// The desktop deliberately never reconnects: a daemon that dies takes its
    /// sessions with it, so relaunching the app is the honest recovery. This
    /// process is longer-lived than any of that — the desktop app may restart
    /// the daemon (a version-mismatch respawn) while a browser tab sits open —
    /// and a web server that had to be restarted to notice would be a worse
    /// answer than one stale request.
    async fn with_client<T, F, Fut>(&self, call: F) -> anyhow::Result<T>
    where
        F: Fn(DaemonClient) -> Fut,
        Fut: Future<Output = anyhow::Result<T>>,
    {
        let client = self.client().await?;
        match call(client.clone()).await {
            Err(e) if is_disconnected(&e) => {
                log::warn!("[terminal] daemon connection lost ({e:#}); reconnecting");
                // Only discard the connection *this* call failed on. Several
                // requests fail together when a daemon goes away, and without
                // this check the second one to notice would evict the healthy
                // connection the first already reconnected — a stampede where
                // each reconnect is undone by the next.
                {
                    let mut slot = self.inner.client.lock().await;
                    if slot
                        .as_ref()
                        .is_some_and(|cached| cached.is_same_connection(&client))
                    {
                        slot.take();
                    }
                }
                let client = self.client().await?;
                call(client).await
            }
            other => other,
        }
    }

    /// One control op, with the reconnect retry around it.
    async fn request(&self, op: Op) -> anyhow::Result<Value> {
        self.with_client(|client| {
            let op = op.clone();
            async move { client.request(op).await }
        })
        .await
    }

    /// One control op whose Ok payload is decoded into `T`.
    async fn request_as<T: serde::de::DeserializeOwned>(&self, op: Op) -> anyhow::Result<T> {
        let value = self.request(op).await?;
        Ok(serde_json::from_value(value)?)
    }
}

/// Whether this failure means the connection is gone rather than the op is bad.
///
/// A daemon-side "no such terminal t9" travels as a plain message and must not
/// cost a reconnect; the three ways a *transport* dies all name themselves. The
/// names are the client's own consts, so a reworded error there breaks this
/// build rather than quietly turning reconnection off.
fn is_disconnected(e: &anyhow::Error) -> bool {
    let text = format!("{e:#}");
    [ERR_CLOSED, ERR_SENDING, ERR_CONNECTING]
        .iter()
        .any(|marker| text.contains(marker))
}

// ============================================================
// Routes
// ============================================================

/// The `/api/terminal/*` routes, already carrying their state.
pub(super) fn router(bridge: TerminalBridge) -> Router {
    Router::new()
        .route("/api/terminal/available", post(available))
        .route("/api/terminal/start", post(start))
        .route("/api/terminal/assign-workspace", post(assign_workspace))
        .route("/api/terminal/write", post(write_stdin))
        .route("/api/terminal/resize", post(resize))
        .route("/api/terminal/kill", post(kill))
        .route("/api/terminal/list", post(list))
        .route("/api/terminal/replay", post(replay))
        .route("/api/terminal/peek", post(peek))
        .route("/api/terminal/{id}/ws", any(ws))
        .with_state(bridge)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest {
    terminal_id: String,
    repo_path: String,
    cwd: String,
    cols: u16,
    rows: u16,
    #[serde(default)]
    shell: Option<String>,
    #[serde(default)]
    workspace_id: Option<String>,
}

/// What `start` answers with: the session, and where it landed — the same shape
/// the Tauri `terminal_start` returns, because the frontend groups terminals by
/// `workspaceId` and a workspace the queue has not heard of yet is a terminal
/// with nowhere to appear.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Started {
    /// A `TerminalSummary`, passed through as the daemon sent it.
    session: Value,
    workspace: LandedIn,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LandedIn {
    id: String,
    /// Whether getting here minted the workspace.
    created: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalIdRequest {
    terminal_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AssignWorkspaceRequest {
    terminal_id: String,
    #[serde(default)]
    workspace_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteRequest {
    terminal_id: String,
    /// Plain UTF-8 stdin; the base64 the control wire wants is added below.
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeRequest {
    terminal_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ListRequest {
    #[serde(default)]
    repo_path: Option<String>,
}

/// Whether terminals work right now — the frontend's gate on the whole panel.
///
/// No daemon is an answer, not an error: web mode is often run against a
/// machine with nothing started, and the panel simply hides itself.
async fn available(State(bridge): State<TerminalBridge>) -> Json<bool> {
    match bridge.request(Op::Available).await {
        Ok(_) => Json(true),
        Err(e) => {
            log::debug!("[terminal_available] no daemon: {e:#}");
            Json(false)
        }
    }
}

/// Start a session, routing its cwd to a workspace first.
///
/// Mirrors the desktop's `terminal_start`: every session is born in a
/// workspace, and the daemon is told which one at birth rather than being asked
/// to guess later. Naming `workspaceId` lands it there and writes nothing.
async fn start(
    State(bridge): State<TerminalBridge>,
    Json(request): Json<StartRequest>,
) -> ApiResult<Started> {
    let t0 = Instant::now();

    // An empty cwd means the caller has no directory to offer, and the previous
    // screen's checkout is the one directory it must not inherit. Home is the
    // neutral answer (see `router::land`).
    let cwd = if request.cwd.is_empty() {
        dirs::home_dir()
            .ok_or_else(|| internal_err("Could not determine the home directory."))?
            .to_string_lossy()
            .into_owned()
    } else {
        request.cwd
    };

    // Off-thread: routing walks the filesystem and shells out to git.
    let landing = {
        let cwd = cwd.clone();
        let workspace_id = request.workspace_id;
        tokio::task::spawn_blocking(move || {
            crate::work::router::route_to(cwd.as_ref(), workspace_id.as_deref())
        })
        .await
        .map_err(internal_err)?
        .map_err(internal_err)?
    };

    let session = bridge
        .request(Op::Start {
            terminal_id: request.terminal_id.clone(),
            repo_path: request.repo_path,
            cwd,
            cols: request.cols,
            rows: request.rows,
            shell: request.shell,
            workspace_id: Some(landing.workspace.id.clone()),
        })
        .await
        .map_err(internal_err)?;

    log::info!(
        "[terminal_start] {} in {} in {:?}",
        request.terminal_id,
        landing.workspace.id,
        t0.elapsed()
    );
    Ok(Json(Started {
        session,
        workspace: LandedIn {
            id: landing.workspace.id,
            created: landing.created,
        },
    }))
}

/// Move a session to another workspace — the drag of a terminal onto a card.
async fn assign_workspace(
    State(bridge): State<TerminalBridge>,
    Json(request): Json<AssignWorkspaceRequest>,
) -> ApiResult<Value> {
    bridge
        .request(Op::AssignWorkspace {
            terminal_id: request.terminal_id,
            workspace_id: request.workspace_id,
        })
        .await
        .map(Json)
        .map_err(internal_err)
}

/// Write stdin over HTTP — the frontend's fallback for the window between a
/// pane mounting and its WebSocket opening, so no keystroke is dropped.
async fn write_stdin(
    State(bridge): State<TerminalBridge>,
    Json(request): Json<WriteRequest>,
) -> ApiResult<Value> {
    let WriteRequest { terminal_id, data } = request;
    bridge
        .with_client(|client| {
            let (id, data) = (terminal_id.clone(), data.clone());
            async move { client.write(&id, data.as_bytes()).await }
        })
        .await
        .map_err(internal_err)?;
    Ok(Json(Value::Null))
}

async fn resize(
    State(bridge): State<TerminalBridge>,
    Json(request): Json<ResizeRequest>,
) -> ApiResult<Value> {
    bridge
        .request(Op::Resize {
            terminal_id: request.terminal_id,
            cols: request.cols,
            rows: request.rows,
        })
        .await
        .map(Json)
        .map_err(internal_err)
}

async fn kill(
    State(bridge): State<TerminalBridge>,
    Json(request): Json<TerminalIdRequest>,
) -> ApiResult<Value> {
    bridge
        .request(Op::Kill {
            terminal_id: request.terminal_id,
        })
        .await
        .map(Json)
        .map_err(internal_err)
}

/// Live sessions, as the daemon reports them.
///
/// Deliberately *not* the desktop's `terminal_list`: that one also re-routes
/// strays, which is a write against the work queue. One reconciler is enough,
/// and it belongs where the app that owns the window is.
async fn list(
    State(bridge): State<TerminalBridge>,
    body: Option<Json<ListRequest>>,
) -> ApiResult<Vec<Value>> {
    let repo_path = body.map(|Json(request)| request.repo_path).unwrap_or(None);
    bridge
        .request_as(Op::List { repo_path })
        .await
        .map(Json)
        .map_err(internal_err)
}

/// Cold-reattach scrollback: `{dataB64, cursor, status}`, already camelCase.
async fn replay(
    State(bridge): State<TerminalBridge>,
    Json(request): Json<TerminalIdRequest>,
) -> ApiResult<Value> {
    bridge
        .request(Op::Replay {
            terminal_id: request.terminal_id,
        })
        .await
        .map(Json)
        .map_err(internal_err)
}

async fn peek(
    State(bridge): State<TerminalBridge>,
    Json(request): Json<TerminalIdRequest>,
) -> ApiResult<String> {
    bridge
        .request_as(Op::Peek {
            terminal_id: request.terminal_id,
        })
        .await
        .map(Json)
        .map_err(internal_err)
}

// ============================================================
// The WebSocket
// ============================================================

/// The one route CORS cannot protect: a WebSocket handshake is not a
/// cross-origin *fetch*, so no preflight ever runs and the browser will happily
/// open a socket from any page to this server. Without this check any site the
/// user visits could type into their shells. Same rule as the CORS predicate,
/// applied before the upgrade rather than after it.
async fn ws(
    State(bridge): State<TerminalBridge>,
    Path(terminal_id): Path<String>,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Response {
    if !origin_allowed(headers.get(axum::http::header::ORIGIN), &headers) {
        log::warn!(
            "[terminal_ws] refused an upgrade for {terminal_id} from origin {:?}",
            headers.get(axum::http::header::ORIGIN)
        );
        return StatusCode::FORBIDDEN.into_response();
    }
    upgrade.on_upgrade(move |socket| attach(bridge, socket, terminal_id))
}

/// Open the session's daemon stream and pump it, or tell the client the session
/// is gone.
///
/// There is no replay on connect: the stream is purely live, and the pane
/// fetches scrollback with `POST /api/terminal/replay`, deduplicating against it
/// by `seq`. Sending both would double every byte in the overlap.
async fn attach(bridge: TerminalBridge, mut socket: WebSocket, terminal_id: String) {
    let t0 = Instant::now();
    let opened = bridge
        .with_client(|client| {
            let id = terminal_id.clone();
            async move {
                let stream = client.open_stream(&id).await?;
                Ok((client, stream))
            }
        })
        .await;

    let (client, stream) = match opened {
        Ok(attached) => attached,
        Err(e) => {
            log::warn!("[terminal_ws] could not attach {terminal_id}: {e:#}");
            close_gone(&mut socket).await;
            return;
        }
    };

    log::info!("[terminal_ws] {terminal_id} attached in {:?}", t0.elapsed());
    pump(socket, client, stream, &terminal_id).await;
}

/// Shuttle frames both ways until either side ends.
///
/// Dropping the [`StreamHandle`] on the way out closes the daemon-side
/// subscription and nothing else — a browser tab closing never kills a session.
/// Input goes through the `client` this stream was opened on rather than the
/// bridge's reconnect path: if the daemon restarted, this stream is dead too, so
/// the honest answer is to let the socket close and let the frontend's backoff
/// reconnect re-attach through [`TerminalBridge::with_client`].
///
/// Two things end the pump besides the session itself:
///
/// - **Input that cannot be delivered.** A stream can outlive the control
///   connection it was opened on (they are separate sockets), and a pump that
///   logged the failure and kept going would leave the pane *looking* connected
///   while every keystroke fell on the floor. Closing puts the frontend back on
///   its `POST /api/terminal/write` fallback until its backoff re-attaches.
/// - **Silence.** A tab that goes away without a close frame — laptop lid, lost
///   Wi-Fi, a proxy giving up — leaves this task, its daemon connection and its
///   subscriber alive forever. A ping every [`KEEPALIVE_INTERVAL`] costs
///   nothing (browsers pong automatically, so an idle tab is not disturbed) and
///   a half-open socket stops answering and is reaped within ~2 ticks.
async fn pump(mut socket: WebSocket, client: DaemonClient, mut stream: StreamHandle, id: &str) {
    let mut keepalive = tokio::time::interval(KEEPALIVE_INTERVAL);
    // A burst of catch-up pings after a busy stretch would say nothing the
    // first one didn't; space them instead.
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // The first tick is immediate; skip it so a socket is not pinged the
    // instant it opens.
    keepalive.tick().await;
    let mut last_inbound = Instant::now();

    loop {
        tokio::select! {
            _ = keepalive.tick() => {
                if last_inbound.elapsed() > KEEPALIVE_TIMEOUT {
                    log::debug!(
                        "[terminal_ws] {id} silent for {:?}; closing a half-open socket",
                        last_inbound.elapsed()
                    );
                    return;
                }
                if socket.send(Message::Ping(Default::default())).await.is_err() {
                    return; // client went away
                }
            }
            frame = stream.recv() => {
                let Some(frame) = frame else {
                    // The daemon ended the stream without an exit or an error:
                    // it died. Close, and let the client's backoff take over.
                    log::debug!("[terminal_ws] {id} stream ended");
                    let _ = socket.send(Message::Close(None)).await;
                    return;
                };
                match translate(frame) {
                    Outbound::Frame(message) => {
                        if socket.send(message).await.is_err() {
                            return; // client went away
                        }
                    }
                    Outbound::Final(message) => {
                        let _ = socket.send(message).await;
                        let _ = socket.send(Message::Close(None)).await;
                        return;
                    }
                    Outbound::Gone => {
                        close_gone(&mut socket).await;
                        return;
                    }
                    Outbound::Skip => {}
                }
            }
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else {
                    return; // closed, or a transport error
                };
                // Any frame at all proves the peer is there — a pong most of
                // the time, since an attached-but-idle pane sends nothing else.
                last_inbound = Instant::now();
                match translate_inbound(&message) {
                    Inbound::Input(bytes) => {
                        if let Err(e) = client.write(id, bytes).await {
                            log::warn!("[terminal_ws] input to {id} failed: {e:#}");
                            if is_disconnected(&e) {
                                return; // a read-only socket is worse than a closed one
                            }
                        }
                    }
                    Inbound::Resize { cols, rows } => {
                        let resize = client.request(Op::Resize {
                            terminal_id: id.to_owned(),
                            cols,
                            rows,
                        });
                        if let Err(e) = resize.await {
                            log::warn!("[terminal_ws] resize of {id} failed: {e:#}");
                            if is_disconnected(&e) {
                                return;
                            }
                        }
                    }
                    Inbound::Close => return,
                    Inbound::Ignore => {}
                }
            }
        }
    }
}

/// Close with [`SESSION_GONE`], the one close the frontend does not retry.
async fn close_gone(socket: &mut WebSocket) {
    let _ = socket
        .send(Message::Close(Some(CloseFrame {
            code: SESSION_GONE,
            reason: "session gone".into(),
        })))
        .await;
}

/// What one daemon frame becomes on the socket.
#[derive(Debug, PartialEq)]
enum Outbound {
    /// Send this, keep pumping.
    Frame(Message),
    /// Send this, then close normally — the child exited.
    Final(Message),
    /// Close with [`SESSION_GONE`] and send nothing.
    Gone,
    /// Nothing to send; keep pumping.
    Skip,
}

/// Daemon frame → browser frame.
fn translate(frame: StreamFrame) -> Outbound {
    match frame {
        StreamFrame::Output { seq, data } => {
            // `[8-byte BE u64 seq][raw PTY bytes]` — one frame, no base64.
            let mut out = Vec::with_capacity(8 + data.len());
            out.extend_from_slice(&seq.to_be_bytes());
            out.extend_from_slice(&data);
            Outbound::Frame(Message::binary(out))
        }
        // The daemon's status is already the frontend's `TerminalStatus`; it
        // only needs the tag that tells a text frame apart from an exit.
        StreamFrame::Status(Value::Object(mut status)) => {
            status.insert("t".to_owned(), Value::String("status".to_owned()));
            Outbound::Frame(Message::text(Value::Object(status).to_string()))
        }
        StreamFrame::Status(other) => {
            log::warn!("[terminal_ws] status frame was not an object: {other}");
            Outbound::Skip
        }
        // The same tag the client sends its own resizes under: on this wire a
        // resize is a fact about the shared PTY, whichever direction it travels.
        StreamFrame::Resized { cols, rows } => Outbound::Frame(Message::text(
            json!({"t": "resize", "cols": cols, "rows": rows}).to_string(),
        )),
        StreamFrame::Exit { exit_code } => Outbound::Final(Message::text(
            json!({"t": "exit", "exitCode": exit_code}).to_string(),
        )),
        // The daemon closes a stream it cannot serve — an unknown terminal.
        StreamFrame::Error { message } => {
            log::warn!("[terminal_ws] daemon refused the stream: {message}");
            Outbound::Gone
        }
    }
}

/// What one browser frame asks for.
#[derive(Debug, PartialEq)]
enum Inbound<'a> {
    /// Raw stdin bytes.
    Input(&'a [u8]),
    Resize {
        cols: u16,
        rows: u16,
    },
    /// Unknown text, a ping, or a pong — nothing to do.
    Ignore,
    Close,
}

/// The resize the frontend sends; anything else on a text frame is ignored.
#[derive(Deserialize)]
struct ResizeFrame {
    t: String,
    cols: u16,
    rows: u16,
}

/// Browser frame → daemon action.
fn translate_inbound(message: &Message) -> Inbound<'_> {
    match message {
        Message::Binary(data) => Inbound::Input(data),
        Message::Text(text) => match serde_json::from_str::<ResizeFrame>(text) {
            Ok(frame) if frame.t == "resize" => Inbound::Resize {
                cols: frame.cols,
                rows: frame.rows,
            },
            _ => Inbound::Ignore,
        },
        Message::Close(_) => Inbound::Close,
        // axum answers pings itself.
        Message::Ping(_) | Message::Pong(_) => Inbound::Ignore,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text_of(message: &Message) -> Value {
        match message {
            Message::Text(text) => serde_json::from_str(text).expect("text frame is JSON"),
            other => panic!("expected a text frame, got {other:?}"),
        }
    }

    /// Output is the hot path and the one frame with a binary layout the
    /// frontend parses by hand: eight big-endian bytes of cursor, then the PTY
    /// bytes untouched.
    #[test]
    fn output_frames_carry_a_big_endian_seq_header() {
        let translated = translate(StreamFrame::Output {
            seq: 0x0102_0304_0506_0708,
            data: vec![0x1b, b'[', b'0', b'm', 0xff],
        });
        let Outbound::Frame(Message::Binary(bytes)) = translated else {
            panic!("output must be a binary frame: {translated:?}");
        };
        assert_eq!(&bytes[..8], &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(&bytes[8..], &[0x1b, b'[', b'0', b'm', 0xff]);
    }

    /// An empty chunk is still a cursor update, so the header stands alone.
    #[test]
    fn an_empty_output_chunk_is_header_only() {
        let translated = translate(StreamFrame::Output {
            seq: 42,
            data: Vec::new(),
        });
        let Outbound::Frame(Message::Binary(bytes)) = translated else {
            panic!("expected a binary frame");
        };
        assert_eq!(bytes.len(), 8);
        assert_eq!(u64::from_be_bytes(bytes[..].try_into().unwrap()), 42);
    }

    /// The status Value is the frontend's `TerminalStatus` already — the tag is
    /// added, every other field survives verbatim.
    #[test]
    fn status_frames_gain_a_tag_and_keep_their_fields() {
        let translated = translate(StreamFrame::Status(
            json!({"id": "t1", "phase": "idle", "shellIntegrationActive": false}),
        ));
        let Outbound::Frame(ref message) = translated else {
            panic!("status must keep the stream open: {translated:?}");
        };
        assert_eq!(
            text_of(message),
            json!({"t": "status", "id": "t1", "phase": "idle", "shellIntegrationActive": false})
        );
    }

    /// A status that is not an object cannot be tagged; dropping it keeps the
    /// session streaming rather than sending the frontend a fake status.
    #[test]
    fn a_malformed_status_is_skipped_not_fatal() {
        assert_eq!(
            translate(StreamFrame::Status(json!("idle"))),
            Outbound::Skip
        );
    }

    /// A daemon-side resize (another client's) reaches the browser as the same
    /// text shape the browser itself sends resizes in.
    #[test]
    fn resized_frames_become_resize_text_frames() {
        let translated = translate(StreamFrame::Resized {
            cols: 141,
            rows: 52,
        });
        let Outbound::Frame(ref message) = translated else {
            panic!("a resize must keep the stream open: {translated:?}");
        };
        assert_eq!(
            text_of(message),
            json!({"t": "resize", "cols": 141, "rows": 52})
        );
    }

    /// Exit is the last frame: sent, then a normal close.
    #[test]
    fn exit_frames_are_final_and_camel_case() {
        let translated = translate(StreamFrame::Exit { exit_code: Some(3) });
        let Outbound::Final(ref message) = translated else {
            panic!("exit must end the socket: {translated:?}");
        };
        assert_eq!(text_of(message), json!({"t": "exit", "exitCode": 3}));

        let translated = translate(StreamFrame::Exit { exit_code: None });
        let Outbound::Final(ref message) = translated else {
            panic!("expected a final frame");
        };
        assert_eq!(text_of(message), json!({"t": "exit", "exitCode": null}));
    }

    /// The daemon refusing a stream means the session is gone, which is a 4404
    /// close and *not* an exit — an exit would tell the pane a child died.
    #[test]
    fn a_stream_error_becomes_a_session_gone_close() {
        assert_eq!(
            translate(StreamFrame::Error {
                message: "no such terminal t9".into()
            }),
            Outbound::Gone
        );
    }

    #[test]
    fn binary_frames_are_stdin() {
        let message = Message::binary(b"echo hi\n".to_vec());
        assert_eq!(translate_inbound(&message), Inbound::Input(b"echo hi\n"));
    }

    #[test]
    fn resize_frames_are_parsed() {
        let message = Message::text(r#"{"t":"resize","cols":120,"rows":40}"#);
        assert_eq!(
            translate_inbound(&message),
            Inbound::Resize {
                cols: 120,
                rows: 40
            }
        );
    }

    /// Anything else on a text frame is ignored rather than fatal: the wire is
    /// allowed to grow tags this server does not know yet.
    #[test]
    fn unknown_text_frames_are_ignored() {
        for text in [
            r#"{"t":"nonsense"}"#,
            r#"{"t":"resize"}"#,
            "not json at all",
            "{}",
        ] {
            assert_eq!(translate_inbound(&Message::text(text)), Inbound::Ignore);
        }
        assert_eq!(
            translate_inbound(&Message::Ping(Default::default())),
            Inbound::Ignore
        );
        assert_eq!(translate_inbound(&Message::Close(None)), Inbound::Close);
    }

    /// A daemon-side "no such terminal" must not cost a reconnect; the three
    /// ways the transport itself dies must.
    #[test]
    fn only_transport_failures_trigger_a_reconnect() {
        assert!(!is_disconnected(&anyhow::anyhow!("no such terminal t9")));
        assert!(is_disconnected(&anyhow::anyhow!(
            "daemon connection closed before responding"
        )));
        assert!(is_disconnected(
            &anyhow::anyhow!("broken pipe").context("sending request to daemon")
        ));
        assert!(is_disconnected(&anyhow::anyhow!(
            "connecting to daemon at /tmp/daemon.sock"
        )));
    }

    /// The literals above are the *client's*, not this module's. Asserting on
    /// the consts as well means a reworded error there cannot pass this file's
    /// tests while silently disabling reconnection in production.
    #[test]
    fn the_transport_markers_come_from_the_client() {
        assert!(is_disconnected(&anyhow::anyhow!(ERR_CLOSED)));
        assert!(is_disconnected(
            &anyhow::anyhow!("broken pipe").context(ERR_SENDING)
        ));
        assert!(is_disconnected(&anyhow::anyhow!(
            "{ERR_CONNECTING} at /tmp/daemon.sock"
        )));
    }
}

/// The bridge against a real daemon: routes, the WebSocket, and a round trip
/// through a shell. `serve` needs the `daemon` feature, which the test matrix
/// enables alongside `server`.
#[cfg(all(test, feature = "daemon"))]
mod daemon_tests {
    use std::time::Duration;

    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use futures::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest as _;
    use tokio_tungstenite::tungstenite::Message as WsMessage;
    use tower::ServiceExt as _;

    use super::*;
    use crate::daemon::test_support::{Harness, TIMEOUT};
    use crate::review::central::tests::ENV_LOCK;

    /// A router bridged to `harness`, plus the address it is served on.
    struct Served {
        router: Router,
        addr: std::net::SocketAddr,
    }

    impl Served {
        async fn start(harness: &Harness) -> Self {
            let router = router(TerminalBridge::with_socket(harness.socket.clone()));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let addr = listener.local_addr().unwrap();
            tokio::spawn({
                let router = router.clone();
                async move {
                    axum::serve(listener, router).await.unwrap();
                }
            });
            Self { router, addr }
        }

        /// One JSON POST through the router, returning the decoded body.
        async fn post(&self, path: &str, body: Value) -> (StatusCode, Value) {
            let request = Request::builder()
                .method("POST")
                .uri(path)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap();
            let response = self.router.clone().oneshot(request).await.unwrap();
            let status = response.status();
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let value = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
            (status, value)
        }

        fn ws_url(&self, id: &str) -> String {
            format!("ws://{}/api/terminal/{id}/ws", self.addr)
        }
    }

    /// A throwaway review home, so routing writes its `work.json` into a
    /// tempdir rather than the machine's real queue.
    struct HomeGuard(
        #[allow(dead_code, reason = "held only so the tempdir outlives the test")]
        tempfile::TempDir,
    );

    impl Drop for HomeGuard {
        fn drop(&mut self) {
            std::env::remove_var("REVIEW_HOME");
        }
    }

    fn isolated_home() -> HomeGuard {
        let home = tempfile::TempDir::new().unwrap();
        std::env::set_var("REVIEW_HOME", home.path());
        HomeGuard(home)
    }

    /// The whole web-mode terminal path in one go: probe, start (which routes),
    /// type into the socket, watch the output come back, then kill.
    #[tokio::test]
    async fn a_session_round_trips_over_the_websocket() {
        let _lock = ENV_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let _home = isolated_home();

        let harness = Harness::start().await;
        let served = Served::start(&harness).await;

        let (status, available) = served.post("/api/terminal/available", json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(available, json!(true), "the harness daemon is reachable");

        let cwd = harness.dir.path().to_string_lossy().into_owned();
        let (status, started) = served
            .post(
                "/api/terminal/start",
                json!({
                    "terminalId": "web-1",
                    "repoPath": cwd,
                    "cwd": cwd,
                    "cols": 80,
                    "rows": 24,
                    "shell": "/bin/sh",
                }),
            )
            .await;
        assert_eq!(status, StatusCode::OK, "start failed: {started}");
        assert_eq!(started["session"]["id"], "web-1");
        assert!(
            started["workspace"]["id"].is_string(),
            "every session is born in a workspace: {started}"
        );
        assert_eq!(
            started["workspace"]["created"],
            json!(true),
            "nothing was attached to this directory yet"
        );

        // The pane's socket. Purely live — no replay frame arrives on connect.
        let (mut socket, _) = tokio_tungstenite::connect_async(served.ws_url("web-1"))
            .await
            .expect("the socket attaches to a live session");

        socket
            .send(WsMessage::Binary(b"echo bridged\n".to_vec().into()))
            .await
            .unwrap();

        let seen = tokio::time::timeout(TIMEOUT, async {
            let mut seen = Vec::new();
            while let Some(Ok(message)) = socket.next().await {
                if let WsMessage::Binary(bytes) = message {
                    assert!(bytes.len() >= 8, "every output frame carries its cursor");
                    seen.extend_from_slice(&bytes[8..]);
                    if String::from_utf8_lossy(&seen).contains("bridged") {
                        return seen;
                    }
                }
            }
            panic!("the socket closed before the shell echoed: {seen:?}");
        })
        .await
        .expect("the shell's output should come back over the socket");

        assert!(String::from_utf8_lossy(&seen).contains("bridged"));

        // Resize rides the same socket.
        socket
            .send(WsMessage::text(r#"{"t":"resize","cols":100,"rows":30}"#))
            .await
            .unwrap();

        let (status, listed) = served.post("/api/terminal/list", json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed.as_array().map(Vec::len), Some(1), "{listed}");

        let (status, peeked) = served
            .post("/api/terminal/peek", json!({"terminalId": "web-1"}))
            .await;
        assert_eq!(status, StatusCode::OK);
        assert!(peeked.is_string(), "peek is a plain screen snapshot");

        let (status, replayed) = served
            .post("/api/terminal/replay", json!({"terminalId": "web-1"}))
            .await;
        assert_eq!(status, StatusCode::OK);
        assert!(replayed["dataB64"].is_string(), "{replayed}");
        assert!(replayed["cursor"].is_number(), "{replayed}");

        // The HTTP write fallback — the path taken before a pane's socket opens.
        let (status, _) = served
            .post(
                "/api/terminal/write",
                json!({"terminalId": "web-1", "data": "echo fallback\n"}),
            )
            .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _) = served
            .post("/api/terminal/kill", json!({"terminalId": "web-1"}))
            .await;
        assert_eq!(status, StatusCode::OK);

        let (status, listed) = served.post("/api/terminal/list", json!({})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(listed.as_array().map(Vec::len), Some(0), "{listed}");
    }

    /// A socket for a session the daemon never heard of must close 4404, so the
    /// frontend stops retrying instead of reconnecting to nothing forever.
    #[tokio::test]
    async fn an_unknown_session_closes_with_4404() {
        let harness = Harness::start().await;
        let served = Served::start(&harness).await;

        let (mut socket, _) = tokio_tungstenite::connect_async(served.ws_url("ghost"))
            .await
            .expect("the upgrade itself succeeds");

        let closed = tokio::time::timeout(TIMEOUT, async {
            while let Some(Ok(message)) = socket.next().await {
                if let WsMessage::Close(frame) = message {
                    return frame;
                }
            }
            None
        })
        .await
        .expect("the server should close promptly");

        let frame = closed.expect("a close frame with a code");
        assert_eq!(u16::from(frame.code), SESSION_GONE);
    }

    /// With no daemon at all, the probe is `false` rather than a 500 — web mode
    /// is routinely run against a machine that has never started one.
    #[tokio::test]
    async fn availability_is_false_without_a_daemon() {
        let missing = tempfile::TempDir::new().unwrap();
        let router = router(TerminalBridge::with_socket(
            missing.path().join("nope.sock"),
        ));
        let request = Request::builder()
            .method("POST")
            .uri("/api/terminal/available")
            .header("content-type", "application/json")
            .body(Body::from("{}"))
            .unwrap();

        let response = router.oneshot(request).await.unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&bytes).unwrap(),
            json!(false)
        );
    }

    /// The connection is cached, and a daemon that goes away and comes back on
    /// the same socket is reconnected to rather than failing forever.
    #[tokio::test]
    async fn a_restarted_daemon_is_reconnected_to() {
        let dir = tempfile::TempDir::new().unwrap();
        let socket = dir.path().join("daemon.sock");
        let bridge = TerminalBridge::with_socket(socket.clone());

        let first = tokio::spawn({
            let socket = socket.clone();
            async move {
                let _ = crate::daemon::serve(socket).await;
            }
        });
        wait_for(&socket).await;
        assert!(bridge.request(Op::Available).await.is_ok());

        // The desktop app respawning the daemon looks exactly like this.
        first.abort();
        let _ = std::fs::remove_file(&socket);
        let second = tokio::spawn({
            let socket = socket.clone();
            async move {
                let _ = crate::daemon::serve(socket).await;
            }
        });
        wait_for(&socket).await;

        assert!(
            bridge.request(Op::Available).await.is_ok(),
            "a dead cached connection must be replaced, not returned"
        );
        second.abort();
    }

    /// A WebSocket handshake is exempt from CORS — no preflight, and the
    /// browser sends it happily from any page — so the origin has to be checked
    /// by hand or every site the user visits can type into their shells. A
    /// refused upgrade is a plain 403: there is no socket to close.
    #[tokio::test]
    async fn a_foreign_origin_cannot_open_a_socket() {
        let harness = Harness::start().await;
        let served = Served::start(&harness).await;

        let mut request = served.ws_url("anything").into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", "https://evil.example".parse().unwrap());

        let refused = tokio_tungstenite::connect_async(request)
            .await
            .expect_err("a cross-origin upgrade must not succeed");
        let tokio_tungstenite::tungstenite::Error::Http(response) = refused else {
            panic!("expected an HTTP refusal, got {refused:?}");
        };
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }

    /// The app itself, in a browser on this machine — the origin the check
    /// exists to keep working.
    #[tokio::test]
    async fn a_loopback_origin_still_attaches() {
        let harness = Harness::start().await;
        let served = Served::start(&harness).await;

        let mut request = served.ws_url("ghost").into_client_request().unwrap();
        request
            .headers_mut()
            .insert("origin", "http://localhost:1420".parse().unwrap());

        // The session does not exist, so this closes 4404 — but the *upgrade*
        // is what is under test, and a refusal would have failed it instead.
        let (mut socket, _) = tokio_tungstenite::connect_async(request)
            .await
            .expect("a loopback origin is this server's own front end");
        let closed = tokio::time::timeout(TIMEOUT, async {
            while let Some(Ok(message)) = socket.next().await {
                if let WsMessage::Close(frame) = message {
                    return frame;
                }
            }
            None
        })
        .await
        .expect("the server should answer");
        assert_eq!(u16::from(closed.expect("a close frame").code), SESSION_GONE);
    }

    async fn wait_for(socket: &std::path::Path) {
        let deadline = tokio::time::Instant::now() + TIMEOUT;
        while !socket.exists() && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
}
