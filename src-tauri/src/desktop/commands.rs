//! Tauri command handlers for the desktop application.
//!
//! All #[tauri::command] functions are defined here as thin wrappers
//! that delegate to core business logic modules.

use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use compare::classify::{self, ClassifyResponse, HunkInput};
use compare::diff::parser::{
    create_untracked_hunk, detect_move_pairs, parse_diff, DiffHunk, MovePair,
};
use compare::review::state::{ReviewState, ReviewSummary};
use compare::review::storage;
use compare::sources::local_git::{LocalGitSource, SearchMatch};
use compare::sources::traits::{BranchList, Comparison, DiffSource, FileEntry, GitStatusSummary};
use compare::trust::patterns::TrustCategory;
use log::{debug, error, info};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
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
        "svg".to_string()
    } else if is_image_file(file_path) {
        "image".to_string()
    } else {
        "text".to_string()
    }
}

fn bytes_to_data_url(bytes: &[u8], mime_type: &str) -> String {
    let base64_data = BASE64.encode(bytes);
    format!("data:{};base64,{}", mime_type, base64_data)
}

// --- Tauri Commands ---

#[tauri::command]
pub fn get_current_repo() -> Result<String, String> {
    // Check command-line arguments first (for `compare open` CLI command)
    // Args are passed like: Compare /path/to/repo
    let args: Vec<String> = std::env::args().collect();
    if args.len() > 1 {
        let repo_path = &args[1];
        let path = PathBuf::from(repo_path);
        if path.join(".git").exists() {
            // Register with sync server if running
            super::server::register_repo_global(repo_path.clone());
            return Ok(repo_path.clone());
        }
    }

    // Check current working directory and walk up to find .git
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    let mut current = cwd.as_path();
    loop {
        if current.join(".git").exists() {
            let repo_path = current.to_string_lossy().to_string();
            // Register with sync server if running
            super::server::register_repo_global(repo_path.clone());
            return Ok(repo_path);
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }

    Err("No git repository found.".to_string())
}

#[tauri::command]
pub fn list_files(repo_path: String, comparison: Comparison) -> Result<Vec<FileEntry>, String> {
    debug!(
        "[list_files] repo_path={}, comparison={:?}",
        repo_path, comparison
    );
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[list_files] ERROR creating source: {}", e);
        e.to_string()
    })?;

    let result = source.list_files(&comparison).map_err(|e| {
        error!("[list_files] ERROR listing files: {}", e);
        e.to_string()
    })?;
    info!("[list_files] SUCCESS: {} entries", result.len());
    Ok(result)
}

