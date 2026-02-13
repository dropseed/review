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
use review::ai::classify::HunkInput;
use review::ai::grouping::{GroupingInput, ModifiedSymbolEntry};
use review::classify::{self, ClassifyResponse};
use review::diff::parser::{
    compute_content_hash, create_binary_hunk, create_untracked_hunk, detect_move_pairs, parse_diff,
    parse_multi_file_diff, DiffHunk, MovePair,
};
use review::review::state::{HunkGroup, ReviewState, ReviewSummary};
use review::review::storage::{self, GlobalReviewSummary};
use review::sources::github::{GhCliProvider, GitHubProvider, PullRequest};
use review::sources::local_git::{DiffShortStat, LocalGitSource, RemoteInfo, SearchMatch};
use review::sources::traits::{
    BranchList, CommitDetail, CommitEntry, Comparison, DiffSource, FileEntry, GitStatusSummary,
};
use review::symbols::{self, FileSymbolDiff, Symbol};
use review::trust::patterns::TrustCategory;
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};

// --- Window defaults ---

/// Default window width in logical pixels.
const DEFAULT_WINDOW_WIDTH: f64 = 1100.0;
/// Default window height in logical pixels.
const DEFAULT_WINDOW_HEIGHT: f64 = 750.0;
/// Minimum window width in logical pixels.
const MIN_WINDOW_WIDTH: f64 = 800.0;
/// Minimum window height in logical pixels.
const MIN_WINDOW_HEIGHT: f64 = 600.0;

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
use std::time::Instant;

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
pub async fn list_files(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    tokio::task::spawn_blocking(move || list_files_sync(repo_path, comparison))
        .await
        .map_err(|e| e.to_string())?
}

/// Synchronous implementation of `list_files`, callable from blocking contexts.
pub fn list_files_sync(
    repo_path: String,
    comparison: Comparison,
) -> Result<Vec<FileEntry>, String> {
    let t0 = Instant::now();
    debug!("[list_files] repo_path={repo_path}, comparison={comparison:?}");

    // PR routing: use gh CLI to get file list
    if let Some(ref pr) = comparison.github_pr {
        let provider = GhCliProvider::new(PathBuf::from(&repo_path));
        let files = provider
            .get_pull_request_files(pr.number)
            .map_err(|e| e.to_string())?;
        let result = review::sources::github::pr_files_to_file_entries(files);
        info!(
            "[list_files] SUCCESS (PR #{}): {} entries in {:?}",
            pr.number,
            result.len(),
            t0.elapsed()
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
    info!(
        "[list_files] SUCCESS: {} entries in {:?}",
        result.len(),
        t0.elapsed()
    );
    Ok(result)
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
    let t0 = Instant::now();
    debug!("[list_all_files] repo_path={repo_path}, comparison={comparison:?}");
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[list_all_files] ERROR creating source: {e}");
        e.to_string()
    })?;

    let result = source.list_all_files(&comparison).map_err(|e| {
        error!("[list_all_files] ERROR listing files: {e}");
        e.to_string()
    })?;
    info!(
        "[list_all_files] SUCCESS: {} entries in {:?}",
        result.len(),
        t0.elapsed()
    );
    Ok(result)
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
    debug!("[list_directory_contents] repo_path={repo_path}, dir_path={dir_path}");
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[list_directory_contents] ERROR creating source: {e}");
        e.to_string()
    })?;

    let result = source.list_directory_contents(&dir_path).map_err(|e| {
        error!("[list_directory_contents] ERROR listing directory: {e}");
        e.to_string()
    })?;
    info!(
        "[list_directory_contents] SUCCESS: {} entries in {dir_path}",
        result.len()
    );
    Ok(result)
}

#[tauri::command]
pub async fn get_file_content(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
) -> Result<FileContent, String> {
    tokio::task::spawn_blocking(move || get_file_content_sync(repo_path, file_path, comparison))
        .await
        .map_err(|e| e.to_string())?
}

