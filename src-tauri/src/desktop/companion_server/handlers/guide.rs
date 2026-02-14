use axum::Json;
use review::ai::grouping::GroupingInput;
use review::ai::summary::{SummaryInput, SummaryResult};
use review::review::state::HunkGroup;
use serde::Deserialize;

use crate::desktop::commands;
use crate::desktop::companion_server::error::ApiError;
use crate::desktop::companion_server::extractors::RepoPath;

// --- Generate hunk grouping ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::desktop::companion_server) struct GenerateGroupsRequest {
    hunks: Vec<GroupingInput>,
    model: Option<String>,
    command: Option<String>,
}

pub async fn generate_groups(
    RepoPath(repo): RepoPath,
    axum::extract::Path(_comp): axum::extract::Path<String>,
    Json(body): Json<GenerateGroupsRequest>,
) -> Result<Json<Vec<HunkGroup>>, ApiError> {
    let groups = commands::generate_hunk_grouping(repo, body.hunks, body.model, body.command, None)
        .await
        .map_err(ApiError::Internal)?;
    Ok(Json(groups))
}

// --- Generate review summary ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::desktop::companion_server) struct GenerateSummaryRequest {
    hunks: Vec<SummaryInput>,
    model: Option<String>,
    command: Option<String>,
}

pub async fn generate_summary(
    RepoPath(repo): RepoPath,
    axum::extract::Path(_comp): axum::extract::Path<String>,
    Json(body): Json<GenerateSummaryRequest>,
) -> Result<Json<SummaryResult>, ApiError> {
    let result = commands::generate_review_summary(repo, body.hunks, body.model, body.command)
        .await
        .map_err(ApiError::Internal)?;
    Ok(Json(result))
}
