//! Axum HTTP server — web-mode backend for the Review app.
//!
//! Feature-gated behind `server`. Serves the same business logic as the
//! Tauri desktop shell, but over HTTP + SSE instead of IPC.

mod handlers;

use axum::Router;
use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use tower_http::cors::{Any, CorsLayer};

/// Shared state across all handlers.
#[derive(Clone)]
pub struct AppState {
    pub active_groupings: Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>,
}

/// Build the full router with all API routes.
fn build_router() -> Router {
    let state = AppState {
        active_groupings: Arc::new(Mutex::new(HashMap::new())),
    };

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    handlers::build_api_router(state).layer(cors)
}

/// Start the HTTP server on the given port.
pub async fn serve(port: u16) {
    let app = build_router();
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}"))
        .await
        .expect("Failed to bind to address");
    axum::serve(listener, app).await.expect("Server error");
}
