//! Axum HTTP server — web-mode backend for the Review app.
//!
//! Feature-gated behind `server`. Serves the same business logic as the
//! Tauri desktop shell, but over HTTP + SSE instead of IPC.
//!
//! Terminals work here too: [`terminal`] bridges `/api/terminal/*` (POST for
//! control, one WebSocket per session for live PTY bytes) onto the
//! `review-daemon` process, which owns the PTYs. This server is a thin client
//! of that daemon — it attaches to one that is already running and never spawns
//! one, so a browser tab and the desktop app drive the same sessions.
//!
//! With `REVIEW_WEB_DIST` set, [`serve`] also serves a built Vite bundle, so one
//! port carries the whole app (handy behind `tailscale serve`).

mod handlers;
mod terminal;

use axum::Router;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::{ServeDir, ServeFile};

/// Environment variable naming a built Vite `dist/` to serve alongside the API.
const WEB_DIST_ENV: &str = "REVIEW_WEB_DIST";

/// Build the full router with all API routes.
fn build_router() -> Router {
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let api = handlers::build_api_router().merge(terminal::router(terminal::TerminalBridge::new()));

    // The bundle is a *fallback*, so every `/api` route still wins; anything
    // else that isn't a real file falls through to `index.html`, which is what
    // client-side routing needs.
    let app = match std::env::var(WEB_DIST_ENV) {
        Ok(dist) if !dist.is_empty() => {
            log::info!("[server] serving the web bundle from {dist}");
            let index = std::path::Path::new(&dist).join("index.html");
            api.fallback_service(ServeDir::new(&dist).fallback(ServeFile::new(index)))
        }
        _ => api,
    };

    app.layer(cors)
}

/// Start the HTTP server on the given port.
///
/// The bind address is `$REVIEW_BIND` (default `127.0.0.1`), so serving a
/// tailnet or a LAN needs an environment variable rather than a code change.
pub async fn serve(port: u16) {
    let app = build_router();

    let host = bind_host();
    let listener = tokio::net::TcpListener::bind(format!("{host}:{port}"))
        .await
        .expect("Failed to bind to address");
    axum::serve(listener, app)
        .with_graceful_shutdown(crate::signal::shutdown_signal())
        .await
        .expect("Server error");
}

/// The address to bind: `$REVIEW_BIND`, or loopback.
pub fn bind_host() -> String {
    match std::env::var("REVIEW_BIND") {
        Ok(host) if !host.trim().is_empty() => host.trim().to_owned(),
        _ => "127.0.0.1".to_owned(),
    }
}
