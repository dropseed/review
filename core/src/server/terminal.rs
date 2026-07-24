//! Web-mode terminal transport: HTTP control routes + a WebSocket data channel.
//!
//! These handlers are the Axum counterpart to the Tauri terminal commands
//! (`desktop/tauri/src/desktop/terminal_commands.rs`); both are thin wrappers
//! over the one shared [`SessionManager`]. The request/response and WS frame
//! shapes are fixed by the project's canonical wire contract (all JSON
//! `camelCase`).
//!
//! Wire contract, in brief:
//! - POST `/api/terminal/{start,write,resize,kill,list,replay,peek,available}` —
//!   JSON. `replay` returns `{dataB64, cursor, status}`: base64 scrollback, the
//!   byte **cursor** those bytes end at, and the current status.
//! - GET `/api/terminal/{id}/ws` — upgrade to a WebSocket. This is a **pure live
//!   stream**: no initial scrollback frame. Server→client: `Binary` = an 8-byte
//!   big-endian `u64` scrollback cursor (`seq`, the end-offset after this chunk)
//!   followed by the raw PTY output bytes; `Text` = `{"t":"status",...}` or
//!   `{"t":"exit","exitCode":n|null}`. Client→server: `Binary` = stdin bytes;
//!   `Text` = `{"t":"resize","cols":n,"rows":n}`. Closing the socket never kills
//!   the session — a reattach fetches `replay`, writes its scrollback, then drops
//!   any live `Binary` frame whose `seq` is `<=` the replay `cursor` before
//!   resuming the live stream.

use std::path::PathBuf;
use std::sync::Arc;

use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Extension, Path, Request};
use axum::http::{header, StatusCode};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use base64::Engine as _;
use futures::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};

use super::handlers::{blocking, ApiResult};
use crate::terminal::{
    SessionManager, SessionSpec, SessionStatus, Subscription, TerminalId, TerminalMessage,
    TerminalSummary,
};

/// Application-level WebSocket close code for "subscribe to an unknown session".
/// 4000–4999 is the range reserved for private use by RFC 6455.
const CLOSE_UNKNOWN_TERMINAL: u16 = 4404;

/// Standard base64 engine for the `replay` route's scrollback bytes.
const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::STANDARD;

/// The terminal sub-router, with the shared [`SessionManager`] attached as an
/// `Extension` so only these handlers see it (existing routes stay stateless).
///
/// Every route — including the WebSocket upgrade — sits behind
/// [`guard_localhost`], so the server-wide permissive CORS layer never exposes a
/// PTY to a browser page on another origin. The guard is applied as the
/// outermost layer so it rejects before any handler or extractor runs.
pub fn routes(manager: Arc<SessionManager>) -> Router {
    Router::new()
        .route("/api/terminal/start", post(start))
        .route("/api/terminal/write", post(write))
        .route("/api/terminal/resize", post(resize))
        .route("/api/terminal/kill", post(kill))
        .route("/api/terminal/list", post(list))
        .route("/api/terminal/replay", post(replay))
        .route("/api/terminal/peek", post(peek))
        .route("/api/terminal/available", post(available))
        .route("/api/terminal/{id}/ws", get(terminal_ws))
        .layer(Extension(manager))
        .layer(middleware::from_fn(guard_localhost))
}

// ============================================================
// Origin / Host guard
// ============================================================
//
// **Threat model.** The terminal routes let a caller spawn a shell and run
// arbitrary commands. In web mode they run on a localhost HTTP server behind a
// permissive `CorsLayer::allow_origin(Any)` (see [`super::build_router`]), and a
// WebSocket upgrade ignores CORS entirely. Without a check, ANY web page the
// user visits could `fetch()`/`new WebSocket()` against `http://localhost:<port>`
// and drive a terminal on their machine — a browser-origin attack against a
// localhost dev server, including via DNS rebinding (an attacker domain that
// resolves to 127.0.0.1).
//
// This guard is a pragmatic defense for a single-user dev tool, not real
// authentication: any local process can still reach the port. The production-
// grade upgrade is a per-session bearer token minted by the desktop shell and
// required on every terminal request and the WS upgrade; this host/origin check
// is the minimum that keeps a *browser* on another origin out.

/// Hosts we treat as this machine's loopback interface (any port).
fn is_loopback_host(host: &str) -> bool {
    matches!(host, "localhost" | "127.0.0.1" | "::1")
}

