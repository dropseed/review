//! Companion HTTPS server for mobile app connectivity.
//! Listens on 0.0.0.0:<port> with TLS so mobile devices on the same network can connect securely.

mod error;
mod extractors;
mod handlers;
mod middleware;
mod router;
mod state;
pub mod tls;

use log::{error, info, warn};
use state::{AppState, SharedState};
use std::net::{Ipv4Addr, SocketAddr};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

static SERVER_RUNNING: AtomicBool = AtomicBool::new(false);
static SHUTDOWN_HANDLE: Mutex<Option<axum_server::Handle<SocketAddr>>> = Mutex::new(None);
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
pub fn start(port: u16, cert_path: PathBuf, key_path: PathBuf) {
    if SERVER_RUNNING.swap(true, Ordering::SeqCst) {
        warn!("Already running");
        return;
    }

    info!(
        "Starting on port {port}, cert={}, key={}",
        cert_path.display(),
        key_path.display()
    );

    if let Ok(mut guard) = CURRENT_PORT.lock() {
        *guard = port;
    }

    let token = AUTH_TOKEN.lock().ok().and_then(|g| g.clone());

    let handle = axum_server::Handle::new();
    if let Ok(mut guard) = SHUTDOWN_HANDLE.lock() {
        *guard = Some(handle.clone());
    }

    tauri::async_runtime::spawn(async move {
        if let Err(e) = run_server(port, token, handle, cert_path, key_path).await {
            error!("Server error: {e}");
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
    if let Ok(mut guard) = SHUTDOWN_HANDLE.lock() {
        if let Some(handle) = guard.take() {
            info!("Shutting down");
            handle.graceful_shutdown(Some(std::time::Duration::from_secs(5)));
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
    handle: axum_server::Handle<SocketAddr>,
    cert_path: PathBuf,
    key_path: PathBuf,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let state: SharedState = Arc::new(AppState { auth_token: token });

    let app = router::build_router(state);
    let addr = SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));

    // rustls 0.23 requires an explicit crypto provider; install ring if not yet set.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let tls_config = axum_server::tls_rustls::RustlsConfig::from_pem_file(&cert_path, &key_path)
        .await
        .map_err(|e| {
            format!(
                "Failed to load TLS config from {}: {e}",
                cert_path.display()
            )
        })?;

    info!("Listening on https://{addr}");

    axum_server::bind_rustls(addr, tls_config)
        .handle(handle)
        .serve(app.into_make_service())
        .await?;

    Ok(())
}
