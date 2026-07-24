//! Axum HTTP server — web-mode backend for the Review app.
//!
//! Feature-gated behind `server`. Serves the same business logic as the
//! Tauri desktop shell, but over HTTP + SSE instead of IPC.
//!
//! Web mode has **no terminals**: PTYs live in the `review-daemon` process (see
//! [`crate::daemon`]) and are reached only by the desktop app. Nothing served
//! here holds per-process state, so the router is built from nothing.

mod handlers;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};

/// Build the full router with all API routes.
fn build_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    handlers::build_api_router().layer(cors)
}

/// Start the HTTP server on the given port.
pub async fn serve(port: u16) {
    let app = build_router();

    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .expect("Failed to bind to address");
    axum::serve(listener, app)
        .with_graceful_shutdown(crate::signal::shutdown_signal())
        .await
        .expect("Server error");
}