/// The host component of an authority like `localhost:1420`, `127.0.0.1`, or the
/// bracketed IPv6 form `[::1]:8443` (→ `::1`).
fn host_part(authority: &str) -> &str {
    if let Some(rest) = authority.strip_prefix('[') {
        if let Some(end) = rest.find(']') {
            return &rest[..end];
        }
    }
    authority.split(':').next().unwrap_or(authority)
}

/// The host of an `Origin` header value (`scheme://host[:port]`), or `None` if it
/// has no scheme separator (e.g. the opaque `"null"` origin).
fn origin_host(origin: &str) -> Option<&str> {
    let (_scheme, authority) = origin.split_once("://")?;
    // Origins carry no path, but strip one defensively before parsing the host.
    let authority = authority.split('/').next().unwrap_or(authority);
    Some(host_part(authority))
}

/// Reject browser-origin attacks against the localhost terminal server.
///
/// - **(a)** If an `Origin` header is present (every browser `fetch`/WS sends
///   one), its host MUST be loopback — a page on `https://evil.com` is refused.
/// - **(b)** The `Host` header's host MUST be loopback regardless of Origin, so a
///   rebound attacker domain (`Host: attacker.tld`) resolving to 127.0.0.1 is
///   refused. Requests with no Origin (curl, native clients) pass (a) vacuously
///   and are held to (b) only.
///
/// Anything else gets `403 Forbidden` with a short reason.
async fn guard_localhost(req: Request, next: Next) -> Response {
    let headers = req.headers();

    // (a) Cross-origin browser check.
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if !origin_host(origin).is_some_and(is_loopback_host) {
            return forbidden("terminal access denied: non-loopback Origin");
        }
    }

    // (b) DNS-rebinding defense: the Host must resolve to us as loopback.
    let host_ok = headers
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|host| is_loopback_host(host_part(host)));
    if !host_ok {
        return forbidden("terminal access denied: non-loopback Host");
    }

    next.run(req).await
}

fn forbidden(reason: &'static str) -> Response {
    (StatusCode::FORBIDDEN, reason).into_response()
}

