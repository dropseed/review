//! Tauri command handlers for the desktop application.
//!
//! All #[tauri::command] functions are defined here as thin wrappers
//! that delegate to core business logic modules.

// Tauri's IPC protocol requires command parameters to be owned types.
#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri commands require owned parameters for IPC deserialization"
)]

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use log::{debug, error, info};
use review::classify::{self, ClassifyResponse, HunkInput};
use review::diff::parser::{
    create_untracked_hunk, detect_move_pairs, parse_diff, parse_multi_file_diff, DiffHunk, MovePair,
};
use review::narrative::NarrativeInput;
use review::review::state::{ReviewState, ReviewSummary};
use review::review::storage;
use review::sources::github::{GhCliProvider, GitHubProvider, PullRequest};
use review::sources::local_git::{LocalGitSource, RemoteInfo, SearchMatch};
use review::sources::traits::{
    BranchList, CommitDetail, CommitEntry, Comparison, DiffSource, FileEntry, GitStatusSummary,
};
use review::symbols::{self, FileSymbolDiff, Symbol};
use review::trust::patterns::TrustCategory;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;

// --- Window defaults ---

/// Default window width in logical pixels.
const DEFAULT_WINDOW_WIDTH: f64 = 1100.0;
/// Default window height in logical pixels.
const DEFAULT_WINDOW_HEIGHT: f64 = 750.0;
/// Minimum window width in logical pixels.
const MIN_WINDOW_WIDTH: f64 = 800.0;
/// Minimum window height in logical pixels.
const MIN_WINDOW_HEIGHT: f64 = 600.0;
/// Background color for new windows (dark neutral).
const WINDOW_BG_COLOR: tauri::window::Color = tauri::window::Color(0x0c, 0x0a, 0x09, 0xff);

// --- Classification defaults ---

/// Default number of hunks per classification batch.
const DEFAULT_BATCH_SIZE: usize = 5;
/// Minimum allowed batch size.
const MIN_BATCH_SIZE: usize = 1;
/// Maximum allowed batch size.
const MAX_BATCH_SIZE: usize = 20;
/// Default number of concurrent classification batches.
const DEFAULT_MAX_CONCURRENT: usize = 2;
/// Minimum concurrent batches.
const MIN_CONCURRENT: usize = 1;
/// Maximum concurrent batches.
const MAX_CONCURRENT: usize = 10;
/// Base timeout in seconds for classification.
const CLASSIFY_BASE_TIMEOUT_SECS: u64 = 60;
/// Additional timeout seconds per batch.
const CLASSIFY_SECS_PER_BATCH: u64 = 30;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;

// --- Types ---

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub content: String,
    #[serde(rename = "oldContent")]
    pub old_content: Option<String>,
    #[serde(rename = "diffPatch")]
    pub diff_patch: String,
    pub hunks: Vec<DiffHunk>,
    #[serde(rename = "contentType")]
    pub content_type: String,
    #[serde(rename = "imageDataUrl")]
    pub image_data_url: Option<String>,
    #[serde(rename = "oldImageDataUrl")]
    pub old_image_data_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct DetectMovePairsResponse {
    pub pairs: Vec<MovePair>,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Serialize)]
