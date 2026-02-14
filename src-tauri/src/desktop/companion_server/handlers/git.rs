use axum::Json;
use review::sources::local_git::RemoteInfo;
use review::sources::traits::{BranchList, CommitDetail, CommitEntry, GitStatusSummary};
use serde::{Deserialize, Serialize};

use crate::desktop::commands;
use crate::desktop::companion_server::error::ApiError;
use crate::desktop::companion_server::extractors::RepoPath;

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct RepoResponse {
    path: String,
}

pub async fn get_repo() -> Result<Json<RepoResponse>, ApiError> {
    let path = commands::get_current_repo().map_err(ApiError::Internal)?;
    Ok(Json(RepoResponse { path }))
}

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct BranchResponse {
    branch: String,
}

pub async fn list_branches(RepoPath(repo): RepoPath) -> Result<Json<BranchList>, ApiError> {
    let branches = commands::list_branches(repo).map_err(ApiError::Internal)?;
    Ok(Json(branches))
}

pub async fn get_default_branch(
    RepoPath(repo): RepoPath,
) -> Result<Json<BranchResponse>, ApiError> {
    let branch = commands::get_default_branch(repo).map_err(ApiError::Internal)?;
    Ok(Json(BranchResponse { branch }))
}

pub async fn get_current_branch(
    RepoPath(repo): RepoPath,
) -> Result<Json<BranchResponse>, ApiError> {
    let branch = commands::get_current_branch(repo).map_err(ApiError::Internal)?;
    Ok(Json(BranchResponse { branch }))
}

pub async fn get_status(RepoPath(repo): RepoPath) -> Result<Json<GitStatusSummary>, ApiError> {
    let status = commands::get_git_status(repo).map_err(ApiError::Internal)?;
    Ok(Json(status))
}

#[derive(Serialize)]
pub(in crate::desktop::companion_server) struct RawStatusResponse {
    raw: String,
}

pub async fn get_status_raw(RepoPath(repo): RepoPath) -> Result<Json<RawStatusResponse>, ApiError> {
    let raw = commands::get_git_status_raw(repo).map_err(ApiError::Internal)?;
    Ok(Json(RawStatusResponse { raw }))
}

pub async fn get_remote_info(RepoPath(repo): RepoPath) -> Result<Json<RemoteInfo>, ApiError> {
    let info = commands::get_remote_info(repo).map_err(ApiError::Internal)?;
    Ok(Json(info))
}

#[derive(Deserialize)]
pub(in crate::desktop::companion_server) struct CommitsQuery {
    limit: Option<usize>,
    branch: Option<String>,
}

pub async fn list_commits(
    RepoPath(repo): RepoPath,
    axum::extract::Query(q): axum::extract::Query<CommitsQuery>,
) -> Result<Json<Vec<CommitEntry>>, ApiError> {
    let commits = commands::list_commits(repo, q.limit, q.branch).map_err(ApiError::Internal)?;
    Ok(Json(commits))
}

pub async fn get_commit_detail_path(
    RepoPath(repo): RepoPath,
    axum::extract::Path(hash): axum::extract::Path<String>,
) -> Result<Json<CommitDetail>, ApiError> {
    let detail = commands::get_commit_detail(repo, hash).map_err(ApiError::Internal)?;
    Ok(Json(detail))
}
