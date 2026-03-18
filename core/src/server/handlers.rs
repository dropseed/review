//! HTTP handlers for the Axum server.

use axum::extract::{Json, Query, State};
use axum::http::StatusCode;
use axum::response::sse::{Event, Sse};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;
use std::convert::Infallible;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::classify::{self, ClassifyResponse};
use crate::diff::parser::{detect_move_pairs, DiffHunk};
use crate::review::state::{ReviewState, ReviewSummary};
use crate::review::storage::{self, GlobalReviewSummary};
use crate::service::*;
use crate::sources::github::{GhCliProvider, GitHubPrRef, GitHubProvider, PullRequest};
use crate::sources::local_git::{DiffShortStat, LocalGitSource, RemoteInfo, SearchMatch};
use crate::sources::traits::{
    BranchList, CommitDetail, CommitEntry, Comparison, DiffSource, FileEntry, GitStatusSummary,
};
use crate::symbols::{FileSymbolDiff, Symbol, SymbolDefinition};
use crate::trust::patterns::TrustCategory;

use super::AppState;

type ApiResult<T> = Result<Json<T>, (StatusCode, String)>;

fn internal_err(e: impl std::fmt::Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, e.to_string())
}

/// Wrap a `spawn_blocking` + anyhow result into an API result.
async fn blocking<T: Send + 'static>(
    f: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> ApiResult<T> {
    tokio::task::spawn_blocking(f)
        .await
        .map_err(internal_err)?
        .map_err(internal_err)
        .map(Json)
}

/// Build the API router with all routes.
pub fn build_api_router(state: AppState) -> Router {
    Router::new()
        // Git operations
        .route("/api/git/current-repo", post(git_current_repo))
        .route("/api/git/current-branch", post(git_current_branch))
        .route("/api/git/remote-info", post(git_remote_info))
        .route("/api/git/default-branch", post(git_default_branch))
        .route("/api/git/branches", post(git_branches))
        .route("/api/git/status", post(git_status))
        .route("/api/git/status-raw", post(git_status_raw))
        .route("/api/git/stage-file", post(git_stage_file))
        .route("/api/git/unstage-file", post(git_unstage_file))
        .route("/api/git/unstage-all", post(git_unstage_all))
        .route("/api/git/stage-hunks", post(git_stage_hunks))
        .route("/api/git/unstage-hunks", post(git_unstage_hunks))
        .route("/api/git/commits", post(git_commits))
        .route("/api/git/commit-detail", post(git_commit_detail))
        .route("/api/git/diff", post(git_diff))
        .route("/api/git/diff-shortstat", post(git_diff_shortstat))
        .route(
            "/api/git/working-tree-file-content",
            post(git_working_tree_file_content),
        )
        // GitHub
        .route("/api/github/available", post(github_available))
        .route("/api/github/pull-requests", post(github_pull_requests))
        // Files
        .route("/api/files/list", post(files_list))
        .route("/api/files/list-all", post(files_list_all))
        .route("/api/files/list-repo", post(files_list_repo))
        .route(
            "/api/files/directory-contents",
            post(files_directory_contents),
        )
        .route("/api/files/content", post(files_content))
        .route("/api/files/all-hunks", post(files_all_hunks))
        .route("/api/files/expanded-context", post(files_expanded_context))
        .route("/api/files/search", post(files_search))
        .route("/api/files/read-raw", post(files_read_raw))
        .route("/api/files/raw-content", post(files_raw_content))
        .route("/api/files/directory-plain", post(files_directory_plain))
        // Review
        .route("/api/review/load", post(review_load))
        .route("/api/review/save", post(review_save))
        .route("/api/review/list", post(review_list))
        .route("/api/review/delete", post(review_delete))
        .route("/api/review/exists", post(review_exists))
        .route("/api/review/ensure-exists", post(review_ensure_exists))
        .route("/api/review/list-global", post(review_list_global))
        .route("/api/review/root", post(review_root))
        .route("/api/review/storage-path", post(review_storage_path))
        .route("/api/review/freshness", post(review_freshness))
        // Classification
        .route("/api/classify/static", post(classify_static))
        .route("/api/classify/move-pairs", post(classify_move_pairs))
        // Trust
        .route("/api/trust/taxonomy", post(trust_taxonomy))
        .route("/api/trust/match", post(trust_match))
        .route("/api/trust/skip-file", post(trust_skip_file))
        // Symbols
        .route("/api/symbols/diffs", post(symbols_diffs))
        .route("/api/symbols/definitions", post(symbols_definitions))
        .route("/api/symbols/file", post(symbols_file))
        .route("/api/symbols/repo", post(symbols_repo))
        // Activity
        .route("/api/activity/list", post(activity_list))
        .route("/api/activity/register", post(activity_register))
        .route("/api/activity/unregister", post(activity_unregister))
        // Misc
        .route("/api/misc/is-git-repo", post(misc_is_git_repo))
        .route("/api/misc/path-is-file", post(misc_path_is_file))
        .route("/api/misc/vscode-theme", post(misc_vscode_theme))
        .route("/api/misc/resolve-repo-path", post(misc_resolve_repo_path))
        // Streaming
        .route(
            "/api/streaming/generate-grouping",
            post(streaming_generate_grouping),
        )
        .route(
            "/api/streaming/cancel-grouping",
            post(streaming_cancel_grouping),
        )
        .route("/api/streaming/git-commit", post(streaming_git_commit))
        .route(
            "/api/streaming/generate-commit-message",
            post(streaming_generate_commit_message),
        )
        // File watcher SSE
        .route("/api/events", get(events_sse))
        .with_state(state)
}

