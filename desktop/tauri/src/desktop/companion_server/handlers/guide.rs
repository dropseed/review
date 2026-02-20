use axum::Json;
use review::ai::grouping::GroupingInput;
use review::review::state::HunkGroup;
use serde::Deserialize;
use std::path::PathBuf;

use crate::desktop::companion_server::error::ApiError;
use crate::desktop::companion_server::extractors::RepoPath;

// --- Generate hunk grouping ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::desktop::companion_server) struct GenerateGroupsRequest {
    hunks: Vec<GroupingInput>,
}

pub async fn generate_groups(
    RepoPath(repo): RepoPath,
    axum::extract::Path(_comp): axum::extract::Path<String>,
    Json(body): Json<GenerateGroupsRequest>,
) -> Result<Json<Vec<HunkGroup>>, ApiError> {
    let repo_path_buf = PathBuf::from(&repo);

    let groups = tokio::task::spawn_blocking(move || {
        review::ai::grouping::generate_grouping(&body.hunks, &repo_path_buf, &[])
    })
    .await
    .map_err(|e| ApiError::Internal(e.to_string()))?
    .map_err(|e| ApiError::Internal(e.to_string()))?;

    Ok(Json(groups))
}
