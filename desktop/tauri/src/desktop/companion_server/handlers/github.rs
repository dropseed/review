use axum::Json;
use review::sources::github::PullRequest;
use serde::Serialize;

use crate::desktop::commands;
use crate::desktop::companion_server::error::ApiError;
use crate::desktop::companion_server::extractors::RepoPath;

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct AvailableResponse {
    available: bool,
}

pub async fn check_available(RepoPath(repo): RepoPath) -> Json<AvailableResponse> {
    let available = commands::check_github_available(repo);
    Json(AvailableResponse { available })
}

pub async fn list_prs(RepoPath(repo): RepoPath) -> Result<Json<Vec<PullRequest>>, ApiError> {
    let prs = commands::list_pull_requests(repo).map_err(ApiError::Internal)?;
    Ok(Json(prs))
}