// ============================================================
// Request structs
// ============================================================

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoPathRequest {
    repo_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FilePathRequest {
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RepoFileRequest {
    repo_path: String,
    file_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetFileContentRequest {
    repo_path: String,
    file_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetAllHunksRequest {
    repo_path: String,
    comparison: Comparison,
    file_paths: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExpandedContextRequest {
    repo_path: String,
    file_path: String,
    comparison: Comparison,
    start_line: u32,
    end_line: u32,
    github_pr: Option<GitHubPrRef>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchRequest {
    repo_path: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListFilesRequest {
    repo_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListAllFilesRequest {
    repo_path: String,
    comparison: Comparison,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DirContentsRequest {
    repo_path: String,
    dir_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewLoadRequest {
    repo_path: String,
    comparison: Comparison,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewSaveRequest {
    repo_path: String,
    state: ReviewState,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReviewDeleteRequest {
    repo_path: String,
    comparison: Comparison,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EnsureReviewRequest {
    repo_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TrustMatchRequest {
    label: String,
    pattern: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SymbolDiffsRequest {
    repo_path: String,
    file_paths: Vec<String>,
    comparison: Comparison,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SymbolDefinitionsRequest {
    repo_path: String,
    symbol_name: String,
    git_ref: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FileSymbolsRequest {
    repo_path: String,
    file_path: String,
    git_ref: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitsRequest {
    repo_path: String,
    limit: Option<usize>,
    branch: Option<String>,
    range: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommitDetailRequest {
    repo_path: String,
    hash: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffRequest {
    repo_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiffShortStatRequest {
    repo_path: String,
    comparison: Comparison,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StageFileRequest {
    repo_path: String,
    path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StageHunksRequest {
    repo_path: String,
    file_path: String,
    content_hashes: Vec<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkingTreeFileContentRequest {
    repo_path: String,
    file_path: String,
    cached: bool,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GitCommitRequest {
    repo_path: String,
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateGroupingRequest {
    repo_path: String,
    hunks: Vec<crate::ai::grouping::GroupingInput>,
    modified_symbols: Option<Vec<crate::ai::grouping::ModifiedSymbolEntry>>,
    request_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CancelGroupingRequest {
    request_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateCommitMessageRequest {
    repo_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveRepoPathRequest {
    route_prefix: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EventsQuery {
    repo_path: String,
}

// ============================================================
// Git handlers
// ============================================================

async fn git_current_repo() -> ApiResult<String> {
    blocking(|| {
        // Walk up from cwd to find .git
        let cwd = std::env::current_dir()?;
        let mut current = cwd.as_path();
        loop {
            if current.join(".git").exists() {
                return Ok(current.to_string_lossy().to_string());
            }
            match current.parent() {
                Some(parent) => current = parent,
                None => anyhow::bail!("No git repository found"),
            }
        }
    })
    .await
}

async fn git_current_branch(Json(req): Json<RepoPathRequest>) -> ApiResult<String> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.get_current_branch().map_err(Into::into)
    })
    .await
}

async fn git_remote_info(Json(req): Json<RepoPathRequest>) -> ApiResult<RemoteInfo> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.get_remote_info().map_err(Into::into)
    })
    .await
}

async fn git_default_branch(Json(req): Json<RepoPathRequest>) -> ApiResult<String> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.get_default_branch().map_err(Into::into)
    })
    .await
}

async fn git_branches(Json(req): Json<RepoPathRequest>) -> ApiResult<BranchList> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.list_branches().map_err(Into::into)
    })
    .await
}

async fn git_status(Json(req): Json<RepoPathRequest>) -> ApiResult<GitStatusSummary> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.get_status().map_err(Into::into)
    })
    .await
}

async fn git_status_raw(Json(req): Json<RepoPathRequest>) -> ApiResult<String> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.get_status_raw().map_err(Into::into)
    })
    .await
}

async fn git_stage_file(Json(req): Json<StageFileRequest>) -> ApiResult<()> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.stage_file(&req.path).map_err(Into::into)
    })
    .await
}

async fn git_unstage_file(Json(req): Json<StageFileRequest>) -> ApiResult<()> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.unstage_file(&req.path).map_err(Into::into)
    })
    .await
}

async fn git_unstage_all(Json(req): Json<RepoPathRequest>) -> ApiResult<()> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.unstage_all().map_err(Into::into)
    })
    .await
}

async fn git_stage_hunks(Json(req): Json<StageHunksRequest>) -> ApiResult<()> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source
            .stage_hunks(&req.file_path, &req.content_hashes)
            .map_err(Into::into)
    })
    .await
}

