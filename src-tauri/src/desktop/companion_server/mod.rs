//! Companion HTTP server for mobile app connectivity.
//! Listens on 0.0.0.0:<port> so mobile devices on the same network can connect.

mod error;
mod extractors;
mod handlers;
mod middleware;
mod router;
mod state;

use state::{AppState, SharedState};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tokio::sync::watch;

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SHUTDOWN_TX: Mutex<Option<watch::Sender<bool>>> = Mutex::new(None);
static AUTH_TOKEN: Mutex<Option<String>> = Mutex::new(None);
static CURRENT_PORT: Mutex<u16> = Mutex::new(3333);

/// Set the bearer token required for authentication.
/// Pass `None` to disable authentication.
pub fn set_auth_token(token: Option<String>) {
    if let Ok(mut guard) = AUTH_TOKEN.lock() {
        *guard = token;
    }
}

/// Start the companion server as an async task.
/// Only starts if not already running.
pub fn start(port: u16) {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        eprintln!("[companion_server] Already running");
        return;
    }

    if let Ok(mut guard) = CURRENT_PORT.lock() {
        *guard = port;
    }

    let token = AUTH_TOKEN.lock().ok().and_then(|g| g.clone());

    let (tx, rx) = watch::channel(false);
    if let Ok(mut guard) = SHUTDOWN_TX.lock() {
        *guard = Some(tx);
    }

    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_server(port, token, rx).await {
            eprintln!("[companion_server] Server error: {e}");
        }
        SERVER_RUNNING.store(false, Ordering::SeqCst);
    });
}

/// Get the port the companion server is (or will be) listening on.
pub fn get_port() -> u16 {
    CURRENT_PORT.lock().map(|g| *g).unwrap_or(3333)
}

/// Stop the companion server if it is running.
pub fn stop() {
    if let Ok(mut guard) = SHUTDOWN_TX.lock() {
        if let Some(tx) = guard.take() {
            let _ = tx.send(true);
        }
    }
}

/// Check if the companion server is currently running.
pub fn is_running() -> bool {
    SERVER_RUNNING.load(Ordering::SeqCst)
}

async fn run_server(
    port: u16,
    token: Option<String>,
    mut shutdown_rx: watch::Receiver<bool>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state: SharedState = Arc::new(AppState { auth_token: token });

    let app = router::build_router(state);

    let addr = format!("0.0.0.0:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    eprintln!("[companion_server] Listening on http://{addr}");

    axum::serve(listener, app)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.wait_for(|&v| v).await;
            eprintln!("[companion_server] Shutting down");
        })
        .await?;

    Ok(())
}