// ============================================================
// Request bodies
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartRequest {
    terminal_id: String,
    repo_path: String,
    cwd: String,
    cols: u16,
    rows: u16,
    shell: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WriteRequest {
    terminal_id: String,
    data: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResizeRequest {
    terminal_id: String,
    cols: u16,
    rows: u16,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TerminalIdRequest {
    terminal_id: String,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct ListRequest {
    #[serde(default)]
    repo_path: Option<String>,
}

// ============================================================
// HTTP handlers
// ============================================================

async fn start(
    Extension(manager): Extension<Arc<SessionManager>>,
    Json(req): Json<StartRequest>,
) -> ApiResult<TerminalSummary> {
    // Build the spec exactly like the Tauri command does — same defaults, same
    // field mapping — so both transports spawn identical sessions.
    let mut spec = SessionSpec::new(
        TerminalId::from(req.terminal_id),
        PathBuf::from(&req.repo_path),
        PathBuf::from(&req.cwd),
    );
    spec.cols = req.cols;
    spec.rows = req.rows;
    spec.shell = req.shell.map(PathBuf::from);

    blocking(move || manager.start(spec)).await
}

async fn write(
    Extension(manager): Extension<Arc<SessionManager>>,
    Json(req): Json<WriteRequest>,
) -> ApiResult<()> {
    let id = TerminalId::from(req.terminal_id);
    let data = req.data;
    blocking(move || manager.write(&id, data.as_bytes())).await
}

async fn resize(
    Extension(manager): Extension<Arc<SessionManager>>,
    Json(req): Json<ResizeRequest>,
) -> ApiResult<()> {
    let id = TerminalId::from(req.terminal_id);
    blocking(move || manager.resize(&id, req.cols, req.rows)).await
}

async fn kill(
    Extension(manager): Extension<Arc<SessionManager>>,
    Json(req): Json<TerminalIdRequest>,
) -> ApiResult<()> {
    let id = TerminalId::from(req.terminal_id);
    blocking(move || manager.kill(&id)).await
}

async fn list(
    Extension(manager): Extension<Arc<SessionManager>>,
    Json(req): Json<ListRequest>,
) -> ApiResult<Vec<TerminalSummary>> {
    // `list` never fails; only the join can, so lift it into the blocking helper.
    blocking(move || Ok(manager.list(req.repo_path.as_deref()))).await
}

/// `replay` response — base64 scrollback, the byte cursor those bytes end at,
/// and the current status. Mirrors Tauri's `terminal_replay` return shape.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ReplayResponse {
    data_b64: String,
    cursor: u64,
    status: SessionStatus,
}

/// Cold-reattach scrollback for a session. The client opens the WS first (a pure
/// live stream) and buffers live frames by their `seq`, then fetches `replay`:
/// after writing the scrollback it drops any buffered frame with `seq <= cursor`,
/// so bytes captured in both the snapshot and the live stream render exactly
/// once. The byte cursor closes the replay/live overlap the old quiescence
/// assumption only papered over.
async fn replay(
    Extension(manager): Extension<Arc<SessionManager>>,
    Json(req): Json<TerminalIdRequest>,
) -> ApiResult<ReplayResponse> {
    let id = TerminalId::from(req.terminal_id);
    blocking(move || {
        let (bytes, cursor, status) = manager.replay(&id)?;
        Ok(ReplayResponse {
            data_b64: B64.encode(&bytes),
            cursor,
            status,
        })
    })
    .await
}

async fn peek(
    Extension(manager): Extension<Arc<SessionManager>>,
    Json(req): Json<TerminalIdRequest>,
) -> ApiResult<String> {
    let id = TerminalId::from(req.terminal_id);
    blocking(move || manager.peek(&id)).await
}

/// Runtime capability probe. Reaching this handler means the server was built
/// with terminal support, so it always answers `true`; the HttpClient treats a
/// transport error (older server, feature off) as `false`.
async fn available() -> Json<bool> {
    Json(true)
}

// ============================================================
// WebSocket data channel
// ============================================================

/// A server→client tagged status frame: the flattened [`SessionStatus`] (already
/// `camelCase`) plus a `"t":"status"` discriminant.
#[derive(Serialize)]
struct StatusFrame<'a> {
    t: &'static str,
    #[serde(flatten)]
    status: &'a SessionStatus,
}

/// A server→client tagged exit frame.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ExitFrame {
    t: &'static str,
    exit_code: Option<i32>,
}

/// Client→server control frames (JSON `Text`), discriminated by `t`. Only
/// `resize` is defined today; an unknown `t` fails to parse and is ignored.
#[derive(Deserialize)]
#[serde(tag = "t", rename_all = "snake_case")]
enum ClientFrame {
    Resize { cols: u16, rows: u16 },
}

/// Frame a live PTY output chunk for the WebSocket: an 8-byte big-endian `seq`
/// cursor header followed by the raw output bytes. The client strips the header,
/// uses `seq` for replay deduplication, and writes the remainder to xterm.
fn frame_output(seq: u64, data: &[u8]) -> Vec<u8> {
    let mut framed = Vec::with_capacity(8 + data.len());
    framed.extend_from_slice(&seq.to_be_bytes());
    framed.extend_from_slice(data);
    framed
}

async fn terminal_ws(
    ws: WebSocketUpgrade,
    Path(id): Path<String>,
    Extension(manager): Extension<Arc<SessionManager>>,
) -> Response {
    let id = TerminalId::from(id);
    ws.on_upgrade(move |socket| handle_socket(socket, id, manager))
}

/// Subscribe on the blocking pool (the manager takes a `std::sync::Mutex`).
async fn subscribe_blocking(
    manager: &Arc<SessionManager>,
    id: &TerminalId,
) -> anyhow::Result<Subscription> {
    let manager = Arc::clone(manager);
    let id = id.clone();
    tokio::task::spawn_blocking(move || manager.subscribe(&id)).await?
}

async fn handle_socket(socket: WebSocket, id: TerminalId, manager: Arc<SessionManager>) {
    // Subscribe up front. An unknown session closes with the private 4404 code
    // rather than a normal close, so the client can distinguish "gone" from
    // "detached".
    let Ok(subscription) = subscribe_blocking(&manager, &id).await else {
        let mut socket = socket;
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: CLOSE_UNKNOWN_TERMINAL,
                reason: "unknown terminal".into(),
            })))
            .await;
        return;
    };

    let (mut sender, mut receiver) = socket.split();

    // The WS is a pure live stream, so discard the subscription's replay bytes
    // (like the Tauri drain does) — the client fetches scrollback separately via
    // the `replay` route after connecting.
    drop(subscription.replay);

    // Outbound: session messages → WS frames.
    let mut send_task = {
        let manager = Arc::clone(&manager);
        let id = id.clone();
        let mut rx = subscription.rx;
        tokio::spawn(async move {
            loop {
                while let Some(msg) = rx.recv().await {
                    let frame = match msg {
                        TerminalMessage::Output { data, seq } => {
                            Message::Binary(frame_output(seq, &data).into())
                        }
                        TerminalMessage::Status(status) => {
                            let frame = StatusFrame {
                                t: "status",
                                status: &status,
                            };
                            match serde_json::to_string(&frame) {
                                Ok(json) => Message::Text(json.into()),
                                Err(_) => continue,
                            }
                        }
                        TerminalMessage::Exit(exit_code) => {
                            let frame = ExitFrame {
                                t: "exit",
                                exit_code,
                            };
                            if let Ok(json) = serde_json::to_string(&frame) {
                                let _ = sender.send(Message::Text(json.into())).await;
                            }
                            let _ = sender.send(Message::Close(None)).await;
                            return;
                        }
                    };
                    if sender.send(frame).await.is_err() {
                        return; // client went away
                    }
                }

                // The channel closed while the session may still be alive: this
                // consumer fell behind and was dropped. Re-subscribe and carry
                // on, discarding the fresh replay (the client already has the
                // earlier bytes). Mirrors the Tauri drain guard.
                match subscribe_blocking(&manager, &id).await {
                    Ok(sub) => rx = sub.rx,
                    Err(_) => return, // session is gone for good
                }
            }
        })
    };

    // Inbound: WS frames → PTY stdin / resize. Blocking manager calls run on the
    // blocking pool. Socket close ends this task but does NOT kill the session.
    let mut recv_task = {
        let manager = Arc::clone(&manager);
        let id = id.clone();
        tokio::spawn(async move {
            while let Some(Ok(msg)) = receiver.next().await {
                match msg {
                    Message::Binary(data) => {
                        let manager = Arc::clone(&manager);
                        let id = id.clone();
                        let _ =
                            tokio::task::spawn_blocking(move || manager.write(&id, &data)).await;
                    }
                    Message::Text(text) => match serde_json::from_str::<ClientFrame>(&text) {
                        Ok(ClientFrame::Resize { cols, rows }) => {
                            let manager = Arc::clone(&manager);
                            let id = id.clone();
                            let _ = tokio::task::spawn_blocking(move || {
                                manager.resize(&id, cols, rows)
                            })
                            .await;
                        }
                        Err(_) => log::debug!("[terminal ws] ignoring unknown client frame"),
                    },
                    Message::Close(_) => break,
                    // Ping/Pong are answered by axum automatically.
                    _ => {}
                }
            }
        })
    };

    // Whichever side finishes first, tear down the other. Neither path kills the
    // session — a later reattach replays the ring and resumes.
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terminal::Phase;
    use axum::body::Body;
    use axum::http::{Request, StatusCode};
    use serde_json::{json, Value};
    use std::time::{Duration, Instant};
    use tower::ServiceExt as _;

    fn sample_status() -> SessionStatus {
        SessionStatus {
            id: TerminalId::from("t1"),
            phase: Phase::WaitingForInput,
            running_command: Some("claude".into()),
            last_exit_code: Some(0),
            cwd: Some("/tmp".into()),
            title: None,
            entered_state_at: 1_700_000_000_000,
            shell_integration_active: true,
        }
    }

    #[test]
    fn status_frame_is_tagged_and_camel_case() {
        let status = sample_status();
        let value = serde_json::to_value(StatusFrame {
            t: "status",
            status: &status,
        })
        .unwrap();
        assert_eq!(value["t"], "status");
        assert_eq!(value["phase"], "waiting_for_input");
        assert_eq!(value["runningCommand"], "claude");
        assert_eq!(value["lastExitCode"], 0);
        assert_eq!(value["shellIntegrationActive"], true);
        // Snake-case aliases must not leak.
        assert!(value.get("running_command").is_none());
    }

    #[test]
    fn exit_frame_is_tagged_and_camel_case() {
        let value = serde_json::to_value(ExitFrame {
            t: "exit",
            exit_code: None,
        })
        .unwrap();
        assert_eq!(value["t"], "exit");
        assert!(value["exitCode"].is_null());
        assert!(value.get("exit_code").is_none());

        let value = serde_json::to_value(ExitFrame {
            t: "exit",
            exit_code: Some(3),
        })
        .unwrap();
        assert_eq!(value["exitCode"], 3);
    }

    #[test]
    fn frame_output_prefixes_big_endian_seq_header() {
        let framed = frame_output(0x0102_0304_0506_0708, b"hi");
        assert_eq!(&framed[..8], &[1, 2, 3, 4, 5, 6, 7, 8]);
        assert_eq!(&framed[8..], b"hi");
        // The header round-trips as a big-endian u64.
        let seq = u64::from_be_bytes(framed[..8].try_into().unwrap());
        assert_eq!(seq, 0x0102_0304_0506_0708);
    }

    #[test]
    fn frame_output_of_empty_chunk_is_header_only() {
        let framed = frame_output(42, b"");
        assert_eq!(framed.len(), 8);
        assert_eq!(u64::from_be_bytes(framed.try_into().unwrap()), 42);
    }

    #[test]
    fn client_frame_parses_resize_and_rejects_unknown() {
        let ClientFrame::Resize { cols, rows } =
            serde_json::from_str(r#"{"t":"resize","cols":120,"rows":40}"#).unwrap();
        assert_eq!((cols, rows), (120, 40));

        assert!(serde_json::from_str::<ClientFrame>(r#"{"t":"bogus"}"#).is_err());
        assert!(serde_json::from_str::<ClientFrame>(r#"{"cols":1,"rows":1}"#).is_err());
    }

    #[test]
    fn is_loopback_host_matches_only_loopback() {
        assert!(is_loopback_host("localhost"));
        assert!(is_loopback_host("127.0.0.1"));
        assert!(is_loopback_host("::1"));
        assert!(!is_loopback_host("evil.com"));
        assert!(!is_loopback_host("0.0.0.0"));
        assert!(!is_loopback_host("127.0.0.1.evil.com"));
    }

    #[test]
    fn host_part_extracts_host_from_authority() {
        assert_eq!(host_part("localhost:1420"), "localhost");
        assert_eq!(host_part("127.0.0.1"), "127.0.0.1");
        assert_eq!(host_part("[::1]:8443"), "::1");
        assert_eq!(host_part("[::1]"), "::1");
    }

    #[test]
    fn origin_host_parses_scheme_host_port() {
        assert_eq!(origin_host("http://localhost:1420"), Some("localhost"));
        assert_eq!(origin_host("https://evil.com"), Some("evil.com"));
        assert_eq!(origin_host("http://[::1]:8443"), Some("::1"));
        // The opaque origin has no scheme separator and is not loopback.
        assert_eq!(origin_host("null"), None);
    }

    /// Send a header-only POST through a router carrying only the guard layer,
    /// and return the resulting status.
    async fn guarded_status(headers: &[(&str, &str)]) -> StatusCode {
        let app = Router::new()
            .route("/api/terminal/list", post(|| async { "ok" }))
            .layer(middleware::from_fn(guard_localhost));
        let mut builder = Request::builder().method("POST").uri("/api/terminal/list");
        for (name, value) in headers {
            builder = builder.header(*name, *value);
        }
        let request = builder.body(Body::empty()).unwrap();
        app.oneshot(request).await.unwrap().status()
    }

    #[tokio::test]
    async fn guard_allows_loopback_requests() {
        // No Origin + loopback Host: a curl / native client passes on (b) alone.
        assert_eq!(
            guarded_status(&[("host", "localhost:8443")]).await,
            StatusCode::OK
        );
        // The Vite dev origin against a loopback Host is allowed.
        assert_eq!(
            guarded_status(&[
                ("origin", "http://localhost:1420"),
                ("host", "localhost:8443"),
            ])
            .await,
            StatusCode::OK
        );
        // Loopback by IP literal, too.
        assert_eq!(
            guarded_status(&[
                ("origin", "http://127.0.0.1:3000"),
                ("host", "127.0.0.1:8443")
            ])
            .await,
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn guard_rejects_foreign_origin_and_rebound_host() {
        // A page on another origin is refused even with a loopback Host.
        assert_eq!(
            guarded_status(&[("origin", "https://evil.com"), ("host", "localhost:8443")]).await,
            StatusCode::FORBIDDEN
        );
        // DNS rebinding: an attacker domain resolving to 127.0.0.1 is refused.
        assert_eq!(
            guarded_status(&[("host", "attacker.tld")]).await,
            StatusCode::FORBIDDEN
        );
        // Deny by default when there is no Host header at all.
        assert_eq!(guarded_status(&[]).await, StatusCode::FORBIDDEN);
    }

    /// POST `body` to `uri` on a fresh clone of `app`; return status + JSON body.
    /// Sends a loopback `Host` so requests clear the origin/host guard.
    async fn post_json(app: &Router, uri: &str, body: Value) -> (StatusCode, Value) {
        let request = Request::builder()
            .method("POST")
            .uri(uri)
            .header("content-type", "application/json")
            .header("host", "localhost")
            .body(Body::from(body.to_string()))
            .unwrap();
        let response = app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
            .await
            .unwrap();
        let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
        (status, json)
    }

    #[tokio::test]
    async fn start_list_peek_kill_round_trip() {
        let manager = Arc::new(SessionManager::new());
        let app = routes(Arc::clone(&manager));
        let tmp = std::env::temp_dir().to_string_lossy().into_owned();
        let id = "web-rt-1";

        let (status, body) = post_json(
            &app,
            "/api/terminal/start",
            json!({
                "terminalId": id,
                "repoPath": tmp,
                "cwd": tmp,
                "cols": 80,
                "rows": 24,
                "shell": "/bin/sh",
            }),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body["id"], id);

        // `available` answers true without needing a body.
        let (_, avail) = post_json(&app, "/api/terminal/available", json!({})).await;
        assert_eq!(avail, json!(true));

        // `list` (unfiltered) sees the one session.
        let (_, all) = post_json(&app, "/api/terminal/list", json!({})).await;
        assert_eq!(all.as_array().unwrap().len(), 1);
        assert_eq!(all[0]["id"], id);

        // `peek` reflects echoed output once the VT actor catches up.
        let (wstatus, _) = post_json(
            &app,
            "/api/terminal/write",
            json!({ "terminalId": id, "data": "echo web-peek-xyz\n" }),
        )
        .await;
        assert_eq!(wstatus, StatusCode::OK);

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut saw_marker = false;
        while Instant::now() < deadline {
            let (pstatus, peek) =
                post_json(&app, "/api/terminal/peek", json!({ "terminalId": id })).await;
            if pstatus == StatusCode::OK && peek.as_str().unwrap_or("").contains("web-peek-xyz") {
                saw_marker = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
        assert!(saw_marker, "peek never reflected the echoed marker");

        // `replay` returns base64 scrollback, a byte cursor, and the status.
        let (rstatus, replay) =
            post_json(&app, "/api/terminal/replay", json!({ "terminalId": id })).await;
        assert_eq!(rstatus, StatusCode::OK);
        assert!(replay["dataB64"].is_string());
        assert!(replay["cursor"].is_u64());
        assert_eq!(replay["status"]["id"], id);

        let (status, _) = post_json(&app, "/api/terminal/kill", json!({ "terminalId": id })).await;
        assert_eq!(status, StatusCode::OK);

        manager.shutdown_all();
    }

    #[tokio::test]
    async fn list_filters_by_repo_path_and_unknown_ops_error() {
        let manager = Arc::new(SessionManager::new());
        let app = routes(Arc::clone(&manager));
        let tmp = std::env::temp_dir();
        let repo_a = tmp.join("web-repo-a").to_string_lossy().into_owned();
        let repo_b = tmp.join("web-repo-b").to_string_lossy().into_owned();
        let cwd = tmp.to_string_lossy().into_owned();

        for (id, repo) in [("wa", &repo_a), ("wb", &repo_b)] {
            let (status, _) = post_json(
                &app,
                "/api/terminal/start",
                json!({
                    "terminalId": id, "repoPath": repo, "cwd": cwd,
                    "cols": 80, "rows": 24, "shell": "/bin/sh",
                }),
            )
            .await;
            assert_eq!(status, StatusCode::OK);
        }

        let (_, only_a) =
            post_json(&app, "/api/terminal/list", json!({ "repoPath": repo_a })).await;
        assert_eq!(only_a.as_array().unwrap().len(), 1);
        assert_eq!(only_a[0]["id"], "wa");

        // Operating on a session that doesn't exist is a 500 with a message.
        let (status, _) = post_json(
            &app,
            "/api/terminal/write",
            json!({ "terminalId": "nope", "data": "x" }),
        )
        .await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);

        manager.shutdown_all();
    }
}