async fn git_unstage_hunks(Json(req): Json<StageHunksRequest>) -> ApiResult<()> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source
            .unstage_hunks(&req.file_path, &req.content_hashes)
            .map_err(Into::into)
    })
    .await
}

async fn git_commits(Json(req): Json<CommitsRequest>) -> ApiResult<Vec<CommitEntry>> {
    blocking(move || {
        let limit = req.limit.unwrap_or(50);
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source
            .list_commits(limit, req.branch.as_deref(), req.range.as_deref())
            .map_err(Into::into)
    })
    .await
}

async fn git_commit_detail(Json(req): Json<CommitDetailRequest>) -> ApiResult<CommitDetail> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.get_commit_detail(&req.hash).map_err(Into::into)
    })
    .await
}

async fn git_diff(Json(req): Json<DiffRequest>) -> ApiResult<String> {
    blocking(move || {
        if let Some(ref pr) = req.github_pr {
            let provider = GhCliProvider::new(PathBuf::from(&req.repo_path));
            return provider
                .get_pull_request_diff(pr.number)
                .map_err(Into::into);
        }
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source.get_diff(&req.comparison, None).map_err(Into::into)
    })
    .await
}

async fn git_diff_shortstat(Json(req): Json<DiffShortStatRequest>) -> ApiResult<DiffShortStat> {
    blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&req.repo_path))?;
        source
            .get_diff_shortstat(&req.comparison)
            .map_err(Into::into)
    })
    .await
}

async fn git_working_tree_file_content(
    Json(req): Json<WorkingTreeFileContentRequest>,
) -> ApiResult<FileContent> {
    blocking(move || {
        crate::service::files::get_working_tree_file_content(
            &PathBuf::from(&req.repo_path),
            &req.file_path,
            req.cached,
        )
    })
    .await
}

// ============================================================
// GitHub handlers
// ============================================================

async fn github_available(Json(req): Json<RepoPathRequest>) -> Json<bool> {
    let provider = GhCliProvider::new(PathBuf::from(&req.repo_path));
    Json(provider.is_available())
}

async fn github_pull_requests(Json(req): Json<RepoPathRequest>) -> ApiResult<Vec<PullRequest>> {
    blocking(move || {
        let provider = GhCliProvider::new(PathBuf::from(&req.repo_path));
        provider.list_pull_requests().map_err(Into::into)
    })
    .await
}

// ============================================================
// File handlers
// ============================================================

async fn files_list(Json(req): Json<ListFilesRequest>) -> ApiResult<Vec<FileEntry>> {
    blocking(move || {
        crate::service::files::list_files(
            &PathBuf::from(&req.repo_path),
            &req.comparison,
            req.github_pr.as_ref(),
        )
    })
    .await
}

