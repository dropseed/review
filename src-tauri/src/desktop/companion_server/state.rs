//! Shared application state for the companion server.

use std::sync::Arc;

/// Shared state accessible by all handlers via axum's State extractor.
#[derive(Clone)]
pub struct AppState {
    pub auth_token: Option<String>,
}

pub type SharedState = Arc<AppState>;
