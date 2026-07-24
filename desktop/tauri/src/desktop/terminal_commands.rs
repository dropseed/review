//! Tauri command handlers for embedded terminal sessions.
//!
//! These are thin wrappers over [`review::terminal::SessionManager`] — the one
//! interface shared by the Tauri desktop and Axum web transports. Blocking
//! manager calls run on `spawn_blocking`; live PTY output reaches the frontend
//! through per-session Tauri events (see [`spawn_drain`]).
//!
//! The command signatures and emitted event/payload shapes are fixed by the
//! project's canonical wire contract (all JSON `camelCase`).

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use base64::Engine as _;
use log::info;
use review::terminal::{
    SessionManager, SessionSpec, SessionStatus, TerminalId, TerminalMessage, TerminalSummary,
};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc::Receiver;

/// Tauri-managed handle to the single [`SessionManager`] shared by all windows.
pub struct TerminalState(pub Arc<SessionManager>);

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

/// Run a blocking [`SessionManager`] call on the blocking pool, flattening the
/// join error and the manager's `anyhow` error into the `String` that Tauri
/// commands return. Non-fallible manager calls wrap their result in `Ok`.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, String> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())
}

/// Spawn the one long-lived task that drains a session's subscription and turns
/// each [`TerminalMessage`] into a Tauri event.
///
/// If the subscription's channel closes while the session is still alive — a
/// slow consumer the session dropped — we re-subscribe and keep going so events
/// never silently die. The fresh subscription's replay bytes are discarded here;
/// the frontend recovers any gap via `terminal_replay` on a cold reattach.
fn spawn_drain(
    app: AppHandle,
    manager: Arc<SessionManager>,
    id: TerminalId,
    mut rx: Receiver<TerminalMessage>,
) {
    let output_evt = format!("terminal:output:{id}");
    let status_evt = format!("terminal:status:{id}");
    let exit_evt = format!("terminal:exit:{id}");

    tokio::spawn(async move {
        loop {
            while let Some(msg) = rx.recv().await {
                match msg {
                    TerminalMessage::Output { data, seq } => {
                        let payload = TerminalOutputPayload {
                            id: id.to_string(),
                            data_b64: B64.encode(data.as_ref()),
                            seq,
                        };
                        let _ = app.emit(&output_evt, &payload);
                    }
                    TerminalMessage::Status(status) => {
                        // Per-session listeners plus a global roll-up for badges.
                        let _ = app.emit(&status_evt, &status);
                        let _ = app.emit("terminal:status-changed", &status);
                    }
                    TerminalMessage::Exit(exit_code) => {
                        let _ = app.emit(
                            &exit_evt,
                            &TerminalExitPayload {
                                id: id.to_string(),
                                exit_code,
                            },
                        );
                        return;
                    }
                }
            }

            // Channel closed. If the session is still alive, we were dropped as a
            // slow consumer — re-subscribe and continue. If it's gone, stop.
            match manager.subscribe(&id) {
                Ok(sub) => rx = sub.rx,
                Err(_) => return,
            }
        }
    });
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
    let id = TerminalId::from(terminal_id);

    let mut spec = SessionSpec::new(id.clone(), PathBuf::from(&repo_path), PathBuf::from(&cwd));
    spec.cols = cols;
    spec.rows = rows;
    spec.shell = shell.map(PathBuf::from);

    let manager = Arc::clone(&state.0);
    let summary = {
        let manager = Arc::clone(&manager);
        tokio::task::spawn_blocking(move || manager.start(spec))
            .await
            .map_err(|e| e.to_string())?
            .map_err(|e| e.to_string())?
    };

    // Subscribe after start (the session now exists); the fresh session's replay
    // is empty, so we discard it and just drain the live stream into events.
    let subscription = manager.subscribe(&id).map_err(|e| e.to_string())?;
    spawn_drain(app, manager, id.clone(), subscription.rx);

    info!("[terminal_start] {} in {:?}", id, t0.elapsed());
    Ok(summary)
}

/// Whether embedded terminals are supported in this build.
///
/// Always `true` in the desktop app: the `terminal` feature is compiled in and a
/// real PTY is available. Mirrors the frontend `terminalsAvailable()` capability
/// probe (the web transport answers the equivalent via `/api/terminal/available`).
#[tauri::command]
pub fn terminals_available() -> bool {
    true
}

#[tauri::command]
pub async fn terminal_write(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    data: String,
) -> Result<(), String> {
    let id = TerminalId::from(terminal_id);
    let manager = Arc::clone(&state.0);
    blocking(move || manager.write(&id, data.as_bytes())).await
}

#[tauri::command]
pub async fn terminal_resize(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let id = TerminalId::from(terminal_id);
    let manager = Arc::clone(&state.0);
    blocking(move || manager.resize(&id, cols, rows)).await
}

#[tauri::command]
pub async fn terminal_kill(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
) -> Result<(), String> {
    let id = TerminalId::from(terminal_id);
    let manager = Arc::clone(&state.0);
    blocking(move || manager.kill(&id)).await
}

#[tauri::command]
pub async fn terminal_list(
    state: tauri::State<'_, TerminalState>,
    repo_path: Option<String>,
) -> Result<Vec<TerminalSummary>, String> {
    let manager = Arc::clone(&state.0);
    blocking(move || Ok(manager.list(repo_path.as_deref()))).await
}

#[tauri::command]
pub async fn terminal_replay(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
) -> Result<TerminalReplay, String> {
    let id = TerminalId::from(terminal_id);
    let manager = Arc::clone(&state.0);
    blocking(move || {
        let (bytes, cursor, status) = manager.replay(&id)?;
        Ok(TerminalReplay {
            data_b64: B64.encode(&bytes),
            cursor,
            status,
        })
    })
    .await
}

#[tauri::command]
pub async fn terminal_peek(
    state: tauri::State<'_, TerminalState>,
    terminal_id: String,
) -> Result<String, String> {
    let id = TerminalId::from(terminal_id);
    let manager = Arc::clone(&state.0);
    blocking(move || manager.peek(&id)).await
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