pub struct ExpandedContextResult {
    pub lines: Vec<String>,
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct ComparisonParam {
    pub old: String,
    pub new: String,
    #[serde(rename = "workingTree")]
    pub working_tree: bool,
    pub key: String,
    #[serde(rename = "githubPr", default)]
    pub github_pr: Option<review::sources::github::GitHubPrRef>,
}

// --- Helper Functions ---

fn get_image_mime_type(extension: &str) -> Option<&'static str> {
    match extension.to_lowercase().as_str() {
        "svg" => Some("image/svg+xml"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "avif" => Some("image/avif"),
        "ico" => Some("image/x-icon"),
        "icns" => Some("image/icns"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn is_image_file(file_path: &str) -> bool {
    let ext = file_path.rsplit('.').next().unwrap_or("");
    get_image_mime_type(ext).is_some()
}

fn get_content_type(file_path: &str) -> String {
    let ext = file_path.rsplit('.').next().unwrap_or("").to_lowercase();
    if ext == "svg" {
        "svg".to_owned()
    } else if is_image_file(file_path) {
        "image".to_owned()
    } else {
        "text".to_owned()
    }
}

fn bytes_to_data_url(bytes: &[u8], mime_type: &str) -> String {
    let base64_data = BASE64.encode(bytes);
    format!("data:{mime_type};base64,{base64_data}")
}

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
pub fn list_files(repo_path: String, comparison: Comparison) -> Result<Vec<FileEntry>, String> {
    debug!("[list_files] repo_path={repo_path}, comparison={comparison:?}");

    // PR routing: use gh CLI to get file list
    if let Some(ref pr) = comparison.github_pr {
        let provider = GhCliProvider::new(PathBuf::from(&repo_path));
        let files = provider
            .get_pull_request_files(pr.number)
            .map_err(|e| e.to_string())?;
        let result = review::sources::github::pr_files_to_file_entries(files);
        info!(
            "[list_files] SUCCESS (PR #{}): {} entries",
            pr.number,
            result.len()
        );
        return Ok(result);
    }

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[list_files] ERROR creating source: {e}");
        e.to_string()
    })?;

    let result = source.list_files(&comparison).map_err(|e| {
        error!("[list_files] ERROR listing files: {e}");
        e.to_string()
    })?;
    info!("[list_files] SUCCESS: {} entries", result.len());
    Ok(result)
}

#[tauri::command]
pub fn list_all_files(repo_path: String, comparison: Comparison) -> Result<Vec<FileEntry>, String> {
    debug!("[list_all_files] repo_path={repo_path}, comparison={comparison:?}");
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[list_all_files] ERROR creating source: {e}");
        e.to_string()
    })?;

    let result = source.list_all_files(&comparison).map_err(|e| {
        error!("[list_all_files] ERROR listing files: {e}");
        e.to_string()
    })?;
    info!("[list_all_files] SUCCESS: {} entries", result.len());
    Ok(result)
}