/// Synchronous implementation of `get_file_content`, callable from blocking contexts.
pub fn get_file_content_sync(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
) -> Result<FileContent, String> {
    let t0 = Instant::now();
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
        // Validate the logical path doesn't escape the repo.
        // We check the un-canonicalized relative path for traversal rather than
        // canonicalizing, because symlinks inside the repo may resolve to targets
        // outside it (e.g., .claude/skills/my-skill -> /other/repo/skill).
        // Those are safe to read as long as the relative path itself is clean.
        if file_path.contains("..") || file_path.starts_with('/') || file_path.starts_with('\\') {
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

        let old_ref = &comparison.old;
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

    // Symlink directories: return the link target as content (like git stores them)
    if full_path.is_dir() {
        let is_symlink = full_path
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink());

        if !is_symlink {
            return Err(format!("Path is a directory: {file_path}"));
        }

        let target = std::fs::read_link(&full_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let content = format!("{target}\n");
        let content_hash = compute_content_hash(content.as_bytes());
        let hunks = vec![create_untracked_hunk(
            &file_path,
            &content_hash,
            Some(&content),
        )];

        return Ok(FileContent {
            content,
            old_content: None,
            diff_patch: String::new(),
            hunks,
            content_type: "text".to_owned(),
            image_data_url: None,
            old_image_data_url: None,
        });
    }

    let content_type = get_content_type(&file_path);
    let ext = file_path.rsplit('.').next().unwrap_or("");
    let mime_type = get_image_mime_type(ext);

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
            let content_hash = compute_content_hash(&current_bytes);
            vec![create_untracked_hunk(&file_path, &content_hash, None)]
        } else if content_type == "svg" {
            parse_diff(&diff_output, &file_path)
        } else {
            vec![create_binary_hunk(&file_path)]
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
            let content_hash = compute_content_hash(content.as_bytes());
            vec![create_untracked_hunk(
                &file_path,
                &content_hash,
                Some(&content),
            )]
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
        // Use comparison.old (the base ref) for old content, not HEAD.
        // When comparing e.g. main..feature+working-tree, HEAD points to the
        // feature branch, so using HEAD would make old == new (both from feature),
        // causing MultiFileDiff to show zero changes.
        let old_ref = &comparison.old;
        let old = match source.get_file_bytes(&file_path, old_ref) {
            Ok(bytes) => {
                debug!(
                    "[get_file_content] got old content from {old_ref}: {} bytes",
                    bytes.len()
                );
                String::from_utf8(bytes).ok()
            }
            Err(e) => {
                debug!("[get_file_content] no old version available from {old_ref}: {e}");
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

    let result = FileContent {
        content: final_content,
        old_content,
        diff_patch: diff_output,
        hunks,
        content_type,
        image_data_url: None,
        old_image_data_url: None,
    };
    let payload_estimate = result.content.len()
        + result.old_content.as_ref().map_or(0, |s| s.len())
        + result.diff_patch.len();
    info!(
        "[get_file_content] SUCCESS file={file_path} hunks={} payload≈{}KB in {:?}",
        result.hunks.len(),
        payload_estimate / 1024,
        t0.elapsed()
    );
    Ok(result)
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

/// Batch-load all hunks for multiple files in a single IPC call.
///
/// Instead of calling `get_file_content` N times (one per changed file),
/// this command runs a single `git diff` for all files, parses all hunks,
/// and handles untracked files—returning every hunk in one response.
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
    let t0 = Instant::now();
    debug!(
        "[get_all_hunks] repo_path={repo_path}, {} files",
        file_paths.len()
    );

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[get_all_hunks] ERROR creating source: {e}");
        e.to_string()
    })?;

    // Single git diff call for all files at once
    let diff_start = Instant::now();
    let full_diff = source.get_diff(&comparison, None).map_err(|e| {
        error!("[get_all_hunks] ERROR getting diff: {e}");
        e.to_string()
    })?;
    debug!(
        "[get_all_hunks] git diff: {}KB in {:?}",
        full_diff.len() / 1024,
        diff_start.elapsed()
    );

    // Parse all hunks from the combined diff
    let parse_start = Instant::now();
    let mut all_hunks = parse_multi_file_diff(&full_diff);
    debug!(
        "[get_all_hunks] parsed {} hunks in {:?}",
        all_hunks.len(),
        parse_start.elapsed()
    );

    // Build a set of file paths that got hunks from the diff
    let files_with_hunks: std::collections::HashSet<String> =
        all_hunks.iter().map(|h| h.file_path.clone()).collect();

    // For requested files that have no diff hunks, check if they're
    // untracked (new) and create untracked hunks for them
    let repo_path_buf = PathBuf::from(&repo_path);
    for file_path in &file_paths {
        if !files_with_hunks.contains(file_path.as_str()) {
            let is_tracked = source.is_file_tracked(file_path).unwrap_or(false);
            if !is_tracked {
                let full_path = repo_path_buf.join(file_path);
                let (content_hash, text_content) = std::fs::read(&full_path)
                    .map(|bytes| {
                        let hash = compute_content_hash(&bytes);
                        let text = String::from_utf8(bytes).ok();
                        (hash, text)
                    })
                    .unwrap_or_else(|_| ("00000000".to_owned(), None));
                all_hunks.push(create_untracked_hunk(
                    file_path,
                    &content_hash,
                    text_content.as_deref(),
                ));
            }
        }
    }

    // Filter to only include hunks for the requested files
    let requested: std::collections::HashSet<&str> =
        file_paths.iter().map(|s| s.as_str()).collect();
    all_hunks.retain(|h| requested.contains(h.file_path.as_str()));

    info!(
        "[get_all_hunks] SUCCESS: {} hunks from {} files in {:?}",
        all_hunks.len(),
        file_paths.len(),
        t0.elapsed()
    );
    Ok(all_hunks)
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
pub fn ensure_review_exists(repo_path: String, comparison: Comparison) -> Result<(), String> {
    storage::ensure_review_exists(&PathBuf::from(&repo_path), &comparison)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn list_all_reviews_global() -> Result<Vec<GlobalReviewSummary>, String> {
    storage::list_all_reviews_global().map_err(|e| e.to_string())
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
pub fn check_claude_available() -> bool {
    review::ai::check_claude_available()
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
        review::ai::classify::classify_hunks_batched(
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

    DetectMovePairsResponse { pairs, hunks }
}

/// Validate that a path is within .git/review/ or ~/.review/ for security
fn validate_review_path(path: &str) -> Result<PathBuf, String> {
    let path_buf = PathBuf::from(path);

    // Reject paths with ".." components to prevent traversal
    if path.contains("..") {
        return Err("Path traversal detected: path contains '..'".to_owned());
    }

    let path_str = path.replace('\\', "/");

    // Allow writes to .git/review/ (legacy log path)
    if path_str.contains("/.git/review/") || path_str.contains(".git/review/") {
        return Ok(path_buf);
    }

    // Allow writes to the central ~/.review/ directory
    if path_str.contains("/.review/repos/") || path_str.contains(".review/repos/") {
        return Ok(path_buf);
    }

    Err(
        "Security error: writes are only allowed to .git/review/ or ~/.review/ directory"
            .to_owned(),
    )
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
    comparison_key: Option<String>,
) -> Result<(), String> {
    use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
    use tauri_plugin_liquid_glass::{GlassMaterialVariant, LiquidGlassConfig, LiquidGlassExt};

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

        let window = WebviewWindowBuilder::new(&app, label, WebviewUrl::App("index.html".into()))
            .title("Review")
            .inner_size(width, height)
            .min_inner_size(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)
            .tabbing_identifier("review-main")
            .transparent(true)
            .build()
            .map_err(|e: tauri::Error| e.to_string())?;

        let _ = app.liquid_glass().set_effect(
            &window,
            LiquidGlassConfig {
                enabled: true,
                variant: GlassMaterialVariant::Sidebar,
                ..Default::default()
            },
        );

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
        .transparent(true)
        .build()
        .map_err(|e: tauri::Error| e.to_string())?;

    let _ = app.liquid_glass().set_effect(
        &window,
        LiquidGlassConfig {
            enabled: true,
            variant: GlassMaterialVariant::Sidebar,
            ..Default::default()
        },
    );

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

        // Pass 1: compute FileSymbolDiff per file (parallel), also return file contents for reuse
        let pass1_results: Vec<(
            FileSymbolDiff,
            Option<String>,
            Option<String>,
            Vec<DiffHunk>,
        )> = std::thread::scope(|s| {
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

                        let diff = symbols::extractor::compute_file_symbol_diff(
                            old_content.as_deref(),
                            new_content.as_deref(),
                            file_path,
                            &file_hunks,
                        );

                        (diff, old_content, new_content, file_hunks)
                    })
                })
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok()).collect()
        });

        // Collect modified symbol names across all files (from SymbolDiff trees)
        let mut modified_symbols: HashSet<String> = HashSet::new();
        // Track definition ranges per file: file_path -> (symbol_name -> (start, end))
        let mut definition_ranges_by_file: HashMap<String, HashMap<String, (u32, u32)>> =
            HashMap::new();

        fn collect_modified_names(
            symbols: &[review::symbols::SymbolDiff],
            file_path: &str,
            modified: &mut HashSet<String>,
            def_ranges: &mut HashMap<String, HashMap<String, (u32, u32)>>,
        ) {
            for sym in symbols {
                modified.insert(sym.name.clone());
                // Track definition range for this symbol in this file
                if let Some(ref range) = sym.new_range {
                    def_ranges
                        .entry(file_path.to_owned())
                        .or_default()
                        .insert(sym.name.clone(), (range.start_line, range.end_line));
                } else if let Some(ref range) = sym.old_range {
                    def_ranges
                        .entry(file_path.to_owned())
                        .or_default()
                        .insert(sym.name.clone(), (range.start_line, range.end_line));
                }
                collect_modified_names(&sym.children, file_path, modified, def_ranges);
            }
        }

        for (diff, _, _, _) in &pass1_results {
            collect_modified_names(
                &diff.symbols,
                &diff.file_path,
                &mut modified_symbols,
                &mut definition_ranges_by_file,
            );
        }

        // Extract per-file imported names for scoping symbol reference search
        let import_maps: Vec<Option<HashSet<String>>> = pass1_results
            .iter()
            .map(|(diff, _, new_content, _)| {
                new_content
                    .as_deref()
                    .and_then(|c| symbols::extractor::extract_imported_names(c, &diff.file_path))
            })
            .collect();

        // Pass 2: find references to modified symbols in each file (parallel)
        let results: Vec<FileSymbolDiff> = std::thread::scope(|s| {
            let handles: Vec<_> = pass1_results
                .into_iter()
                .zip(import_maps)
                .map(
                    |((mut diff, old_content, new_content, file_hunks), file_imports)| {
                        let modified_symbols = &modified_symbols;
                        let definition_ranges_by_file = &definition_ranges_by_file;
                        s.spawn(move || {
                            if diff.has_grammar {
                                let file_path = &diff.file_path;
                                let def_ranges = definition_ranges_by_file
                                    .get(file_path)
                                    .cloned()
                                    .unwrap_or_default();

                                // Scope target symbols: intersect with file's imports
                                // if import extraction succeeded. Symbols defined in this
                                // file are always included (they don't need to be imported).
                                let scoped_symbols: HashSet<String>;
                                let target_symbols = match &file_imports {
                                    Some(imports) => {
                                        let defined_in_file: HashSet<&String> =
                                            def_ranges.keys().collect();
                                        scoped_symbols = modified_symbols
                                            .iter()
                                            .filter(|sym| {
                                                imports.contains(sym.as_str())
                                                    || defined_in_file.contains(sym)
                                            })
                                            .cloned()
                                            .collect();
                                        &scoped_symbols
                                    }
                                    None => modified_symbols,
                                };

                                // Find references in new content
                                if let Some(ref content) = new_content {
                                    let mut refs = symbols::extractor::find_symbol_references(
                                        content,
                                        file_path,
                                        &file_hunks,
                                        target_symbols,
                                        &def_ranges,
                                        true,
                                    );
                                    diff.symbol_references.append(&mut refs);
                                }

                                // Find references in old content (for deletion-only hunks)
                                if let Some(ref content) = old_content {
                                    let mut refs = symbols::extractor::find_symbol_references(
                                        content,
                                        file_path,
                                        &file_hunks,
                                        target_symbols,
                                        &def_ranges,
                                        false,
                                    );
                                    // Deduplicate: only add refs for hunk IDs not already present
                                    let existing: HashSet<(&str, &str)> = diff
                                        .symbol_references
                                        .iter()
                                        .map(|r| (r.symbol_name.as_str(), r.hunk_id.as_str()))
                                        .collect();
                                    refs.retain(|r| {
                                        !existing
                                            .contains(&(r.symbol_name.as_str(), r.hunk_id.as_str()))
                                    });
                                    diff.symbol_references.append(&mut refs);
                                }
                            }
                            diff
                        })
                    },
                )
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
pub async fn find_symbol_definitions(
    repo_path: String,
    symbol_name: String,
) -> Result<Vec<symbols::SymbolDefinition>, String> {
    debug!(
        "[find_symbol_definitions] repo_path={}, symbol_name={}",
        repo_path, symbol_name
    );

    tokio::task::spawn_blocking(move || {
        // Use git grep to find candidate files containing the symbol name
        let output = std::process::Command::new("git")
            .args(["grep", "-l", "-F", "--", &symbol_name])
            .current_dir(&repo_path)
            .output()
            .map_err(|e| format!("Failed to run git grep: {e}"))?;

        let candidate_files: Vec<String> = if output.status.success() {
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .map(|l| l.to_string())
                .collect()
        } else {
            Vec::new()
        };

        // Filter to files with tree-sitter grammar support, cap at 50
        // to keep response times reasonable for common symbol names
        let supported_files: Vec<&String> = candidate_files
            .iter()
            .filter(|f| symbols::extractor::get_language_for_file(f).is_some())
            .take(50)
            .collect();

        info!(
            "[find_symbol_definitions] {} candidates, {} with grammar support (capped at 50)",
            candidate_files.len(),
            supported_files.len()
        );

        // Process candidates in parallel using scoped threads
        let mut all_defs = Vec::new();
        std::thread::scope(|scope| {
            let handles: Vec<_> = supported_files
                .iter()
                .map(|file_path| {
                    let repo = &repo_path;
                    let name = &symbol_name;
                    let fp = file_path.as_str();
                    scope.spawn(move || {
                        let full_path = std::path::PathBuf::from(repo).join(fp);
                        let content = match std::fs::read_to_string(&full_path) {
                            Ok(c) => c,
                            Err(_) => return Vec::new(),
                        };
                        symbols::extractor::find_definitions(&content, fp, name)
                    })
                })
                .collect();

            for handle in handles {
                if let Ok(defs) = handle.join() {
                    all_defs.extend(defs);
                }
            }
        });

        info!(
            "[find_symbol_definitions] SUCCESS: {} definitions found",
            all_defs.len()
        );
        Ok(all_defs)
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

    Ok(())
}

// --- Sentry consent ---

#[tauri::command]
pub fn set_sentry_consent(enabled: bool, state: tauri::State<'_, super::SentryConsent>) {
    state.0.store(enabled, std::sync::atomic::Ordering::Relaxed);
}

/// Timeout for single-call Claude operations (grouping, summary, diagram).
const CLAUDE_CALL_TIMEOUT_SECS: u64 = 120;

#[tauri::command]
pub async fn generate_hunk_grouping(
    repo_path: String,
    hunks: Vec<GroupingInput>,
    model: Option<String>,
    command: Option<String>,
    modified_symbols: Option<Vec<ModifiedSymbolEntry>>,
) -> Result<Vec<HunkGroup>, String> {
    use std::time::Duration;
    use tokio::time::timeout;

    let model = model.unwrap_or_else(|| "sonnet".to_owned());
    let symbols = modified_symbols.unwrap_or_default();

    debug!(
        "[generate_hunk_grouping] repo_path={}, hunks={}, model={}, command={:?}, symbols={}",
        repo_path,
        hunks.len(),
        model,
        command,
        symbols.len()
    );

    let repo_path_buf = PathBuf::from(&repo_path);

    let result = timeout(
        Duration::from_secs(CLAUDE_CALL_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || {
            review::ai::grouping::generate_grouping(
                &hunks,
                &repo_path_buf,
                &model,
                command.as_deref(),
                &symbols,
            )
        }),
    )
    .await
    .map_err(|_| {
        format!("Hunk grouping generation timed out after {CLAUDE_CALL_TIMEOUT_SECS} seconds")
    })?
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    info!("[generate_hunk_grouping] SUCCESS: {} groups", result.len());
    Ok(result)
}

#[tauri::command]
pub async fn generate_review_summary(
    repo_path: String,
    hunks: Vec<review::ai::summary::SummaryInput>,
    model: Option<String>,
    command: Option<String>,
) -> Result<String, String> {
    use std::time::Duration;
    use tokio::time::timeout;

    let model = model.unwrap_or_else(|| "sonnet".to_owned());

    debug!(
        "[generate_review_summary] repo_path={}, hunks={}, model={}, command={:?}",
        repo_path,
        hunks.len(),
        model,
        command,
    );

    let repo_path_buf = PathBuf::from(&repo_path);

    let result = timeout(
        Duration::from_secs(CLAUDE_CALL_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || {
            review::ai::summary::generate_summary(
                &hunks,
                &repo_path_buf,
                &model,
                command.as_deref(),
            )
        }),
    )
    .await
    .map_err(|_| format!("Summary generation timed out after {CLAUDE_CALL_TIMEOUT_SECS} seconds"))?
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    info!("[generate_review_summary] SUCCESS: {} chars", result.len());
    Ok(result)
}

#[tauri::command]
pub async fn generate_review_diagram(
    repo_path: String,
    hunks: Vec<review::ai::summary::SummaryInput>,
    model: Option<String>,
    command: Option<String>,
) -> Result<Option<String>, String> {
    use std::time::Duration;
    use tokio::time::timeout;

    let model = model.unwrap_or_else(|| "sonnet".to_owned());

    debug!(
        "[generate_review_diagram] repo_path={}, hunks={}, model={}, command={:?}",
        repo_path,
        hunks.len(),
        model,
        command,
    );

    let repo_path_buf = PathBuf::from(&repo_path);

    let result = timeout(
        Duration::from_secs(CLAUDE_CALL_TIMEOUT_SECS),
        tokio::task::spawn_blocking(move || {
            review::ai::summary::generate_diagram(
                &hunks,
                &repo_path_buf,
                &model,
                command.as_deref(),
            )
        }),
    )
    .await
    .map_err(|_| format!("Diagram generation timed out after {CLAUDE_CALL_TIMEOUT_SECS} seconds"))?
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let status = match &result {
        None => "skipped",
        Some(s) if s.is_empty() => "empty",
        Some(_) => "generated",
    };
    info!("[generate_review_diagram] SUCCESS: {status}");
    Ok(result)
}

// --- Companion server commands ---

#[tauri::command]
pub fn generate_companion_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::getrandom(&mut bytes).expect("Failed to generate random bytes");
    BASE64.encode(bytes)
}

#[tauri::command]
pub fn start_companion_server(app_handle: tauri::AppHandle) -> Result<(), String> {
    use super::companion_server;
    use tauri_plugin_store::StoreExt;

    let store = app_handle
        .store("preferences.json")
        .map_err(|e| e.to_string())?;
    let token = store
        .get("companionServerToken")
        .and_then(|v| v.as_str().map(|s| s.to_string()));

    if let Some(ref t) = token {
        companion_server::set_auth_token(Some(t.clone()));
    }
    companion_server::start();
    Ok(())
}

#[tauri::command]
pub fn stop_companion_server() {
    use super::companion_server;
    companion_server::stop();
    companion_server::set_auth_token(None);
}

#[tauri::command]
pub fn get_companion_server_status() -> bool {
    use super::companion_server;
    companion_server::is_running()
}
