//! Tauri command handlers for the desktop application.
//!
//! All #[tauri::command] functions are defined here as thin wrappers
//! that delegate to core business logic modules.

// Tauri's IPC protocol requires command parameters to be owned types.
#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require owned parameters for IPC deserialization"
)]

use log::{debug, error, info};
use review::ai::grouping::{GroupingInput, ModifiedSymbolEntry};
use review::classify::{self, ClassifyResponse};
use review::diff::parser::{detect_move_pairs, DiffHunk};
use review::review::state::{HunkGroup, ReviewState, ReviewSummary};
use review::review::storage::{self, GlobalReviewSummary};
use review::service::{
    CommitOutputLine, CommitResult, DetectMovePairsResponse, ExpandedContextResult, FileContent,
    RepoFileSymbols, RepoLocalActivity, ReviewFreshnessInput, ReviewFreshnessResult,
    VscodeThemeDetection,
};
use review::sources::github::{GhCliProvider, GitHubPrRef, GitHubProvider, PullRequest};
use review::sources::local_git::{
    DiffShortStat, LocalBranchInfo, LocalGitSource, RemoteInfo, SearchMatch, WorktreeInfo,
};
use review::sources::traits::{
    BranchList, CommitDetail, CommitEntry, Comparison, DiffSource, FileEntry, GitStatusSummary,
};
use review::symbols::{self, FileSymbolDiff, Symbol};
use review::trust::patterns::TrustCategory;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;

// --- Window defaults ---

/// Default window width in logical pixels.
const DEFAULT_WINDOW_WIDTH: f64 = 1100.0;
/// Default window height in logical pixels.
const DEFAULT_WINDOW_HEIGHT: f64 = 750.0;
/// Minimum window width in logical pixels.
const MIN_WINDOW_WIDTH: f64 = 800.0;
/// Minimum window height in logical pixels.
const MIN_WINDOW_HEIGHT: f64 = 600.0;

use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

/// Managed state holding cancel flags for active grouping operations,
/// keyed by request ID. Setting the flag to `true` signals the streaming
/// loop to kill the Claude child process and return `Cancelled`.
pub struct ActiveGroupings(pub std::sync::Mutex<HashMap<String, Arc<AtomicBool>>>);

// Types are now imported from review::service::{FileContent, DetectMovePairsResponse, ...}

// --- Tauri Commands ---

#[tauri::command]
pub fn get_current_repo() -> Result<String, String> {
    // Check command-line arguments first (for `review open` CLI command)
    // Args are passed like: Review /path/to/repo
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let repo_path = &args[1];
        let path = PathBuf::from(repo_path);
        if path.join(".git").exists() {
            return Ok(repo_path.clone());
        }
    }

    // Check current working directory and walk up to find .git
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    let mut current = cwd.as_path();
    loop {
        if current.join(".git").exists() {
            let repo_path = current.to_string_lossy().to_string();
            return Ok(repo_path);
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }

    Err("No git repository found.".to_owned())
}

#[tauri::command]
pub fn check_github_available(repo_path: String) -> bool {
    let provider = GhCliProvider::new(PathBuf::from(&repo_path));
    provider.is_available()
}

#[tauri::command]
pub fn list_pull_requests(repo_path: String) -> Result<Vec<PullRequest>, String> {
    let provider = GhCliProvider::new(PathBuf::from(&repo_path));
    provider.list_pull_requests().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_files(
    repo_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || list_files_sync(repo_path, comparison, github_pr))
        .await
        .map_err(|e| e.to_string())?
}

/// Synchronous implementation of `list_files`, callable from blocking contexts.
pub fn list_files_sync(
    repo_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_files(&PathBuf::from(&repo_path), &comparison, github_pr.as_ref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_all_files(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || list_all_files_sync(repo_path, comparison))
        .await
        .map_err(|e| e.to_string())?
}

/// Synchronous implementation of `list_all_files`, callable from blocking contexts.
pub fn list_all_files_sync(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_all_files(&PathBuf::from(&repo_path), &comparison)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_repo_files(repo_path: String) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || list_repo_files_sync(repo_path))
        .await
        .map_err(|e| e.to_string())?
}