#[tauri::command]
pub fn get_file_content(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
) -> Result<FileContent, String> {
    debug!(
        "[get_file_content] repo_path={repo_path}, file_path={file_path}, comparison={comparison:?}"
    );

    // PR routing: get diff from gh CLI and content from local git refs
    if let Some(ref pr) = comparison.github_pr {
        return get_file_content_for_pr(&repo_path, &file_path, pr);
    }

    let repo_path_buf = PathBuf::from(&repo_path);
    let full_path = repo_path_buf.join(&file_path);
    let file_exists = full_path.exists();

    debug!(
        "[get_file_content] full_path={}, exists={}",
        full_path.display(),
        file_exists
    );

    if file_exists {
        let canonical_repo = repo_path_buf
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalize repo path: {e}"))?;
        let canonical_full = full_path
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalize file path: {e}"))?;
        if !canonical_full.starts_with(&canonical_repo) {
            return Err("Path traversal detected: file path escapes repository".to_owned());
        }
    } else {
        // For non-existent files (deleted), validate the path more strictly
        // Check for ".." in path components to prevent traversal
        if file_path.contains("..") {
            return Err("Path traversal detected: file path contains '..'".to_owned());
        }
        // Also validate the file path doesn't try to escape via absolute paths
        if file_path.starts_with('/') || file_path.starts_with('\\') {
            return Err("Path traversal detected: file path is absolute".to_owned());
        }
        // Validate no backslash traversal attempts on Windows-style paths
        let normalized = file_path.replace('\\', "/");
        for component in normalized.split('/') {
            if component == ".." {
                return Err("Path traversal detected: file path contains '..'".to_owned());
            }
        }
    }

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[get_file_content] ERROR creating source: {e}");
        e.to_string()
    })?;

    if !file_exists {
        debug!("[get_file_content] handling deleted file");
        let diff_output = source
            .get_diff(&comparison, Some(&file_path))
            .map_err(|e| {
                error!("[get_file_content] ERROR getting diff: {e}");
                e.to_string()
            })?;

        let hunks = if diff_output.is_empty() {
            vec![]
        } else {
            parse_diff(&diff_output, &file_path)
        };

        let old_ref = if comparison.working_tree {
            "HEAD"
        } else {
            &comparison.old
        };
        let old_content = match source.get_file_bytes(&file_path, old_ref) {
            Ok(bytes) => String::from_utf8(bytes).ok(),
            Err(_) => None,
        };

        return Ok(FileContent {
            content: String::new(),
            old_content,
            diff_patch: diff_output,
            hunks,
            content_type: "text".to_owned(),
            image_data_url: None,
            old_image_data_url: None,
        });
    }

    let content_type = get_content_type(&file_path);
    let ext = file_path.rsplit('.').next().unwrap_or("");
    let mime_type = get_image_mime_type(ext);

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[get_file_content] ERROR creating source: {e}");
        e.to_string()
    })?;

    if content_type == "image" || content_type == "svg" {
        debug!("[get_file_content] handling as image/svg: {content_type}");

        let current_bytes = std::fs::read(&full_path).map_err(|e| {
            error!("[get_file_content] ERROR reading file bytes: {e}");
            format!("{}: {}", full_path.display(), e)
        })?;

        let image_data_url = mime_type.map(|mt| bytes_to_data_url(&current_bytes, mt));

        let content = if content_type == "svg" {
            String::from_utf8_lossy(&current_bytes).to_string()
        } else {
            String::new()
        };

        let diff_output = source
            .get_diff(&comparison, Some(&file_path))
            .map_err(|e| {
                error!("[get_file_content] ERROR getting diff: {e}");
                e.to_string()
            })?;

        let old_image_data_url = if diff_output.is_empty() {
            None
        } else {
            let old_ref = if comparison.working_tree {
                "HEAD".to_owned()
            } else {
                comparison.old.clone()
            };

            match source.get_file_bytes(&file_path, &old_ref) {
                Ok(old_bytes) => {
                    debug!(
                        "[get_file_content] got old image bytes: {} bytes",
                        old_bytes.len()
                    );
                    mime_type.map(|mt| bytes_to_data_url(&old_bytes, mt))
                }
                Err(e) => {
                    debug!("[get_file_content] no old version available: {e}");
                    None
                }
            }
        };

        let hunks = if diff_output.is_empty() {
            vec![create_untracked_hunk(&file_path)]
        } else if content_type == "svg" {
            parse_diff(&diff_output, &file_path)
        } else {
            vec![create_untracked_hunk(&file_path)]
        };

        info!("[get_file_content] SUCCESS (image)");
        return Ok(FileContent {
            content,
            old_content: None,
            diff_patch: diff_output,
            hunks,
            content_type,
            image_data_url,
            old_image_data_url,
        });
    }

    let content = std::fs::read_to_string(&full_path).map_err(|e| {
        error!("[get_file_content] ERROR reading file: {e}");
        format!("{}: {}", full_path.display(), e)
    })?;
    debug!(
        "[get_file_content] file content length: {} bytes",
        content.len()
    );

    let diff_output = source
        .get_diff(&comparison, Some(&file_path))
        .map_err(|e| {
            error!("[get_file_content] ERROR getting diff: {e}");
            e.to_string()
        })?;
    debug!(
        "[get_file_content] diff output length: {} bytes",
        diff_output.len()
    );

    let hunks = if diff_output.is_empty() {
        let is_tracked = source.is_file_tracked(&file_path).unwrap_or(false);
        if is_tracked {
            debug!("[get_file_content] no diff, file is tracked (unchanged)");
            vec![]
        } else {
            debug!("[get_file_content] no diff, file is untracked (new)");
            vec![create_untracked_hunk(&file_path)]
        }
    } else {
        debug!("[get_file_content] parsing diff...");
        let parsed = parse_diff(&diff_output, &file_path);
        debug!("[get_file_content] parsed {} hunks", parsed.len());
        parsed
    };

    let (old_content, final_content) = if diff_output.is_empty() {
        (None, content)
    } else if comparison.working_tree {
        let old = match source.get_file_bytes(&file_path, "HEAD") {
            Ok(bytes) => {
                debug!(
                    "[get_file_content] got old content from HEAD: {} bytes",
                    bytes.len()
                );
                String::from_utf8(bytes).ok()
            }
            Err(e) => {
                debug!("[get_file_content] no old version available: {e}");
                None
            }
        };
        (old, content)
    } else {
        let old = match source.get_file_bytes(&file_path, &comparison.old) {
            Ok(bytes) => {
                debug!(
                    "[get_file_content] got old content from {}: {} bytes",
                    comparison.old,
                    bytes.len()
                );
                String::from_utf8(bytes).ok()
            }
            Err(e) => {
                debug!(
                    "[get_file_content] no old version at {}: {}",
                    comparison.old, e
                );
                None
            }
        };
        let new = match source.get_file_bytes(&file_path, &comparison.new) {
            Ok(bytes) => {
                debug!(
                    "[get_file_content] got new content from {}: {} bytes",
                    comparison.new,
                    bytes.len()
                );
                String::from_utf8(bytes).ok()
            }
            Err(e) => {
                debug!(
                    "[get_file_content] no new version at {}: {}",
                    comparison.new, e
                );
                None
            }
        };
        (old, new.unwrap_or_default())
    };

    info!("[get_file_content] SUCCESS");
    Ok(FileContent {
        content: final_content,
        old_content,
        diff_patch: diff_output,
        hunks,
        content_type,
        image_data_url: None,
        old_image_data_url: None,
    })
}