#[tauri::command]
pub fn list_all_files(repo_path: String, comparison: Comparison) -> Result<Vec<FileEntry>, String> {
    debug!(
        "[list_all_files] repo_path={}, comparison={:?}",
        repo_path, comparison
    );
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[list_all_files] ERROR creating source: {}", e);
        e.to_string()
    })?;

    let result = source.list_all_files(&comparison).map_err(|e| {
        error!("[list_all_files] ERROR listing files: {}", e);
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
        "[get_file_content] repo_path={}, file_path={}, comparison={:?}",
        repo_path, file_path, comparison
    );

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
            .map_err(|e| format!("Failed to canonicalize repo path: {}", e))?;
        let canonical_full = full_path
            .canonicalize()
            .map_err(|e| format!("Failed to canonicalize file path: {}", e))?;
        if !canonical_full.starts_with(&canonical_repo) {
            return Err("Path traversal detected: file path escapes repository".to_string());
        }
    } else {
        // For non-existent files (deleted), validate the path more strictly
        // Check for ".." in path components to prevent traversal
        if file_path.contains("..") {
            return Err("Path traversal detected: file path contains '..'".to_string());
        }
        // Also validate the file path doesn't try to escape via absolute paths
        if file_path.starts_with('/') || file_path.starts_with('\\') {
            return Err("Path traversal detected: file path is absolute".to_string());
        }
        // Validate no backslash traversal attempts on Windows-style paths
        let normalized = file_path.replace('\\', "/");
        for component in normalized.split('/') {
            if component == ".." {
                return Err("Path traversal detected: file path contains '..'".to_string());
            }
        }
    }

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[get_file_content] ERROR creating source: {}", e);
        e.to_string()
    })?;

    if !file_exists {
        debug!("[get_file_content] handling deleted file");
        let diff_output = source
            .get_diff(&comparison, Some(&file_path))
            .map_err(|e| {
                error!("[get_file_content] ERROR getting diff: {}", e);
                e.to_string()
            })?;

        let hunks = if diff_output.is_empty() {
            vec![]
        } else {
            parse_diff(&diff_output, &file_path)
        };

        let old_content = if comparison.working_tree {
            match source.get_file_bytes(&file_path, "HEAD") {
                Ok(bytes) => String::from_utf8(bytes).ok(),
                Err(_) => None,
            }
        } else {
            None
        };

        return Ok(FileContent {
            content: String::new(),
            old_content,
            diff_patch: diff_output,
            hunks,
            content_type: "text".to_string(),
            image_data_url: None,
            old_image_data_url: None,
        });
    }

    let content_type = get_content_type(&file_path);
    let ext = file_path.rsplit('.').next().unwrap_or("");
    let mime_type = get_image_mime_type(ext);

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[get_file_content] ERROR creating source: {}", e);
        e.to_string()
    })?;

    if content_type == "image" || content_type == "svg" {
        debug!("[get_file_content] handling as image/svg: {}", content_type);

        let current_bytes = std::fs::read(&full_path).map_err(|e| {
            error!("[get_file_content] ERROR reading file bytes: {}", e);
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
                error!("[get_file_content] ERROR getting diff: {}", e);
                e.to_string()
            })?;

        let old_image_data_url = if !diff_output.is_empty() {
            let old_ref = if comparison.working_tree {
                "HEAD".to_string()
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
                    debug!("[get_file_content] no old version available: {}", e);
                    None
                }
            }
        } else {
            None
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
        error!("[get_file_content] ERROR reading file: {}", e);
        format!("{}: {}", full_path.display(), e)
    })?;
    debug!(
        "[get_file_content] file content length: {} bytes",
        content.len()
    );

    let diff_output = source
        .get_diff(&comparison, Some(&file_path))
        .map_err(|e| {
            error!("[get_file_content] ERROR getting diff: {}", e);
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

    let (old_content, final_content) = if !diff_output.is_empty() {
        if comparison.working_tree {
            let old = match source.get_file_bytes(&file_path, "HEAD") {
                Ok(bytes) => {
                    debug!(
                        "[get_file_content] got old content from HEAD: {} bytes",
                        bytes.len()
                    );
                    String::from_utf8(bytes).ok()
                }
                Err(e) => {
                    debug!("[get_file_content] no old version available: {}", e);
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
            (old, new.unwrap_or(content))
        }
    } else {
        (None, content)
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

#[tauri::command]
pub fn get_diff(repo_path: String, comparison: Comparison) -> Result<String, String> {
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

    let model = model.unwrap_or_else(|| "sonnet".to_string());
    let batch_size = batch_size.unwrap_or(5).max(1).min(20);
    let max_concurrent = max_concurrent.unwrap_or(2).max(1).min(10);

    let num_batches = (hunks.len() + batch_size - 1) / batch_size;
    let timeout_secs = std::cmp::max(60, num_batches as u64 * 30);

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
    .map_err(|_| format!("Classification timed out after {} seconds", timeout_secs))?
    .map_err(|e| e.to_string())?;

    info!(
        "[classify_hunks_with_claude] SUCCESS: {} classifications",
        result.classifications.len()
    );
    Ok(result)
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

/// Validate that a path is within .git/compare/ for security
fn validate_compare_path(path: &str) -> Result<PathBuf, String> {
    let path_buf = PathBuf::from(path);

    // Reject paths with ".." components to prevent traversal
    if path.contains("..") {
        return Err("Path traversal detected: path contains '..'".to_string());
    }

    // The path must contain .git/compare/ to be valid
    let path_str = path.replace('\\', "/");
    if !path_str.contains("/.git/compare/") && !path_str.contains(".git/compare/") {
        return Err(
            "Security error: writes are only allowed to .git/compare/ directory".to_string(),
        );
    }

    Ok(path_buf)
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let validated_path = validate_compare_path(&path)?;
    std::fs::write(&validated_path, contents)
        .map_err(|e| format!("Failed to write file {}: {}", path, e))
}

#[tauri::command]
pub fn append_to_file(path: String, contents: String) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let validated_path = validate_compare_path(&path)?;

    if let Some(parent) = validated_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories for {}: {}", path, e))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&validated_path)
        .map_err(|e| format!("Failed to open file {}: {}", path, e))?;

    file.write_all(contents.as_bytes())
        .map_err(|e| format!("Failed to append to file {}: {}", path, e))
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
        "[get_expanded_context] file={}, lines {}-{}, comparison={:?}",
        file_path, start_line, end_line, comparison
    );

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;

    let git_ref = if comparison.working_tree {
        "HEAD".to_string()
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
    compare::trust::matches_pattern(&label, &pattern)
}

#[tauri::command]
pub fn get_trust_taxonomy() -> Vec<TrustCategory> {
    compare::trust::patterns::get_trust_taxonomy()
}

#[tauri::command]
pub fn should_skip_file(path: String) -> bool {
    compare::filters::should_skip_file(&path)
}

#[tauri::command]
pub fn get_trust_taxonomy_with_custom(repo_path: String) -> Vec<TrustCategory> {
    compare::trust::patterns::get_trust_taxonomy_with_custom(&PathBuf::from(&repo_path))
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
            .title("Compare")
            .inner_size(1100.0, 750.0)
            .min_inner_size(800.0, 600.0)
            .tabbing_identifier("compare-main")
            .background_color(tauri::window::Color(0x0c, 0x0a, 0x09, 0xff))
            .build()
            .map_err(|e: tauri::Error| e.to_string())?;

        return Ok(());
    }

    let comparison_key = comparison
        .as_ref()
        .map(|c| c.key.clone())
        .unwrap_or_else(|| "default".to_string());

    let mut hasher = DefaultHasher::new();
    format!("{}:{}", repo_path, comparison_key).hash(&mut hasher);
    let label = format!("repo-{:x}", hasher.finish());

    if let Some(existing) = app.get_webview_window(&label) {
        existing
            .set_focus()
            .map_err(|e: tauri::Error| e.to_string())?;
        return Ok(());
    }

    let repo_name = std::path::Path::new(&repo_path)
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Repository".to_string());

    let window_title = if let Some(ref c) = comparison {
        let compare_display = if c.working_tree && c.new == "HEAD" {
            "Working Tree".to_string()
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

    WebviewWindowBuilder::new(&app, label, url)
        .title(window_title)
        .inner_size(1100.0, 750.0)
        .min_inner_size(800.0, 600.0)
        .tabbing_identifier("compare-main")
        .background_color(tauri::window::Color(0x0c, 0x0a, 0x09, 0xff))
        .build()
        .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn search_file_contents(
    repo_path: String,
    query: String,
    case_sensitive: bool,
    max_results: usize,
) -> Result<Vec<SearchMatch>, String> {
    debug!(
        "[search_file_contents] repo_path={}, query={}, case_sensitive={}, max_results={}",
        repo_path, query, case_sensitive, max_results
    );

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        error!("[search_file_contents] ERROR creating source: {}", e);
        e.to_string()
    })?;

    let results = source
        .search_contents(&query, case_sensitive, max_results)
        .map_err(|e| {
            error!("[search_file_contents] ERROR searching: {}", e);
            e.to_string()
        })?;

    info!("[search_file_contents] SUCCESS: {} matches", results.len());
    Ok(results)
}

// --- Claude Code Session Detection ---

#[tauri::command]
pub fn check_claude_code_sessions(repo_path: String) -> compare::claude_code::ClaudeCodeStatus {
    compare::claude_code::check_sessions(&repo_path)
}

#[tauri::command]
pub fn list_claude_code_sessions(
    repo_path: String,
    limit: Option<usize>,
) -> Vec<compare::claude_code::SessionInfo> {
    compare::claude_code::list_sessions(&repo_path, limit.unwrap_or(20))
}

#[tauri::command]
pub fn get_claude_code_messages(
    repo_path: String,
    limit: Option<usize>,
    session_id: Option<String>,
) -> Vec<compare::claude_code::SessionMessage> {
    compare::claude_code::get_recent_messages(
        &repo_path,
        limit.unwrap_or(20),
        session_id.as_deref(),
    )
}

#[tauri::command]
pub fn get_claude_code_chain_messages(
    repo_path: String,
    session_id: String,
    limit: Option<usize>,
) -> Vec<compare::claude_code::ChainMessage> {
    compare::claude_code::get_chain_messages(&repo_path, &session_id, limit.unwrap_or(200))
}

// --- Sync Server Commands ---

use super::server::{ServerConfig, DEFAULT_PORT};
use std::sync::OnceLock;
use tokio::sync::Mutex;

/// Global sync server handle for shutdown
static SYNC_SERVER_HANDLE: OnceLock<Mutex<Option<tokio::task::JoinHandle<()>>>> = OnceLock::new();

fn get_server_handle() -> &'static Mutex<Option<tokio::task::JoinHandle<()>>> {
    SYNC_SERVER_HANDLE.get_or_init(|| Mutex::new(None))
}

#[derive(Debug, Serialize)]
pub struct SyncServerStatus {
    pub running: bool,
    pub port: u16,
    pub tailscale_ip: Option<String>,
    pub client_count: usize,
}

#[tauri::command]
pub async fn start_sync_server(
    app: tauri::AppHandle,
    port: Option<u16>,
    auth_token: String,
) -> Result<SyncServerStatus, String> {
    let port = port.unwrap_or(DEFAULT_PORT);

    // Check if already running
    if super::server::is_running() {
        return Err("Sync server is already running".to_string());
    }

    let config = ServerConfig {
        enabled: true,
        port,
        auth_token,
    };

    // Spawn the server task
    let handle = tokio::spawn(async move {
        if let Err(e) = super::server::start(config).await {
            error!("[sync_server] Server error: {}", e);
        }
    });

    // Store the handle
    let mut guard = get_server_handle().lock().await;
    *guard = Some(handle);

    // Give server a moment to start
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;

    // Register current repo if one is open
    if let Ok(repo_path) = get_current_repo() {
        info!("[sync_server] Registering current repo: {}", repo_path);
        super::server::register_repo_global(repo_path);
    }

    let tailscale_ip = get_tailscale_ip();

    info!("[sync_server] Started on port {}", port);

    // Update tray state
    super::tray::update_tray_state(&app);

    Ok(SyncServerStatus {
        running: true,
        port,
        tailscale_ip,
        client_count: 0,
    })
}

#[tauri::command]
pub async fn stop_sync_server(app: tauri::AppHandle) -> Result<(), String> {
    super::server::stop();

    // Abort the server task
    let mut guard = get_server_handle().lock().await;
    if let Some(handle) = guard.take() {
        handle.abort();
    }

    info!("[sync_server] Stopped");

    // Update tray state
    super::tray::update_tray_state(&app);

    Ok(())
}

#[tauri::command]
pub fn get_sync_server_status() -> SyncServerStatus {
    SyncServerStatus {
        running: super::server::is_running(),
        port: DEFAULT_PORT,
        tailscale_ip: get_tailscale_ip(),
        client_count: super::server::get_client_count(),
    }
}

#[tauri::command]
pub fn generate_sync_auth_token() -> String {
    super::server::generate_auth_token()
}

/// Get the Tailscale IP address if available
fn get_tailscale_ip() -> Option<String> {
    use std::process::Command;

    // Try to get Tailscale IP using the CLI
    let output = Command::new("tailscale").args(["ip", "-4"]).output().ok()?;

    if output.status.success() {
        let ip = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if ip.starts_with("100.") {
            return Some(ip);
        }
    }

    // Fallback: try to find an interface starting with 100.
    #[cfg(unix)]
    {
        let output = Command::new("ifconfig").output().ok()?;

        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            for line in text.lines() {
                if line.contains("inet ") && line.contains("100.") {
                    let parts: Vec<&str> = line.split_whitespace().collect();
                    for (i, part) in parts.iter().enumerate() {
                        if *part == "inet" {
                            if let Some(ip) = parts.get(i + 1) {
                                if ip.starts_with("100.") {
                                    return Some(ip.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}