async fn files_list_all(Json(req): Json<ListAllFilesRequest>) -> ApiResult<Vec<FileEntry>> {
    blocking(move || {
        crate::service::files::list_all_files(&PathBuf::from(&req.repo_path), &req.comparison)
    })
    .await
}

async fn files_list_repo(Json(req): Json<RepoPathRequest>) -> ApiResult<Vec<FileEntry>> {
    blocking(move || crate::service::files::list_repo_files(&PathBuf::from(&req.repo_path))).await
}

async fn files_directory_contents(
    Json(req): Json<DirContentsRequest>,
) -> ApiResult<Vec<FileEntry>> {
    blocking(move || {
        crate::service::files::list_directory_contents(
            &PathBuf::from(&req.repo_path),
            &req.dir_path,
        )
    })
    .await
}

async fn files_content(Json(req): Json<GetFileContentRequest>) -> ApiResult<FileContent> {
    blocking(move || {
        crate::service::files::get_file_content(
            &PathBuf::from(&req.repo_path),
            &req.file_path,
            &req.comparison,
            req.github_pr.as_ref(),
        )
    })
    .await
}

async fn files_all_hunks(Json(req): Json<GetAllHunksRequest>) -> ApiResult<Vec<DiffHunk>> {
    blocking(move || {
        crate::service::files::get_all_hunks(
            &PathBuf::from(&req.repo_path),
            &req.comparison,
            &req.file_paths,
        )
    })
    .await
}

async fn files_expanded_context(
    Json(req): Json<ExpandedContextRequest>,
) -> ApiResult<ExpandedContextResult> {
    blocking(move || {
        crate::service::files::get_expanded_context(
            &PathBuf::from(&req.repo_path),
            &req.file_path,
            &req.comparison,
            req.start_line,
            req.end_line,
            req.github_pr.as_ref(),
        )
    })
    .await
}

async fn files_search(Json(req): Json<SearchRequest>) -> ApiResult<Vec<SearchMatch>> {
    blocking(move || {
        crate::service::files::search_file_contents(
            &PathBuf::from(&req.repo_path),
            &req.query,
            req.case_sensitive,
            req.max_results,
        )
    })
    .await
}

async fn files_read_raw(Json(req): Json<FilePathRequest>) -> ApiResult<FileContent> {
    blocking(move || crate::service::files::read_raw_file(std::path::Path::new(&req.path))).await
}

async fn files_raw_content(Json(req): Json<RepoFileRequest>) -> ApiResult<FileContent> {
    blocking(move || {
        crate::service::files::get_file_raw_content(&PathBuf::from(&req.repo_path), &req.file_path)
    })
    .await
}

async fn files_directory_plain(Json(req): Json<FilePathRequest>) -> ApiResult<Vec<FileEntry>> {
    blocking(move || crate::service::files::list_directory_plain(std::path::Path::new(&req.path)))
        .await
}

// ============================================================
// Review handlers
// ============================================================

async fn review_load(Json(req): Json<ReviewLoadRequest>) -> ApiResult<ReviewState> {
    blocking(move || {
        storage::load_review_state(&PathBuf::from(&req.repo_path), &req.comparison)
            .map_err(Into::into)
    })
    .await
}

async fn review_save(Json(req): Json<ReviewSaveRequest>) -> ApiResult<u64> {
    blocking(move || {
        let mut state = req.state;
        state.prepare_for_save();
        storage::save_review_state(&PathBuf::from(&req.repo_path), &state)?;
        Ok(state.version)
    })
    .await
}

async fn review_list(Json(req): Json<RepoPathRequest>) -> ApiResult<Vec<ReviewSummary>> {
    blocking(move || {
        storage::list_saved_reviews(&PathBuf::from(&req.repo_path)).map_err(Into::into)
    })
    .await
}

async fn review_delete(Json(req): Json<ReviewDeleteRequest>) -> ApiResult<()> {
    blocking(move || {
        storage::delete_review(&PathBuf::from(&req.repo_path), &req.comparison).map_err(Into::into)
    })
    .await
}

async fn review_exists(Json(req): Json<ReviewLoadRequest>) -> ApiResult<bool> {
    blocking(move || {
        storage::review_exists(&PathBuf::from(&req.repo_path), &req.comparison).map_err(Into::into)
    })
    .await
}