/// Get file content for a PR by extracting the file's diff from `gh pr diff`
/// and resolving old/new content from local git refs.
fn get_file_content_for_pr(
    repo_path: &str,
    file_path: &str,
    pr: &review::sources::github::GitHubPrRef,
) -> Result<FileContent, String> {
    let repo_path_buf = PathBuf::from(repo_path);
    let provider = GhCliProvider::new(repo_path_buf.clone());

    // Get the full PR diff and extract this file's portion
    let full_diff = provider
        .get_pull_request_diff(pr.number)
        .map_err(|e| e.to_string())?;

    // Extract the diff section for this specific file
    let file_diff = extract_file_diff(&full_diff, file_path);

    let hunks = if file_diff.is_empty() {
        vec![]
    } else {
        parse_diff(&file_diff, file_path)
    };

    let content_type = get_content_type(file_path);

    // For images, just return minimal info with the diff
    if content_type == "image" {
        return Ok(FileContent {
            content: String::new(),
            old_content: None,
            diff_patch: file_diff,
            hunks,
            content_type,
            image_data_url: None,
            old_image_data_url: None,
        });
    }

    // Try to get old/new content from local git refs
    let source = LocalGitSource::new(repo_path_buf.clone()).map_err(|e| e.to_string())?;

    let old_content = source
        .get_file_bytes(file_path, &pr.base_ref_name)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok());

    // Try the head ref first; if not available locally, try fetching
    let new_content = source
        .get_file_bytes(file_path, &pr.head_ref_name)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .or_else(|| {
            // Try fetching the PR head ref
            let fetch_ref = format!("pull/{}/head:refs/pr/{}", pr.number, pr.number);
            let _ = std::process::Command::new("git")
                .args(["fetch", "origin", &fetch_ref])
                .current_dir(repo_path)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();

            let pr_ref = format!("refs/pr/{}", pr.number);
            source
                .get_file_bytes(file_path, &pr_ref)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
        });

    let content = new_content.unwrap_or_default();

    Ok(FileContent {
        content,
        old_content,
        diff_patch: file_diff,
        hunks,
        content_type,
        image_data_url: None,
        old_image_data_url: None,
    })
}

/// Extract the diff section for a specific file from a multi-file diff output.
fn extract_file_diff(full_diff: &str, target_path: &str) -> String {
    let mut result = String::new();
    let mut capturing = false;

    for line in full_diff.lines() {
        if line.starts_with("diff --git ") {
            if capturing {
                break; // We've hit the next file's diff
            }
            // Check if this diff section is for our target file
            // Format: "diff --git a/path b/path"
            if line.contains(&format!(" b/{target_path}")) {
                capturing = true;
            }
        }
        if capturing {
            result.push_str(line);
            result.push('\n');
        }
    }

    result
}

