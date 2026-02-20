//! Middleware for the companion server.

use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use log::debug;

use super::state::SharedState;

/// Log every request method and path.
pub async fn log_request(request: Request, next: Next) -> Response {
    debug!("{} {}", request.method(), request.uri().path());
    next.run(request).await
}

/// Bearer token authentication middleware.
/// Skipped for `/health` and in debug builds.
pub async fn auth(
    axum::extract::State(state): axum::extract::State<SharedState>,
    request: Request,
    next: Next,
) -> Response {
    if request.uri().path() == "/health" || cfg!(debug_assertions) {
        return next.run(request).await;
    }

    let Some(token) = &state.auth_token else {
        return unauthorized("Unauthorized: no auth token configured");
    };

    let header_value = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok());

    let expected = format!("Bearer {token}");
    if header_value != Some(expected.as_str()) {
        return unauthorized("Unauthorized");
    }

    next.run(request).await
}

fn unauthorized(message: &str) -> Response {
    (
        StatusCode::UNAUTHORIZED,
        axum::Json(serde_json::json!({ "error": message })),
    )
        .into_response()
}