async fn review_ensure_exists(Json(req): Json<EnsureReviewRequest>) -> ApiResult<()> {
    blocking(move || {
        storage::ensure_review_exists(
            &PathBuf::from(&req.repo_path),
            &req.comparison,
            req.github_pr,
        )
        .map_err(Into::into)
    })
    .await
}

async fn review_list_global() -> ApiResult<Vec<GlobalReviewSummary>> {
    blocking(|| storage::list_all_reviews_global().map_err(Into::into)).await
}

async fn review_root() -> ApiResult<String> {
    blocking(|| {
        crate::review::central::get_central_root()
            .map(|p| p.to_string_lossy().to_string())
            .map_err(Into::into)
    })
    .await
}

async fn review_storage_path(Json(req): Json<RepoPathRequest>) -> ApiResult<String> {
    blocking(move || {
        crate::review::central::get_repo_storage_dir(&PathBuf::from(&req.repo_path))
            .map(|p| p.to_string_lossy().to_string())
            .map_err(Into::into)
    })
    .await
}

#[derive(Deserialize)]
struct ReviewFreshnessRequest {
    reviews: Vec<ReviewFreshnessInput>,
}

async fn review_freshness(
    Json(req): Json<ReviewFreshnessRequest>,
) -> Json<Vec<ReviewFreshnessResult>> {
    Json(crate::service::freshness::check_reviews_freshness(req.reviews).await)
}

// ============================================================
// Classification handlers
// ============================================================

#[derive(Deserialize)]
struct ClassifyStaticRequest {
    hunks: Vec<DiffHunk>,
}

async fn classify_static(Json(req): Json<ClassifyStaticRequest>) -> Json<ClassifyResponse> {
    Json(classify::classify_hunks_static(&req.hunks))
}

#[derive(Deserialize)]
struct ClassifyMovePairsRequest {
    hunks: Vec<DiffHunk>,
}

async fn classify_move_pairs(
    Json(req): Json<ClassifyMovePairsRequest>,
) -> Json<DetectMovePairsResponse> {
    let mut hunks = req.hunks;
    let pairs = detect_move_pairs(&mut hunks);
    Json(DetectMovePairsResponse { pairs, hunks })
}

// ============================================================
// Trust handlers
// ============================================================

async fn trust_taxonomy() -> Json<Vec<TrustCategory>> {
    Json(crate::trust::patterns::get_trust_taxonomy())
}

async fn trust_match(Json(req): Json<TrustMatchRequest>) -> Json<bool> {
    Json(crate::trust::matches_pattern(&req.label, &req.pattern))
}

async fn trust_skip_file(Json(req): Json<FilePathRequest>) -> Json<bool> {
    Json(crate::filters::should_skip_file(&req.path))
}

// ============================================================
// Symbol handlers
// ============================================================

async fn symbols_diffs(Json(req): Json<SymbolDiffsRequest>) -> ApiResult<Vec<FileSymbolDiff>> {
    blocking(move || {
        crate::service::symbols::get_file_symbol_diffs(
            &PathBuf::from(&req.repo_path),
            &req.file_paths,
            &req.comparison,
        )
    })
    .await
}

async fn symbols_definitions(
    Json(req): Json<SymbolDefinitionsRequest>,
) -> ApiResult<Vec<SymbolDefinition>> {
    blocking(move || {
        crate::service::symbols::find_symbol_definitions(
            &PathBuf::from(&req.repo_path),
            &req.symbol_name,
            req.git_ref.as_deref(),
        )
    })
    .await
}

async fn symbols_file(Json(req): Json<FileSymbolsRequest>) -> ApiResult<Option<Vec<Symbol>>> {
    blocking(move || {
        crate::service::symbols::get_file_symbols(
            &PathBuf::from(&req.repo_path),
            &req.file_path,
            req.git_ref.as_deref(),
        )
    })
    .await
}

async fn symbols_repo(Json(req): Json<RepoPathRequest>) -> ApiResult<Vec<RepoFileSymbols>> {
    blocking(move || crate::service::symbols::get_repo_symbols(&PathBuf::from(&req.repo_path)))
        .await
}

// ============================================================
// Activity handlers
// ============================================================

async fn activity_list() -> ApiResult<Vec<RepoLocalActivity>> {
    blocking(crate::service::activity::list_all_local_activity).await
}