#[tauri::command]
pub fn get_diff(repo_path: String, comparison: Comparison) -> Result<String, String> {
    // PR routing: use gh CLI to get diff
    if let Some(ref pr) = comparison.github_pr {
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
pub fn load_review_state(repo_path: String, comparison: Comparison) -> Result<ReviewState, String> {
    storage::load_review_state(&PathBuf::from(&repo_path), &comparison).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_review_state(repo_path: String, state: ReviewState) -> Result<(), String> {
    storage::save_review_state(&PathBuf::from(&repo_path), &state).map_err(|e| e.to_string())
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
pub fn get_git_status_raw(repo_path: String) -> Result<String, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_status_raw().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_commits(
    repo_path: String,
    limit: Option<usize>,
    branch: Option<String>,
) -> Result<Vec<CommitEntry>, String> {
    let limit = limit.unwrap_or(50);
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source
        .list_commits(limit, branch.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_commit_detail(repo_path: String, hash: String) -> Result<CommitDetail, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.get_commit_detail(&hash).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_current_comparison(repo_path: String) -> Result<Option<Comparison>, String> {
    storage::get_current_comparison(&PathBuf::from(&repo_path)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_current_comparison(repo_path: String, comparison: Comparison) -> Result<(), String> {
    storage::set_current_comparison(&PathBuf::from(&repo_path), &comparison)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn check_claude_available() -> bool {
    classify::check_claude_available()
}

#[tauri::command]
pub async fn classify_hunks_with_claude(
    app: tauri::AppHandle,
    repo_path: String,
    hunks: Vec<HunkInput>,
    model: Option<String>,
    command: Option<String>,
    batch_size: Option<usize>,
    max_concurrent: Option<usize>,
) -> Result<ClassifyResponse, String> {
    use std::time::Duration;
    use tauri::Emitter;
    use tokio::time::timeout;

    let model = model.unwrap_or_else(|| "sonnet".to_owned());
    let batch_size = batch_size
        .unwrap_or(DEFAULT_BATCH_SIZE)
        .clamp(MIN_BATCH_SIZE, MAX_BATCH_SIZE);
    let max_concurrent = max_concurrent
        .unwrap_or(DEFAULT_MAX_CONCURRENT)
        .clamp(MIN_CONCURRENT, MAX_CONCURRENT);

    let num_batches = hunks.len().div_ceil(batch_size);
    let timeout_secs = std::cmp::max(
        CLASSIFY_BASE_TIMEOUT_SECS,
        num_batches as u64 * CLASSIFY_SECS_PER_BATCH,
    );

    debug!(
        "[classify_hunks_with_claude] repo_path={}, hunks={}, model={}, command={:?}, batch_size={}, max_concurrent={}, timeout={}s",
        repo_path,
        hunks.len(),
        model,
        command,
        batch_size,
        max_concurrent,
        timeout_secs
    );

    let repo_path_buf = PathBuf::from(&repo_path);

    let result = timeout(
        Duration::from_secs(timeout_secs),
        classify::classify_hunks_batched(
            hunks,
            &repo_path_buf,
            &model,
            batch_size,
            max_concurrent,
            command.as_deref(),
            move |completed_ids| {
                let _ = app.emit("classify:batch-complete", completed_ids);
            },
        ),
    )
    .await
    .map_err(|_| format!("Classification timed out after {timeout_secs} seconds"))?
    .map_err(|e| e.to_string())?;

    info!(
        "[classify_hunks_with_claude] SUCCESS: {} classifications",
        result.classifications.len()
    );
    Ok(result)
}

#[tauri::command]
pub fn classify_hunks_static(hunks: Vec<DiffHunk>) -> ClassifyResponse {
    debug!(
        "[classify_hunks_static] Classifying {} hunks with static rules",
        hunks.len()
    );
    let result = classify::classify_hunks_static(&hunks);
    info!(
        "[classify_hunks_static] Classified {} of {} hunks",
        result.classifications.len(),
        hunks.len()
    );
    result
}

#[tauri::command]
pub fn detect_hunks_move_pairs(mut hunks: Vec<DiffHunk>) -> DetectMovePairsResponse {
    debug!(
        "[detect_hunks_move_pairs] Analyzing {} hunks for moves",
        hunks.len()
    );

    let pairs = detect_move_pairs(&mut hunks);

    debug!("[detect_hunks_move_pairs] Found {} move pairs", pairs.len());

    DetectMovePairsResponse { pairs, hunks }
}

/// Validate that a path is within .git/review/ for security
fn validate_review_path(path: &str) -> Result<PathBuf, String> {
    let path_buf = PathBuf::from(path);

    // Reject paths with ".." components to prevent traversal
    if path.contains("..") {
        return Err("Path traversal detected: path contains '..'".to_owned());
    }

    // The path must contain .git/review/ to be valid
    let path_str = path.replace('\\', "/");
    if !path_str.contains("/.git/review/") && !path_str.contains(".git/review/") {
        return Err("Security error: writes are only allowed to .git/review/ directory".to_owned());
    }

    Ok(path_buf)
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
) -> Result<ExpandedContextResult, String> {
    debug!(
        "[get_expanded_context] file={file_path}, lines {start_line}-{end_line}, comparison={comparison:?}"
    );

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;

    // For PRs, use the head ref name (best-effort)
    let git_ref = if let Some(ref pr) = comparison.github_pr {
        pr.head_ref_name.clone()
    } else if comparison.working_tree {
        "HEAD".to_owned()
    } else {
        comparison.new.clone()
    };

    let lines = source
        .get_file_lines(&file_path, &git_ref, start_line, end_line)
        .map_err(|e| e.to_string())?;

    info!("[get_expanded_context] SUCCESS: {} lines", lines.len());

    Ok(ExpandedContextResult {
        lines,
        start_line,
        end_line,
    })
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

#[tauri::command]
pub fn get_trust_taxonomy_with_custom(repo_path: String) -> Vec<TrustCategory> {
    review::trust::patterns::get_trust_taxonomy_with_custom(&PathBuf::from(&repo_path))
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

// Multi-window support
#[tauri::command]
pub async fn open_repo_window(
    app: tauri::AppHandle,
    repo_path: String,
    comparison: Option<ComparisonParam>,
) -> Result<(), String> {
    use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

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

        WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
            .title("Review")
            .inner_size(DEFAULT_WINDOW_WIDTH, DEFAULT_WINDOW_HEIGHT)
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
            .tabbing_identifier("review-main")
            .background_color(WINDOW_BG_COLOR)
            .build()
            .map_err(|e: tauri::Error| e.to_string())?;

        return Ok(());
    }

    let comparison_key = comparison
        .as_ref()
        .map_or_else(|| "default".to_owned(), |c| c.key.clone());

    let mut hasher = DefaultHasher::new();
    format!("{repo_path}:{comparison_key}").hash(&mut hasher);
    let label = format!("repo-{:x}", hasher.finish());

    if let Some(existing) = app.get_webview_window(&label) {
        existing
            .set_focus()
            .map_err(|e: tauri::Error| e.to_string())?;
        return Ok(());
    }

    let repo_name = std::path::Path::new(&repo_path).file_name().map_or_else(
        || "Repository".to_owned(),
        |s| s.to_string_lossy().to_string(),
    );

    let window_title = if let Some(ref c) = comparison {
        let compare_display = if c.working_tree && c.new == "HEAD" {
            "Working Tree".to_owned()
        } else {
            c.new.clone()
        };
        format!("{} — {}..{}", repo_name, c.old, compare_display)
    } else {
        repo_name
    };

    let url = if let Some(ref c) = comparison {
        WebviewUrl::App(
            format!(
                "index.html?repo={}&comparison={}",
                urlencoding::encode(&repo_path),
                urlencoding::encode(&c.key)
            )
            .into(),
        )
    } else {
        WebviewUrl::App(format!("index.html?repo={}", urlencoding::encode(&repo_path)).into())
    };

    let window = WebviewWindowBuilder::new(&app, label, url)
        .title(window_title)
        .inner_size(1100.0, 750.0)
        .min_inner_size(800.0, 600.0)
        .tabbing_identifier("review-main")
        .background_color(WINDOW_BG_COLOR)
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
    debug!(
        "[get_file_symbol_diffs] repo_path={}, files={}",
        repo_path,
        file_paths.len()
    );

    tokio::task::spawn_blocking(move || {
        let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
            error!("[get_file_symbol_diffs] ERROR creating source: {e}");
            e.to_string()
        })?;

        // Determine the git refs for old and new sides
        let old_ref = if comparison.working_tree {
            "HEAD".to_owned()
        } else {
            comparison.old.clone()
        };

        // Single git diff call for all files instead of one per file
        let full_diff = source.get_diff(&comparison, None).unwrap_or_default();
        let all_hunks = parse_multi_file_diff(&full_diff);

        // Process files in parallel: each gets its own thread for git show + tree-sitter parsing
        let results: Vec<FileSymbolDiff> = std::thread::scope(|s| {
            let handles: Vec<_> = file_paths
                .iter()
                .map(|file_path| {
                    let source = &source;
                    let all_hunks = &all_hunks;
                    let old_ref = old_ref.as_str();
                    let comparison = &comparison;
                    let repo_path = repo_path.as_str();
                    s.spawn(move || {
                        // Get old content
                        let old_content = source
                            .get_file_bytes(file_path, old_ref)
                            .ok()
                            .and_then(|bytes| String::from_utf8(bytes).ok());

                        // Get new content
                        let new_content = if comparison.working_tree {
                            let full_path = PathBuf::from(repo_path).join(file_path);
                            std::fs::read_to_string(&full_path).ok()
                        } else {
                            source
                                .get_file_bytes(file_path, &comparison.new)
                                .ok()
                                .and_then(|bytes| String::from_utf8(bytes).ok())
                        };

                        let file_hunks: Vec<_> = all_hunks
                            .iter()
                            .filter(|h| h.file_path == *file_path)
                            .cloned()
                            .collect();

                        symbols::extractor::compute_file_symbol_diff(
                            old_content.as_deref(),
                            new_content.as_deref(),
                            file_path,
                            &file_hunks,
                        )
                    })
                })
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });

        info!(
            "[get_file_symbol_diffs] SUCCESS: {} files processed",
            results.len()
        );
        Ok(results)
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
    debug!(
        "[get_file_symbols] repo_path={}, file_path={}, ref={:?}",
        repo_path, file_path, git_ref
    );

    tokio::task::spawn_blocking(move || {
        let content = if let Some(r) = &git_ref {
            let source = LocalGitSource::new(std::path::PathBuf::from(&repo_path))
                .map_err(|e| e.to_string())?;
            source
                .get_file_bytes(&file_path, r)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
        } else {
            let full_path = std::path::PathBuf::from(&repo_path).join(&file_path);
            std::fs::read_to_string(&full_path).ok()
        };

        let Some(content) = content else {
            return Ok(None);
        };

        Ok(symbols::extractor::extract_symbols(&content, &file_path))
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
    debug!(
        "[search_file_contents] repo_path={repo_path}, query={query}, case_sensitive={case_sensitive}, max_results={max_results}"
    );

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[search_file_contents] ERROR creating source: {e}");
        e.to_string()
    })?;

    let results = source
        .search_contents(&query, case_sensitive, max_results)
        .map_err(|e| {
            error!("[search_file_contents] ERROR searching: {e}");
            e.to_string()
        })?;

    info!("[search_file_contents] SUCCESS: {} matches", results.len());
    Ok(results)
}

/// Timeout for narrative generation (single Claude call for entire diff).
const NARRATIVE_TIMEOUT_SECS: u64 = 120;

#[tauri::command]
pub async fn generate_narrative(
    repo_path: String,
    hunks: Vec<NarrativeInput>,
    model: Option<String>,
    command: Option<String>,
) -> Result<String, String> {
    use std::time::Duration;
    use tokio::time::timeout;

    let model = model.unwrap_or_else(|| "sonnet".to_owned());

    debug!(
        "[generate_narrative] repo_path={}, hunks={}, model={}, command={:?}",
        repo_path,
        hunks.len(),
        model,
        command
    );

    let repo_path_buf = PathBuf::from(&repo_path);

    let result = timeout(
        Duration::from_secs(NARRATIVE_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || {
            review::narrative::generate_narrative(
                &hunks,
                &repo_path_buf,
                &model,
                command.as_deref(),
            )
        }),
    )
    .await
    .map_err(|_| format!("Narrative generation timed out after {NARRATIVE_TIMEOUT_SECS} seconds"))?
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    info!("[generate_narrative] SUCCESS: {} chars", result.len());
    Ok(result)
}
