use axum::Json;
use review::review::storage::GlobalReviewSummary;
use serde::Serialize;

use crate::desktop::commands;

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct HealthResponse {
    ok: bool,
}

pub async fn health() -> Json<HealthResponse> {
    Json(HealthResponse { ok: true })
}

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct InfoResponse {
    version: String,
    hostname: String,
    repos: Vec<GlobalReviewSummary>,
}

pub async fn info() -> Json<InfoResponse> {
    let version = env!("CARGO_PKG_VERSION").to_string();
    let hostname = std::process::Command::new("hostname")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|_| "unknown".to_string());
    let repos = commands::list_all_reviews_global().unwrap_or_default();
    Json(InfoResponse {
        version,
        hostname,
        repos,
    })
}
