//! Axum HTTP server — web-mode backend for the Review app.
//!
//! Feature-gated behind `server`. Serves the same business logic as the
//! Tauri desktop shell, but over HTTP + SSE instead of IPC.

mod handlers;
mod terminal;

use std::sync::Arc;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};

use crate::terminal::SessionManager;

/// Build the full router with all API routes, sharing `manager` with the
/// terminal handlers.
fn build_router(manager: Arc<SessionManager>) -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    handlers::build_api_router(manager).layer(cors)
}

/// Start the HTTP server on the given port.
pub async fn serve(port: u16) {
    // One terminal SessionManager per server process, shared across all requests
    // (each WebSocket subscribes to it). Owned here so we can tear sessions down
    // on shutdown.
    let manager = Arc::new(SessionManager::new());
    let app = build_router(Arc::clone(&manager));

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .expect("Failed to bind to address");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("Server error");

    // portable-pty spawns each child via `setsid`, so children are session
    // leaders in their own process groups — they are NOT in the server's group
    // and would not be reaped by a process-group signal on exit. (Closing the
    // PTY master does send SIGHUP as a backstop, but that only fires on an
    // orderly fd teardown.) Kill every child explicitly on graceful shutdown.
    manager.shutdown_all();
}

/// Resolve when the process is asked to stop (Ctrl-C, or SIGTERM on Unix).
async fn shutdown_signal() {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };

    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut signal) => {
                signal.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {}
        () = terminate => {}
    }
}
