//! Escalating "a workspace wants attention" off this machine.
//!
//! The frontend owns the attention edges and the native notification — a
//! banner on the Mac the user is sitting at needs nothing from here. What this
//! module owns is the question that banner cannot answer: whether the signal
//! should also reach a phone, over web push, because nobody is going to see it
//! here.
//!
//! The ladder is deliberately two-rung: already idle means push now, and
//! otherwise the signal watches for the user to leave. It never pushes while
//! they are demonstrably at this machine — the banner and dock badge have that
//! case — so a phone on the desk stays quiet.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use review::push::{self, NotificationPayload};
use tauri::{AppHandle, Manager};

/// Idle at least this long means the human is away from this machine, so a
/// push is the only thing that reaches them — send it immediately.
const IDLE_PUSH_SECS: u64 = 60;

/// Otherwise they are here, and the banner and badge have it covered. An armed
/// escalation re-checks idleness this often, so leaving without acking sends
/// the signal after them.
const ESCALATE_POLL_SECS: u64 = 30;

/// How long an unacked signal keeps watching for the human to leave before it
/// lapses. Past this the dock badge is the durable record — a push about
/// something this old is noise, not news.
const ESCALATE_WINDOW_SECS: u64 = 15 * 60;

/// Pending push escalations, keyed by workspace id.
///
/// The value is a generation counter, not a task handle, because a spawned
/// sleep cannot be cancelled: a timer fires only if the generation it was
/// armed with is still the one on record. A newer signal for the same
/// workspace overwrites it — the older timer wakes up, finds a generation that
/// isn't its own, and does nothing — and an ack removes the entry entirely.
#[derive(Default)]
pub struct NotificationHub {
    pending: Mutex<HashMap<String, u64>>,
    generation: AtomicU64,
}

impl NotificationHub {
    /// Arm an escalation for this workspace, superseding any earlier one.
    fn arm(&self, workspace_id: &str) -> u64 {
        let token = self.generation.fetch_add(1, Ordering::Relaxed) + 1;
        let mut pending = self.pending.lock().unwrap();
        pending.insert(workspace_id.to_owned(), token);
        token
    }

    /// Take this workspace's escalation if `token` is still the current one.
    fn claim(&self, workspace_id: &str, token: u64) -> bool {
        let mut pending = self.pending.lock().unwrap();
        if pending.get(workspace_id) == Some(&token) {
            pending.remove(workspace_id);
            true
        } else {
            false
        }
    }

    /// Whether this workspace's escalation is still the one `token` armed.
    fn armed(&self, workspace_id: &str, token: u64) -> bool {
        self.pending.lock().unwrap().get(workspace_id) == Some(&token)
    }

    fn cancel(&self, workspace_id: &str) {
        self.pending.lock().unwrap().remove(workspace_id);
    }
}

/// A workspace wants attention. Escalates to web push per the ladder above;
/// does nothing at all when there is nothing subscribed to push to.
#[tauri::command]
pub async fn notify_attention(
    workspace_id: String,
    title: String,
    body: String,
    app: AppHandle,
    state: tauri::State<'_, NotificationHub>,
) -> Result<(), String> {
    match push::subscription_count() {
        Ok(0) => return Ok(()),
        Ok(_) => {}
        Err(err) => {
            log::warn!("[notify] push subscriptions unreadable, not escalating: {err}");
            return Ok(());
        }
    }

    let payload = NotificationPayload {
        title,
        body,
        url: Some(format!("/?workspace={workspace_id}")),
        tag: Some(workspace_id.clone()),
    };

    if idle_seconds().await >= IDLE_PUSH_SECS {
        state.cancel(&workspace_id);
        send(&payload).await;
        return Ok(());
    }

    let token = state.arm(&workspace_id);
    tauri::async_runtime::spawn(async move {
        let hub = app.state::<NotificationHub>();
        for _ in 0..(ESCALATE_WINDOW_SECS / ESCALATE_POLL_SECS) {
            tokio::time::sleep(Duration::from_secs(ESCALATE_POLL_SECS)).await;
            if !hub.armed(&workspace_id, token) {
                return;
            }
            if idle_seconds().await >= IDLE_PUSH_SECS {
                if hub.claim(&workspace_id, token) {
                    send(&payload).await;
                }
                return;
            }
        }
        // They stayed, and never acked. Lapse quietly — claim only so a newer
        // signal's entry is left alone.
        let _ = hub.claim(&workspace_id, token);
    });

    Ok(())
}

/// The user saw it here — drop any escalation still waiting to leave.
#[tauri::command]
pub fn notify_ack(workspace_id: String, state: tauri::State<'_, NotificationHub>) {
    state.cancel(&workspace_id);
}

/// Set the dock badge, clearing it at zero.
#[tauri::command]
pub fn set_dock_badge(count: u32, app: AppHandle) -> Result<(), String> {
    // The badge belongs to the app's dock tile, not to a window, so any one
    // window sets it for the whole app. `None` clears it; `Some(0)` would
    // draw a literal "0".
    let badge = (count > 0).then_some(count as i64);
    let Some((_, window)) = app.webview_windows().into_iter().next() else {
        return Ok(());
    };
    window.set_badge_count(badge).map_err(|e| e.to_string())
}

/// Seconds since the last human input on this machine — keyboard, mouse, or
/// trackpad. The read forks `ioreg`, so it runs on the blocking pool rather
/// than stalling the shared runtime for the milliseconds that takes.
async fn idle_seconds() -> u64 {
    tauri::async_runtime::spawn_blocking(read_idle_seconds)
        .await
        .unwrap_or(0)
}

/// `IOHIDSystem`'s `HIDIdleTime` is in nanoseconds.
#[cfg(target_os = "macos")]
fn read_idle_seconds() -> u64 {
    let output = match std::process::Command::new("ioreg")
        .args(["-c", "IOHIDSystem"])
        .output()
    {
        Ok(output) => output,
        Err(err) => {
            log::warn!("[notify] idle time unreadable, assuming present: {err}");
            return 0;
        }
    };

    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| {
            let (_, rest) = line.split_once("\"HIDIdleTime\"")?;
            let value = rest.trim_start().strip_prefix('=')?.trim();
            value.parse::<u64>().ok()
        })
        .map(|nanos| nanos / 1_000_000_000)
        .unwrap_or(0)
}

#[cfg(not(target_os = "macos"))]
fn read_idle_seconds() -> u64 {
    0
}

async fn send(payload: &NotificationPayload) {
    match push::send_to_all(payload).await {
        Ok(report) => log::info!(
            "[notify] pushed \"{}\": {} sent, {} failed, {} pruned",
            payload.title,
            report.sent,
            report.failed,
            report.pruned
        ),
        Err(err) => log::warn!("[notify] push failed: {err}"),
    }
}