async fn activity_register(Json(req): Json<RepoPathRequest>) -> ApiResult<bool> {
    blocking(move || {
        crate::review::central::register_repo_if_valid(&PathBuf::from(&req.repo_path))
            .map_err(Into::into)
    })
    .await
}

async fn activity_unregister(Json(req): Json<RepoPathRequest>) -> ApiResult<()> {
    blocking(move || {
        crate::review::central::unregister_repo(&PathBuf::from(&req.repo_path)).map_err(Into::into)
    })
    .await
}

// ============================================================
// Misc handlers
// ============================================================

async fn misc_is_git_repo(Json(req): Json<FilePathRequest>) -> Json<bool> {
    let result = std::process::Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(&req.path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false);
    Json(result)
}

async fn misc_path_is_file(Json(req): Json<FilePathRequest>) -> Json<bool> {
    Json(std::path::Path::new(&req.path).is_file())
}

async fn misc_vscode_theme() -> ApiResult<VscodeThemeDetection> {
    blocking(crate::service::vscode::detect_vscode_theme).await
}

async fn misc_resolve_repo_path(
    Json(req): Json<ResolveRepoPathRequest>,
) -> ApiResult<Option<String>> {
    blocking(move || {
        let repos = crate::review::central::list_registered_repos()?;
        for repo_entry in &repos {
            let source = match LocalGitSource::new(PathBuf::from(&repo_entry.path)) {
                Ok(s) => s,
                Err(_) => continue,
            };
            if let Ok(info) = source.get_remote_info() {
                if info.name == req.route_prefix {
                    return Ok(Some(repo_entry.path.clone()));
                }
            }
        }
        Ok(None)
    })
    .await
}

// ============================================================
// Streaming handlers (SSE)
// ============================================================