/// Synchronous implementation of `list_repo_files`, callable from blocking contexts.
pub fn list_repo_files_sync(repo_path: String) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_repo_files(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_directory_contents(
    repo_path: String,
    dir_path: String,
) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || list_directory_contents_sync(repo_path, dir_path))
        .await
        .map_err(|e| e.to_string())?
}

/// Synchronous implementation of `list_directory_contents`, callable from blocking contexts.
pub fn list_directory_contents_sync(
    repo_path: String,
    dir_path: String,
) -> Result<Vec<FileEntry>, String> {
    review::service::files::list_directory_contents(&PathBuf::from(&repo_path), &dir_path)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_file_content(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
) -> Result<FileContent, String> {
    tokio::task::spawn_blocking(move || {
        review::service::files::get_file_content(
            &PathBuf::from(&repo_path),
            &file_path,
            &comparison,
            github_pr.as_ref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Batch-load all hunks for multiple files in a single IPC call.
#[tauri::command]
pub async fn get_all_hunks(
    repo_path: String,
    comparison: Comparison,
    file_paths: Vec<String>,
) -> Result<Vec<DiffHunk>, String> {
    tokio::task::spawn_blocking(move || get_all_hunks_sync(repo_path, comparison, file_paths))
        .await
        .map_err(|e| e.to_string())?
}

/// Synchronous implementation of `get_all_hunks`, callable from blocking contexts.
pub fn get_all_hunks_sync(
    repo_path: String,
    comparison: Comparison,
    file_paths: Vec<String>,
) -> Result<Vec<DiffHunk>, String> {
    review::service::files::get_all_hunks(&PathBuf::from(&repo_path), &comparison, &file_paths)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_diff(
    repo_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
) -> Result<String, String> {
    // PR routing: use gh CLI to get diff
    if let Some(ref pr) = github_pr {
        let provider = GhCliProvider::new(PathBuf::from(&repo_path));
        return provider
            .get_pull_request_diff(pr.number)
            .map_err(|e| e.to_string());
    }

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;

    source
        .get_diff(&comparison, None)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_diff_shortstat(
    repo_path: String,
    comparison: Comparison,
) -> Result<DiffShortStat, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .get_diff_shortstat(&comparison)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_review_state(repo_path: String, comparison: Comparison) -> Result<ReviewState, String> {
    storage::load_review_state(&PathBuf::from(&repo_path), &comparison).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_review_state(repo_path: String, mut state: ReviewState) -> Result<u64, String> {
    state.prepare_for_save();
    storage::save_review_state(&PathBuf::from(&repo_path), &state).map_err(|e| e.to_string())?;
    Ok(state.version)
}

#[tauri::command]
pub fn list_saved_reviews(repo_path: String) -> Result<Vec<ReviewSummary>, String> {
    storage::list_saved_reviews(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_review(repo_path: String, comparison: Comparison) -> Result<(), String> {
    storage::delete_review(&PathBuf::from(&repo_path), &comparison).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn review_exists(repo_path: String, comparison: Comparison) -> Result<bool, String> {
    storage::review_exists(&PathBuf::from(&repo_path), &comparison).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn ensure_review_exists(
    repo_path: String,
    comparison: Comparison,
    github_pr: Option<GitHubPrRef>,
) -> Result<(), String> {
    storage::ensure_review_exists(&PathBuf::from(&repo_path), &comparison, github_pr)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_reviews_global() -> Result<Vec<GlobalReviewSummary>, String> {
    storage::list_all_reviews_global().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_review_root() -> Result<String, String> {
    review::review::central::get_central_root()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_review_storage_path(repo_path: String) -> Result<String, String> {
    review::review::central::get_repo_storage_dir(&PathBuf::from(&repo_path))
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_current_branch(repo_path: String) -> Result<String, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_current_branch().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_remote_info(repo_path: String) -> Result<RemoteInfo, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_remote_info().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_branch(repo_path: String) -> Result<String, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_default_branch().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_local_branches(
    repo_path: String,
    default_branch: String,
) -> Result<Vec<LocalBranchInfo>, String> {
    let t0 = Instant::now();
    let source = LocalGitSource::new(repo_path.into()).map_err(|e| e.to_string())?;
    let branches = source
        .list_branches_ahead(&default_branch)
        .map_err(|e| e.to_string())?;
    info!(
        "[list_local_branches] {} branches ahead in {:?}",
        branches.len(),
        t0.elapsed()
    );
    Ok(branches)
}

#[tauri::command]
pub fn list_worktrees(repo_path: String) -> Result<Vec<WorktreeInfo>, String> {
    let source = LocalGitSource::new(repo_path.into()).map_err(|e| e.to_string())?;
    source.list_worktrees().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_local_activity() -> Result<Vec<RepoLocalActivity>, String> {
    review::service::activity::list_all_local_activity().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn register_repo(repo_path: String) -> Result<bool, String> {
    review::review::central::register_repo_if_valid(&PathBuf::from(repo_path))
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unregister_repo(repo_path: String) -> Result<(), String> {
    review::review::central::unregister_repo(&PathBuf::from(repo_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_branches(repo_path: String) -> Result<BranchList, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.list_branches().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_status(repo_path: String) -> Result<GitStatusSummary, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_status().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_file(repo_path: String, path: String) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.stage_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_file(repo_path: String, path: String) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.unstage_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_all(repo_path: String) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.unstage_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn stage_hunks(
    repo_path: String,
    file_path: String,
    content_hashes: Vec<String>,
) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .stage_hunks(&file_path, &content_hashes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn unstage_hunks(
    repo_path: String,
    file_path: String,
    content_hashes: Vec<String>,
) -> Result<(), String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .unstage_hunks(&file_path, &content_hashes)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn git_commit(
    app: tauri::AppHandle,
    repo_path: String,
    message: String,
    request_id: String,
) -> Result<CommitResult, String> {
    use tauri::Emitter;

    let t0 = Instant::now();
    let event_name = format!("commit:output:{request_id}");

    debug!("[git_commit] repo_path={repo_path}, request_id={request_id}");

    let (tx, mut rx) = tokio::sync::mpsc::channel::<CommitOutputLine>(128);

    // Forward lines from the channel to Tauri events
    let emit_handle = app.clone();
    let emit_event = event_name.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(line) = rx.recv().await {
            let _ = emit_handle.emit(&emit_event, &line);
        }
    });

    let result = tokio::task::spawn_blocking(move || {
        review::service::commit::git_commit_streaming(
            &PathBuf::from(&repo_path),
            &message,
            move |line| {
                let _ = tx.blocking_send(line);
            },
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    // Wait for all events to be emitted
    let _ = emit_task.await;

    match &result {
        Ok(r) if r.success => {
            info!("[git_commit] SUCCESS in {:?}", t0.elapsed());
        }
        Ok(r) => {
            info!("[git_commit] FAILED: {} in {:?}", r.summary, t0.elapsed());
        }
        Err(e) => {
            error!("[git_commit] ERROR: {} in {:?}", e, t0.elapsed());
        }
    }

    result
}

#[tauri::command]
pub fn get_working_tree_file_content(
    repo_path: String,
    file_path: String,
    cached: bool,
) -> Result<FileContent, String> {
    review::service::files::get_working_tree_file_content(
        &PathBuf::from(&repo_path),
        &file_path,
        cached,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_git_status_raw(repo_path: String) -> Result<String, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_status_raw().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_commits(
    repo_path: String,
    limit: Option<usize>,
    branch: Option<String>,
    range: Option<String>,
) -> Result<Vec<CommitEntry>, String> {
    let limit = limit.unwrap_or(50);
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .list_commits(limit, branch.as_deref(), range.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_commit_detail(repo_path: String, hash: String) -> Result<CommitDetail, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_commit_detail(&hash).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_claude_available() -> bool {
    review::ai::check_claude_available()
}

#[tauri::command]
pub fn classify_hunks_static(hunks: Vec<DiffHunk>) -> ClassifyResponse {
    let t0 = Instant::now();
    debug!(
        "[classify_hunks_static] Classifying {} hunks with static rules",
        hunks.len()
    );
    let result = classify::classify_hunks_static(&hunks);
    info!(
        "[classify_hunks_static] Classified {} of {} hunks in {:?}",
        result.classifications.len(),
        hunks.len(),
        t0.elapsed()
    );
    result
}

#[tauri::command]
pub fn detect_hunks_move_pairs(mut hunks: Vec<DiffHunk>) -> DetectMovePairsResponse {
    let t0 = Instant::now();
    debug!(
        "[detect_hunks_move_pairs] Analyzing {} hunks for moves",
        hunks.len()
    );

    let pairs = detect_move_pairs(&mut hunks);

    info!(
        "[detect_hunks_move_pairs] Found {} move pairs from {} hunks in {:?}",
        pairs.len(),
        hunks.len(),
        t0.elapsed()
    );

    review::service::DetectMovePairsResponse { pairs, hunks }
}

/// Validate that a path is within .git/review/ or ~/.review/ for security
fn validate_review_path(path: &str) -> Result<PathBuf, String> {
    review::service::util::validate_review_path(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let validated_path = validate_review_path(&path)?;
    std::fs::write(&validated_path, contents)
        .map_err(|e| format!("Failed to write file {path}: {e}"))
}

#[tauri::command]
pub fn append_to_file(path: String, contents: String) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let validated_path = validate_review_path(&path)?;

    if let Some(parent) = validated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories for {path}: {e}"))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&validated_path)
        .map_err(|e| format!("Failed to open file {path}: {e}"))?;

    file.write_all(contents.as_bytes())
        .map_err(|e| format!("Failed to append to file {path}: {e}"))
}

#[tauri::command]
pub fn get_expanded_context(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
    start_line: u32,
    end_line: u32,
    github_pr: Option<GitHubPrRef>,
) -> Result<ExpandedContextResult, String> {
    review::service::files::get_expanded_context(
        &PathBuf::from(&repo_path),
        &file_path,
        &comparison,
        start_line,
        end_line,
        github_pr.as_ref(),
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn match_trust_pattern(label: String, pattern: String) -> bool {
    review::trust::matches_pattern(&label, &pattern)
}

#[tauri::command]
pub fn get_trust_taxonomy() -> Vec<TrustCategory> {
    review::trust::patterns::get_trust_taxonomy()
}

#[tauri::command]
pub fn should_skip_file(path: String) -> bool {
    review::filters::should_skip_file(&path)
}

// File watching
#[tauri::command]
pub fn start_file_watcher(app: tauri::AppHandle, repo_path: String) -> Result<(), String> {
    super::watchers::start_watching(&repo_path, app)
}

#[tauri::command]
pub fn stop_file_watcher(repo_path: String) {
    super::watchers::stop_watching(&repo_path);
}

/// Consume a pending CLI open request (signal file written by the `review` CLI).
/// Returns `Some(CliOpenRequest)` on cold start when the CLI launched the app,
/// or `None` if there is no pending request.
#[tauri::command]
pub fn consume_cli_request() -> Option<CliOpenRequest> {
    let (repo_path, comparison_key, focused_file) = super::read_open_request()?;
    Some(CliOpenRequest {
        repo_path,
        comparison_key,
        focused_file,
    })
}

#[derive(Debug, Serialize)]
pub struct CliOpenRequest {
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    #[serde(rename = "comparisonKey")]
    pub comparison_key: Option<String>,
    #[serde(rename = "focusedFile")]
    pub focused_file: Option<String>,
}

// Multi-window support
#[tauri::command]
pub async fn open_repo_window(
    app: tauri::AppHandle,
    repo_path: String,
    comparison_key: Option<String>,
) -> Result<(), String> {
    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

    // Handle empty repo_path for creating a new blank window (welcome page)
    if repo_path.is_empty() {
        // Generate a unique label for the new window
        // Use "repo-" prefix to match capability patterns in default.json
        let mut hasher = DefaultHasher::new();
        format!(
            "new-window-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        )
        .hash(&mut hasher);
        let label = format!("repo-{:x}", hasher.finish());

        // Inherit size from an existing window so new windows match the
        // user's current preferred size (the window-state plugin can't
        // restore these since each blank window gets a unique label).
        let (width, height) = app
            .webview_windows()
            .values()
            .next()
            .and_then(|w| {
                let size = w.inner_size().ok()?;
                let scale = w.scale_factor().ok()?;
                Some((size.width as f64 / scale, size.height as f64 / scale))
            })
            .unwrap_or((DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));

        WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
            .title("Review")
            .inner_size(width, height)
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
            .tabbing_identifier("review-main")
            .build()
            .map_err(|e: tauri::Error| e.to_string())?;

        return Ok(());
    }

    // Hash window label on repo_path only — one window per repo
    let mut hasher = DefaultHasher::new();
    repo_path.hash(&mut hasher);
    let label = format!("repo-{:x}", hasher.finish());

    // If a window already exists for this repo, reuse it
    if let Some(existing) = app.get_webview_window(&label) {
        // If a comparison key was provided, tell the frontend to switch
        if let Some(ref key) = comparison_key {
            let _ = existing.emit("cli:switch-comparison", key.clone());
        }
        existing
            .set_focus()
            .map_err(|e: tauri::Error| e.to_string())?;
        return Ok(());
    }

    let repo_name = std::path::Path::new(&repo_path).file_name().map_or_else(
        || "Repository".to_owned(),
        |s| s.to_string_lossy().to_string(),
    );

    let url = if let Some(ref key) = comparison_key {
        WebviewUrl::App(
            format!(
                "index.html?repo={}&comparison={}",
                urlencoding::encode(&repo_path),
                urlencoding::encode(key)
            )
            .into(),
        )
    } else {
        WebviewUrl::App(format!("index.html?repo={}", urlencoding::encode(&repo_path)).into())
    };

    // Inherit size from an existing window for first-time repos (the
    // window-state plugin will override this for previously-opened repos).
    let (width, height) = app
        .webview_windows()
        .values()
        .next()
        .and_then(|w| {
            let size = w.inner_size().ok()?;
            let scale = w.scale_factor().ok()?;
            Some((size.width as f64 / scale, size.height as f64 / scale))
        })
        .unwrap_or((DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT));

    let window = WebviewWindowBuilder::new(&app, label, url)
        .title(repo_name)
        .inner_size(width, height)
        .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
        .tabbing_identifier("review-main")
        .build()
        .map_err(|e: tauri::Error| e.to_string())?;

    let _ = window.set_focus();

    Ok(())
}

#[tauri::command]
pub async fn get_file_symbol_diffs(
    repo_path: String,
    file_paths: Vec<String>,
    comparison: Comparison,
) -> Result<Vec<FileSymbolDiff>, String> {
    tokio::task::spawn_blocking(move || {
        review::service::symbols::get_file_symbol_diffs(
            &PathBuf::from(&repo_path),
            &file_paths,
            &comparison,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_dependency_graph(
    repo_path: String,
    file_paths: Vec<String>,
    comparison: Comparison,
) -> Result<symbols::graph::DependencyGraph, String> {
    let symbol_diffs = get_file_symbol_diffs(repo_path, file_paths, comparison).await?;
    Ok(symbols::graph::build_dependency_graph(&symbol_diffs))
}

#[tauri::command]
pub async fn get_repo_symbols(repo_path: String) -> Result<Vec<RepoFileSymbols>, String> {
    tokio::task::spawn_blocking(move || {
        review::service::symbols::get_repo_symbols(&PathBuf::from(&repo_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_file_symbols(
    repo_path: String,
    file_path: String,
    git_ref: Option<String>,
) -> Result<Option<Vec<Symbol>>, String> {
    tokio::task::spawn_blocking(move || {
        review::service::symbols::get_file_symbols(
            &PathBuf::from(&repo_path),
            &file_path,
            git_ref.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn find_symbol_definitions(
    repo_path: String,
    symbol_name: String,
    git_ref: Option<String>,
) -> Result<Vec<symbols::SymbolDefinition>, String> {
    tokio::task::spawn_blocking(move || {
        review::service::symbols::find_symbol_definitions(
            &PathBuf::from(&repo_path),
            &symbol_name,
            git_ref.as_deref(),
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn search_file_contents(
    repo_path: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
) -> Result<Vec<SearchMatch>, String> {
    review::service::files::search_file_contents(
        &PathBuf::from(&repo_path),
        &query,
        case_sensitive,
        max_results,
    )
    .map_err(|e| e.to_string())
}

// --- Review freshness checking ---

#[tauri::command]
pub async fn check_reviews_freshness(
    reviews: Vec<ReviewFreshnessInput>,
) -> Vec<ReviewFreshnessResult> {
    review::service::freshness::check_reviews_freshness(reviews).await
}

// --- Dev mode detection ---

#[tauri::command]
pub fn is_dev_mode() -> bool {
    cfg!(debug_assertions)
}

#[tauri::command]
pub fn is_git_repo(path: String) -> bool {
    // Use git itself to check if this is a valid repository.
    // This handles all edge cases: regular repos, worktrees, submodules,
    // bare repos, and repos with external git directories.
    std::process::Command::new("git")
        .args(["rev-parse", "--git-dir"])
        .current_dir(&path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

// --- Standalone file support ---

#[tauri::command]
pub fn path_is_file(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

#[tauri::command]
pub async fn read_raw_file(path: String) -> Result<FileContent, String> {
    tokio::task::spawn_blocking(move || {
        review::service::files::read_raw_file(std::path::Path::new(&path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Get raw file content at HEAD from a git repo (no diff, no comparison needed).
#[tauri::command]
pub async fn get_file_raw_content(
    repo_path: String,
    file_path: String,
) -> Result<FileContent, String> {
    tokio::task::spawn_blocking(move || {
        review::service::files::get_file_raw_content(&PathBuf::from(&repo_path), &file_path)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

// --- CLI sidecar install ---

/// Well-known install location for the `review` CLI symlink.
const CLI_SYMLINK_PATH: &str = "/usr/local/bin/review";

#[derive(Debug, Serialize)]
pub struct CliInstallStatus {
    pub installed: bool,
    pub symlink_target: Option<String>,
}

#[tauri::command]
pub fn get_cli_install_status() -> CliInstallStatus {
    let path = std::path::Path::new(CLI_SYMLINK_PATH);
    match std::fs::read_link(path) {
        Ok(target) => CliInstallStatus {
            installed: true,
            symlink_target: Some(target.to_string_lossy().to_string()),
        },
        Err(_) => CliInstallStatus {
            installed: false,
            symlink_target: None,
        },
    }
}

/// Run a shell command with administrator privileges via osascript.
/// Returns an error if the user cancels or the command fails.
fn run_admin_shell_command(shell_command: &str, cancel_message: &str) -> Result<(), String> {
    let script = format!(
        "do shell script \"{}\" with administrator privileges",
        shell_command
    );

    let output = std::process::Command::new("osascript")
        .args(["-e", &script])
        .output()
        .map_err(|e| format!("Failed to run osascript: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("User canceled") || stderr.contains("(-128)") {
            return Err(cancel_message.to_string());
        }
        return Err(stderr.trim().to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn install_cli(app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // The sidecar binary lives next to the main binary inside the app bundle:
    //   Review.app/Contents/MacOS/review-cli
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("Could not determine resource dir: {e}"))?;

    // resource_dir points to Contents/Resources; the binary is in Contents/MacOS
    let sidecar_path = resource_dir
        .parent()
        .ok_or("Could not determine app bundle path")?
        .join("MacOS")
        .join("review-cli");

    if !sidecar_path.exists() {
        return Err(format!(
            "Sidecar binary not found at {}",
            sidecar_path.display()
        ));
    }

    let shell_command = format!("ln -sf '{}' '{}'", sidecar_path.display(), CLI_SYMLINK_PATH);
    run_admin_shell_command(&shell_command, "Installation cancelled")
        .map_err(|e| format!("Failed to create symlink: {e}"))?;

    info!(
        "[install_cli] Symlinked {} -> {}",
        CLI_SYMLINK_PATH,
        sidecar_path.display()
    );
    Ok(sidecar_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn uninstall_cli() -> Result<(), String> {
    let symlink_path = std::path::Path::new(CLI_SYMLINK_PATH);
    if symlink_path.symlink_metadata().is_ok() {
        let shell_command = format!("rm '{}'", CLI_SYMLINK_PATH);
        run_admin_shell_command(&shell_command, "Uninstall cancelled")
            .map_err(|e| format!("Failed to remove symlink: {e}"))?;

        info!("[uninstall_cli] Removed {CLI_SYMLINK_PATH}");
    }
    Ok(())
}

// --- Menu state ---

#[tauri::command]
pub fn update_menu_state(
    app: tauri::AppHandle,
    has_repo: bool,
    view: String,
) -> Result<(), String> {
    use tauri::Manager;

    let items: tauri::State<'_, super::MenuItems> = app.state();
    let in_review = has_repo && view != "none";

    items
        .refresh
        .set_enabled(has_repo)
        .map_err(|e| e.to_string())?;
    items
        .find_file
        .set_enabled(in_review)
        .map_err(|e| e.to_string())?;
    items
        .search_in_files
        .set_enabled(in_review)
        .map_err(|e| e.to_string())?;
    items
        .find_symbols
        .set_enabled(in_review && view == "browse")
        .map_err(|e| e.to_string())?;
    items
        .toggle_sidebar
        .set_enabled(in_review)
        .map_err(|e| e.to_string())?;
    items
        .reveal_in_browse
        .set_enabled(in_review)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// --- Sentry consent ---

#[tauri::command]
pub fn set_sentry_consent(enabled: bool, state: tauri::State<'_, super::SentryConsent>) {
    state.0.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// Base timeout in seconds for single-call Claude operations (grouping, summary).
const CLAUDE_CALL_BASE_TIMEOUT_SECS: u64 = 180;
/// Additional timeout seconds per hunk for single-call Claude operations.
const CLAUDE_CALL_SECS_PER_HUNK: u64 = 2;

/// Compute a timeout that scales with the number of hunks being processed.
fn claude_call_timeout_secs(num_hunks: usize) -> u64 {
    CLAUDE_CALL_BASE_TIMEOUT_SECS + num_hunks as u64 * CLAUDE_CALL_SECS_PER_HUNK
}

#[tauri::command]
pub async fn generate_hunk_grouping(
    app: tauri::AppHandle,
    repo_path: String,
    hunks: Vec<GroupingInput>,
    modified_symbols: Option<Vec<ModifiedSymbolEntry>>,
    request_id: Option<String>,
    active_groupings: tauri::State<'_, ActiveGroupings>,
) -> Result<Vec<HunkGroup>, String> {
    use std::time::Duration;
    use tauri::Emitter;
    use tokio::time::timeout;

    let t0 = Instant::now();
    let symbols = modified_symbols.unwrap_or_default();

    debug!(
        "[generate_hunk_grouping] repo_path={}, hunks={}, symbols={}",
        repo_path,
        hunks.len(),
        symbols.len()
    );

    let repo_path_buf = PathBuf::from(&repo_path);
    let timeout_secs = claude_call_timeout_secs(hunks.len());

    // Streaming mode: emit each event (group or partial title) as a Tauri event.
    // When a request_id is provided, scope events to that invocation to
    // prevent cross-talk between concurrent groupings for different reviews.
    let event_name = match &request_id {
        Some(id) => format!("grouping:event:{}", id),
        None => "grouping:event".to_string(),
    };

    // Register a cancel flag so `cancel_hunk_grouping` can signal this operation.
    let cancel = Arc::new(AtomicBool::new(false));
    if let Some(ref id) = request_id {
        active_groupings
            .0
            .lock()
            .unwrap()
            .insert(id.clone(), cancel.clone());
    }

    let (tx, mut rx) = tokio::sync::mpsc::channel::<review::ai::grouping::GroupingEvent>(128);

    // Forward events from the channel to Tauri events
    let emit_handle = app.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let _ = emit_handle.emit(&event_name, &event);
        }
    });

    let cancel_clone = cancel.clone();
    let result = timeout(
        Duration::from_secs(timeout_secs),
        tokio::task::spawn_blocking(move || {
            let mut on_event = |event: review::ai::grouping::GroupingEvent| {
                let _ = tx.blocking_send(event);
            };
            review::ai::grouping::generate_grouping_streaming(
                &hunks,
                &repo_path_buf,
                &symbols,
                &mut on_event,
                Some(&cancel_clone),
            )
        }),
    )
    .await;

    // Always clean up the cancel flag, even on error/timeout
    if let Some(ref id) = request_id {
        active_groupings.0.lock().unwrap().remove(id);
    }

    // Wait for all events to be emitted
    let _ = emit_task.await;

    let result = result
        .map_err(|_| format!("Hunk grouping generation timed out after {timeout_secs} seconds"))?
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;

    info!(
        "[generate_hunk_grouping] SUCCESS: {} groups in {:?}",
        result.len(),
        t0.elapsed()
    );
    Ok(result)
}

#[tauri::command]
pub fn cancel_hunk_grouping(
    request_id: String,
    active_groupings: tauri::State<'_, ActiveGroupings>,
) {
    if let Some(flag) = active_groupings.0.lock().unwrap().get(&request_id) {
        info!(
            "[cancel_hunk_grouping] Cancelling request_id={}",
            request_id
        );
        flag.store(true, Ordering::Relaxed);
    }
}

#[tauri::command]
pub async fn generate_commit_message(
    app: tauri::AppHandle,
    repo_path: String,
    request_id: String,
) -> Result<String, String> {
    use tauri::Emitter;

    let t0 = Instant::now();
    let event_name = format!("commit-message:chunk:{request_id}");

    debug!("[generate_commit_message] repo_path={repo_path}, request_id={request_id}");

    let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(128);

    let emit_handle = app.clone();
    let emit_task = tokio::spawn(async move {
        while let Some(chunk) = rx.recv().await {
            let _ = emit_handle.emit(&event_name, &chunk);
        }
    });

    let result = tokio::task::spawn_blocking(move || {
        let repo_path = PathBuf::from(&repo_path);
        let source = LocalGitSource::new(repo_path.clone()).map_err(|e| e.to_string())?;
        let staged_diff = source.get_staged_diff().map_err(|e| e.to_string())?;
        if staged_diff.trim().is_empty() {
            return Err("No staged changes to generate a message for".to_owned());
        }
        let recent_messages = source.get_recent_commit_messages(10).unwrap_or_default();

        let mut on_text = |text: &str| {
            let _ = tx.blocking_send(text.to_owned());
        };
        review::ai::commit_message::generate_commit_message_streaming(
            &staged_diff,
            &recent_messages,
            &repo_path,
            &mut on_text,
        )
        .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?;

    // Wait for all events to be emitted
    let _ = emit_task.await;

    match &result {
        Ok(msg) => info!(
            "[generate_commit_message] SUCCESS: {} chars in {:?}",
            msg.len(),
            t0.elapsed()
        ),
        Err(e) => error!(
            "[generate_commit_message] ERROR: {} in {:?}",
            e,
            t0.elapsed()
        ),
    }

    result
}

// --- Settings file I/O ---

/// Return the path to `~/.review/settings.json` (respects `$REVIEW_HOME`).
fn settings_path() -> Result<PathBuf, String> {
    let root = review::review::central::get_central_root().map_err(|e| e.to_string())?;
    Ok(root.join("settings.json"))
}

/// Read a single key from `settings.json`. Returns `None` if the file or key is missing.
pub fn read_setting(key: &str) -> Option<serde_json::Value> {
    let path = settings_path().ok()?;
    let content = std::fs::read_to_string(&path).ok()?;
    let obj: serde_json::Value = serde_json::from_str(&content).ok()?;
    obj.get(key).cloned()
}

/// Atomically write JSON to a file (write tmp + rename).
fn atomic_write_json(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json.as_bytes()).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    Ok(())
}

/// Read the entire `settings.json` file. Returns `null` if the file doesn't exist.
#[tauri::command]
pub fn read_settings() -> Result<Option<serde_json::Value>, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    Ok(Some(value))
}

/// Atomically write the full settings JSON to `settings.json`.
#[tauri::command]
pub fn write_settings(settings: serde_json::Value) -> Result<(), String> {
    let path = settings_path()?;
    atomic_write_json(&path, &settings)
}

/// Create the settings file if it doesn't exist, then open it with the system editor.
#[tauri::command]
pub fn open_settings_file(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let path = settings_path()?;
    if !path.exists() {
        // Create with empty object so the user has a valid JSON file to edit
        atomic_write_json(&path, &serde_json::json!({}))?;
    }
    app.opener()
        .open_path(path.to_string_lossy().as_ref(), None::<&str>)
        .map_err(|e| e.to_string())
}

// --- VS Code theme detection ---

/// Detect the active VS Code theme by reading VS Code settings and extension files.
#[tauri::command]
pub fn detect_vscode_theme() -> Result<VscodeThemeDetection, String> {
    review::service::vscode::detect_vscode_theme().map_err(|e| e.to_string())
}

// --- Window background color ---

/// Set the background color of a window (affects title bar on macOS).
#[tauri::command]
pub fn set_window_background_color(
    window: tauri::WebviewWindow,
    r: u8,
    g: u8,
    b: u8,
) -> Result<(), String> {
    window
        .set_background_color(Some(tauri::window::Color(r, g, b, 255)))
        .map_err(|e| e.to_string())
}

/// List files in a plain directory (no git needed).
#[tauri::command]
pub async fn list_directory_plain(dir_path: String) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || {
        review::service::files::list_directory_plain(std::path::Path::new(&dir_path))
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}
