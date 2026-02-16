use axum::Json;
use review::diff::parser::DiffHunk;
use review::review::state::ReviewState;
use review::sources::local_git::DiffShortStat;
use review::sources::traits::FileEntry;
use serde::{Deserialize, Serialize};

use crate::desktop::commands::{self, FileContent};
use crate::desktop::companion_server::error::ApiError;
use crate::desktop::companion_server::extractors::{parse_comparison, RepoPath};

fn build_github_pr(
    pr_number: Option<u32>,
    pr_title: Option<String>,
    base: &str,
    head: &str,
) -> Option<review::sources::github::GitHubPrRef> {
    let number = pr_number?;
    Some(review::sources::github::GitHubPrRef {
        number,
        title: pr_title.unwrap_or_default(),
        head_ref_name: head.to_string(),
        base_ref_name: base.to_string(),
        body: None,
    })
}

#[derive(Deserialize)]
pub(in crate::desktop::companion_server) struct CompFilesQuery {
    #[serde(rename = "prNumber")]
    pr_number: Option<u32>,
    #[serde(rename = "prTitle")]
    pr_title: Option<String>,
}

// --- Files ---

pub async fn list_files(
    RepoPath(repo): RepoPath,
    axum::extract::Path(comp): axum::extract::Path<String>,
    axum::extract::Query(q): axum::extract::Query<CompFilesQuery>,
) -> Result<Json<Vec<FileEntry>>, ApiError> {
    let comparison = parse_comparison(&comp)?;
    let github_pr = build_github_pr(q.pr_number, q.pr_title, &comparison.base, &comparison.head);
    let files =
        commands::list_files_sync(repo, comparison, github_pr).map_err(ApiError::Internal)?;
    Ok(Json(files))
}

pub async fn get_file(
    RepoPath(repo): RepoPath,
    axum::extract::Path((comp, file_path)): axum::extract::Path<(String, String)>,
    axum::extract::Query(q): axum::extract::Query<CompFilesQuery>,
) -> Result<Json<FileContent>, ApiError> {
    let comparison = parse_comparison(&comp)?;
    let github_pr = build_github_pr(q.pr_number, q.pr_title, &comparison.base, &comparison.head);
    let content = commands::get_file_content_sync(repo, file_path, comparison, github_pr)
        .map_err(ApiError::Internal)?;
    Ok(Json(content))
}

// --- Diff stats ---

pub async fn diff_shortstat(
    RepoPath(repo): RepoPath,
    axum::extract::Path(comp): axum::extract::Path<String>,
) -> Result<Json<DiffShortStat>, ApiError> {
    let comparison = parse_comparison(&comp)?;
    let stats = commands::get_diff_shortstat(repo, comparison).map_err(ApiError::Internal)?;
    Ok(Json(stats))
}

// --- Hunks ---

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(in crate::desktop::companion_server) struct HunksBody {
    file_paths: Vec<String>,
}

pub async fn get_all_hunks(
    RepoPath(repo): RepoPath,
    axum::extract::Path(comp): axum::extract::Path<String>,
    Json(body): Json<HunksBody>,
) -> Result<Json<Vec<DiffHunk>>, ApiError> {
    let comparison = parse_comparison(&comp)?;
    let hunks = commands::get_all_hunks_sync(repo, comparison, body.file_paths)
        .map_err(ApiError::Internal)?;
    Ok(Json(hunks))
}

// --- Review state ---

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct SaveResponse {
    version: u64,
}

pub async fn get_review(
    RepoPath(repo): RepoPath,
    axum::extract::Path(comp): axum::extract::Path<String>,
) -> Result<Json<ReviewState>, ApiError> {
    let comparison = parse_comparison(&comp)?;
    // Check if the review exists on disk — return 404 if it was deleted
    // rather than recreating it (which would resurrect deleted reviews).
    let exists =
        commands::review_exists(repo.clone(), comparison.clone()).map_err(ApiError::Internal)?;
    if !exists {
        return Err(ApiError::NotFound("Review not found".to_string()));
    }
    let state = commands::load_review_state(repo, comparison).map_err(ApiError::Internal)?;
    Ok(Json(state))
}

pub async fn save_review(
    RepoPath(repo): RepoPath,
    axum::extract::Path(_comp): axum::extract::Path<String>,
    Json(state): Json<ReviewState>,
) -> Result<Json<SaveResponse>, ApiError> {
    let version = commands::save_review_state(repo, state).map_err(ApiError::Internal)?;
    Ok(Json(SaveResponse { version }))
}

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct DeleteResponse {
    success: bool,
}

pub async fn delete_review(
    RepoPath(repo): RepoPath,
    axum::extract::Path(comp): axum::extract::Path<String>,
) -> Result<Json<DeleteResponse>, ApiError> {
    let comparison = parse_comparison(&comp)?;
    commands::delete_review(repo, comparison).map_err(ApiError::Internal)?;
    Ok(Json(DeleteResponse { success: true }))
}