async fn streaming_generate_grouping(
    State(state): State<AppState>,
    Json(req): Json<GenerateGroupingRequest>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;

    let (tx, rx) = tokio::sync::mpsc::channel::<serde_json::Value>(128);

    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(ref id) = req.request_id {
        state
            .active_groupings
            .lock()
            .unwrap()
            .insert(id.clone(), cancel.clone());
    }

    let request_id = req.request_id.clone();
    let active_groupings = state.active_groupings.clone();
    let symbols = req.modified_symbols.unwrap_or_default();
    let repo_path_buf = PathBuf::from(&req.repo_path);
    let hunks = req.hunks;

    tokio::task::spawn_blocking(move || {
        let cancel_clone = cancel.clone();
        let mut on_event = |event: crate::ai::grouping::GroupingEvent| {
            let _ = tx.blocking_send(serde_json::to_value(&event).unwrap_or_default());
        };
        let result = crate::ai::grouping::generate_grouping_streaming(
            &hunks,
            &repo_path_buf,
            &symbols,
            &mut on_event,
            Some(&cancel_clone),
        );

        // Send result or error as a final event
        match result {
            Ok(groups) => {
                let _ = tx.blocking_send(serde_json::json!({"type": "done", "groups": groups}));
            }
            Err(e) => {
                let _ =
                    tx.blocking_send(serde_json::json!({"type": "error", "error": e.to_string()}));
            }
        }

        // Clean up cancel flag
        if let Some(ref id) = request_id {
            active_groupings.lock().unwrap().remove(id);
        }
    });

    let stream = ReceiverStream::new(rx).map(|value| {
        Ok(Event::default()
            .json_data(value)
            .unwrap_or_else(|_| Event::default().data("null")))
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

async fn streaming_cancel_grouping(
    State(state): State<AppState>,
    Json(req): Json<CancelGroupingRequest>,
) -> Json<()> {
    if let Some(flag) = state.active_groupings.lock().unwrap().get(&req.request_id) {
        flag.store(true, Ordering::Relaxed);
    }
    Json(())
}

async fn streaming_git_commit(
    Json(req): Json<GitCommitRequest>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;

    let (tx, rx) = tokio::sync::mpsc::channel::<serde_json::Value>(128);

    tokio::task::spawn_blocking(move || {
        let tx_clone = tx.clone();
        let result = crate::service::commit::git_commit_streaming(
            &PathBuf::from(&req.repo_path),
            &req.message,
            move |line| {
                let _ = tx_clone.blocking_send(serde_json::json!({"type": "line", "data": line}));
            },
        );

        match result {
            Ok(commit_result) => {
                let _ =
                    tx.blocking_send(serde_json::json!({"type": "done", "data": commit_result}));
            }
            Err(e) => {
                let _ =
                    tx.blocking_send(serde_json::json!({"type": "error", "error": e.to_string()}));
            }
        }
    });

    let stream = ReceiverStream::new(rx).map(|value| {
        Ok(Event::default()
            .json_data(value)
            .unwrap_or_else(|_| Event::default().data("null")))
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

async fn streaming_generate_commit_message(
    Json(req): Json<GenerateCommitMessageRequest>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;

    let (tx, rx) = tokio::sync::mpsc::channel::<serde_json::Value>(128);

    tokio::task::spawn_blocking(move || {
        let repo_path = PathBuf::from(&req.repo_path);
        let source = match LocalGitSource::new(repo_path.clone()) {
            Ok(s) => s,
            Err(e) => {
                let _ =
                    tx.blocking_send(serde_json::json!({"type": "error", "error": e.to_string()}));
                return;
            }
        };
        let staged_diff = match source.get_staged_diff() {
            Ok(d) => d,
            Err(e) => {
                let _ =
                    tx.blocking_send(serde_json::json!({"type": "error", "error": e.to_string()}));
                return;
            }
        };
        if staged_diff.trim().is_empty() {
            let _ = tx.blocking_send(
                serde_json::json!({"type": "error", "error": "No staged changes to generate a message for"}),
            );
            return;
        }
        let recent_messages = source.get_recent_commit_messages(10).unwrap_or_default();

        let tx_clone = tx.clone();
        let mut on_text = |text: &str| {
            let _ = tx_clone.blocking_send(serde_json::json!({"type": "chunk", "text": text}));
        };
        let result = crate::ai::commit_message::generate_commit_message_streaming(
            &staged_diff,
            &recent_messages,
            &repo_path,
            &mut on_text,
        );

        match result {
            Ok(msg) => {
                let _ = tx.blocking_send(serde_json::json!({"type": "done", "message": msg}));
            }
            Err(e) => {
                let _ =
                    tx.blocking_send(serde_json::json!({"type": "error", "error": e.to_string()}));
            }
        }
    });

    let stream = ReceiverStream::new(rx).map(|value| {
        Ok(Event::default()
            .json_data(value)
            .unwrap_or_else(|_| Event::default().data("null")))
    });

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ============================================================
// File watcher SSE endpoint
// ============================================================

/// SSE events for file watcher. Starts a `notify` watcher for the given repo path.
/// The watcher is dropped when the SSE connection closes.
async fn events_sse(
    Query(params): Query<EventsQuery>,
) -> Sse<impl futures::Stream<Item = Result<Event, Infallible>>> {
    use notify::RecursiveMode;
    use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
    use tokio_stream::wrappers::ReceiverStream;
    use tokio_stream::StreamExt;

    let (tx, rx) = tokio::sync::mpsc::channel::<Event>(128);

    let repo_path = PathBuf::from(&params.repo_path);
    let repo_path_str = params.repo_path.clone();

    // Spawn the watcher in a blocking context. When `tx` is dropped
    // (because the SSE connection closed), the debouncer is dropped too.
    tokio::task::spawn_blocking(move || {
        let tx = tx; // move into closure scope

        let repo_for_closure = repo_path_str.clone();
        let tx_clone = tx.clone();

        let debouncer_result = new_debouncer(
            Duration::from_millis(200),
            move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                if let Ok(events) = result {
                    let mut review_changed = false;
                    let mut git_state_changed = false;
                    let mut working_tree_changed = false;

                    for event in events {
                        if event.kind != DebouncedEventKind::Any {
                            continue;
                        }
                        let path_str = event.path.to_string_lossy();

                        if path_str.ends_with("/app.log") || path_str.ends_with("\\app.log") {
                            continue;
                        }

                        let category = categorize_change(&path_str);
                        match category {
                            ChangeKind::ReviewState => review_changed = true,
                            ChangeKind::GitState => git_state_changed = true,
                            ChangeKind::WorkingTree => working_tree_changed = true,
                            ChangeKind::Ignored => {}
                        }
                    }

                    if review_changed {
                        let _ = tx_clone.blocking_send(
                            Event::default()
                                .event("review-state-changed")
                                .data(&repo_for_closure),
                        );
                    }
                    if working_tree_changed || git_state_changed {
                        let _ = tx_clone.blocking_send(
                            Event::default()
                                .event("git-changed")
                                .data(&repo_for_closure),
                        );
                    }
                    if git_state_changed {
                        let _ = tx_clone.blocking_send(
                            Event::default()
                                .event("local-activity-changed")
                                .data(&repo_for_closure),
                        );
                    }
                }
            },
        );

        let mut debouncer = match debouncer_result {
            Ok(d) => d,
            Err(e) => {
                log::error!("[events_sse] Failed to create watcher: {e}");
                return;
            }
        };

        // Watch the repo recursively
        let _ = debouncer
            .watcher()
            .watch(&repo_path, RecursiveMode::Recursive);

        // Also watch central storage for review state changes
        if let Ok(central_dir) = crate::review::central::get_repo_storage_dir(&repo_path) {
            if central_dir.exists() {
                let _ = debouncer
                    .watcher()
                    .watch(&central_dir, RecursiveMode::Recursive);
            }
        }

        // Keep the debouncer alive until the channel is closed (SSE disconnects)
        // We detect this by trying to send periodically
        loop {
            std::thread::sleep(Duration::from_secs(30));
            // If the receiver is gone, the channel is closed → stop watching
            if tx.is_closed() {
                break;
            }
        }
    });

    let stream = ReceiverStream::new(rx).map(Ok);

    Sse::new(stream).keep_alive(
        axum::response::sse::KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("keep-alive"),
    )
}

// ============================================================
// File watcher helpers (reused from desktop/tauri/watchers.rs)
// ============================================================

enum ChangeKind {
    ReviewState,
    GitState,
    WorkingTree,
    Ignored,
}

fn should_ignore_path(path_str: &str) -> bool {
    if path_str.contains("/.git/") || path_str.contains("\\.git\\") {
        if std::path::Path::new(path_str)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("lock"))
        {
            return true;
        }
        let meaningful_git_paths = [
            "/review/",
            "\\review\\",
            "/refs/heads/",
            "\\refs\\heads\\",
            "/refs/remotes/",
            "\\refs\\remotes\\",
            "/.git/HEAD",
            "\\.git\\HEAD",
            "/.git/index",
            "\\.git\\index",
        ];
        return !meaningful_git_paths.iter().any(|p| path_str.contains(p));
    }

    let noisy_patterns = [
        "/node_modules/",
        "\\node_modules\\",
        "/.venv/",
        "\\.venv\\",
        "/venv/",
        "\\venv\\",
        "/__pycache__/",
        "\\__pycache__\\",
        "/target/",
        "\\target\\",
        "/.next/",
        "\\.next\\",
        "/dist/",
        "\\dist\\",
        "/build/",
        "\\build\\",
        "/.cache/",
        "\\.cache\\",
        "/.cargo/",
        "\\.cargo\\",
        "/.turbo/",
        "\\.turbo\\",
        ".swp",
        ".swo",
        "~",
    ];

    noisy_patterns.iter().any(|p| path_str.contains(p))
}

fn is_log_file(path_str: &str) -> bool {
    std::path::Path::new(path_str)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))
}

fn is_git_state_path(path_str: &str) -> bool {
    path_str.contains("/.git/refs/heads/")
        || path_str.contains("\\.git\\refs\\heads\\")
        || path_str.ends_with("/.git/HEAD")
        || path_str.ends_with("\\.git\\HEAD")
        || path_str.ends_with("/.git/index")
        || path_str.ends_with("\\.git\\index")
}

fn categorize_change(path_str: &str) -> ChangeKind {
    if should_ignore_path(path_str) {
        return ChangeKind::Ignored;
    }

    let is_central_review =
        path_str.contains("/.review/repos/") || path_str.contains("\\.review\\repos\\");
    let is_legacy_review =
        path_str.contains("/.git/review/") || path_str.contains("\\.git\\review\\");

    if is_central_review || is_legacy_review {
        if is_log_file(path_str) {
            return ChangeKind::Ignored;
        }
        return ChangeKind::ReviewState;
    }

    if is_git_state_path(path_str) {
        return ChangeKind::GitState;
    }

    ChangeKind::WorkingTree
}
