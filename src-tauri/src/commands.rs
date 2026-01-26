use crate::classify::{self, ClassifyResponse, HunkInput};
use crate::diff::parser::{detect_move_pairs, parse_diff, DiffHunk, MovePair};
use crate::review::state::{ReviewState, ReviewSummary};
use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::{Comparison, DiffSource, FileEntry, GitStatusSummary};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub content: String,
    /// Old/base version of the file content (for diff expansion)
    #[serde(rename = "oldContent")]
    pub old_content: Option<String>,
    #[serde(rename = "diffPatch")]
    pub diff_patch: String,
    pub hunks: Vec<crate::diff::parser::DiffHunk>,
    /// Content type: "text", "image", "svg", or "binary"
    #[serde(rename = "contentType")]
    pub content_type: String,
    /// Base64 data URL for image files (current/new version)
    #[serde(rename = "imageDataUrl")]
    pub image_data_url: Option<String>,
    /// Base64 data URL for the old version of the image (for diff comparison)
    #[serde(rename = "oldImageDataUrl")]
    pub old_image_data_url: Option<String>,
}

/// Image extensions and their MIME types
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

/// Check if a file is an image based on extension
fn is_image_file(file_path: &str) -> bool {
    let ext = file_path.rsplit('.').next().unwrap_or("");
    get_image_mime_type(ext).is_some()
}

/// Get the content type for a file
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

/// Convert bytes to a data URL
fn bytes_to_data_url(bytes: &[u8], mime_type: &str) -> String {
    let base64_data = BASE64.encode(bytes);
    format!("data:{};base64,{}", mime_type, base64_data)
}

#[tauri::command]
pub fn get_current_repo() -> Result<String, String> {
    // Check for COMPARE_REPO environment variable first
    if let Ok(repo_path) = std::env::var("COMPARE_REPO") {
        let path = PathBuf::from(&repo_path);
        if path.join(".git").exists() {
            return Ok(repo_path);
        }
    }

    // Get current working directory and search up for a git repo
    let cwd = std::env::current_dir().map_err(|e| e.to_string())?;

    // Search up the directory tree for a .git directory
    let mut current = cwd.as_path();
    loop {
        if current.join(".git").exists() {
            return Ok(current.to_string_lossy().to_string());
        }
        match current.parent() {
            Some(parent) => current = parent,
            None => break,
        }
    }

    // For development, try to find the repo relative to the executable
    if let Ok(exe_path) = std::env::current_exe() {
        let mut current = exe_path.as_path();
        while let Some(parent) = current.parent() {
            if parent.join(".git").exists() {
                return Ok(parent.to_string_lossy().to_string());
            }
            current = parent;
        }
    }

    Err("Not a git repository. Set COMPARE_REPO environment variable.".to_string())
}

#[tauri::command]
pub fn list_files(repo_path: String, comparison: Comparison) -> Result<Vec<FileEntry>, String> {
    eprintln!(
        "[list_files] repo_path={}, comparison={:?}",
        repo_path, comparison
    );
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        eprintln!("[list_files] ERROR creating source: {}", e);
        e.to_string()
    })?;

    let result = source.list_files(&comparison).map_err(|e| {
        eprintln!("[list_files] ERROR listing files: {}", e);
        e.to_string()
    })?;
    eprintln!("[list_files] SUCCESS: {} entries", result.len());
    Ok(result)
}

#[tauri::command]
pub fn list_all_files(repo_path: String, comparison: Comparison) -> Result<Vec<FileEntry>, String> {
    eprintln!(
        "[list_all_files] repo_path={}, comparison={:?}",
        repo_path, comparison
    );
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        eprintln!("[list_all_files] ERROR creating source: {}", e);
        e.to_string()
    })?;

    let result = source.list_all_files(&comparison).map_err(|e| {
        eprintln!("[list_all_files] ERROR listing files: {}", e);
        e.to_string()
    })?;
    eprintln!("[list_all_files] SUCCESS: {} entries", result.len());
    Ok(result)
}

#[tauri::command]
pub fn get_file_content(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
) -> Result<FileContent, String> {
    eprintln!(
        "[get_file_content] repo_path={}, file_path={}, comparison={:?}",
        repo_path, file_path, comparison
    );

    // Build the full path by joining repo_path and file_path
    let repo_path_buf = PathBuf::from(&repo_path);
    let full_path = repo_path_buf.join(&file_path);
    let file_exists = full_path.exists();

    eprintln!(
        "[get_file_content] full_path={}, exists={}",
        full_path.display(),
        file_exists
    );

    // For existing files, validate path to prevent directory traversal attacks
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
        // For deleted files, do a simpler path check (no canonicalization)
        // Ensure the file_path doesn't contain path traversal sequences
        if file_path.contains("..") {
            return Err("Path traversal detected: file path contains '..'".to_string());
        }
    }

    // Get the git source for diff
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        eprintln!("[get_file_content] ERROR creating source: {}", e);
        e.to_string()
    })?;

    // Handle deleted files - get diff from git, no current content
    if !file_exists {
        eprintln!("[get_file_content] handling deleted file");
        let diff_output = source
            .get_diff(&comparison, Some(&file_path))
            .map_err(|e| {
                eprintln!("[get_file_content] ERROR getting diff: {}", e);
                e.to_string()
            })?;

        let hunks = if diff_output.is_empty() {
            vec![]
        } else {
            parse_diff(&diff_output, &file_path)
        };

        // For deleted files in working tree comparisons, get the old content from HEAD
        let old_content = if comparison.working_tree {
            match source.get_file_bytes(&file_path, "HEAD") {
                Ok(bytes) => String::from_utf8(bytes).ok(),
                Err(_) => None,
            }
        } else {
            None // Branch comparisons use PatchDiff
        };

        return Ok(FileContent {
            content: String::new(), // No current content for deleted files
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

    // Get the git source for diff and old file content
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        eprintln!("[get_file_content] ERROR creating source: {}", e);
        e.to_string()
    })?;

    // Handle image files differently
    if content_type == "image" || content_type == "svg" {
        eprintln!("[get_file_content] handling as image/svg: {}", content_type);

        // Read current file as bytes for data URL
        let current_bytes = std::fs::read(&full_path).map_err(|e| {
            eprintln!("[get_file_content] ERROR reading file bytes: {}", e);
            format!("{}: {}", full_path.display(), e)
        })?;

        let image_data_url = mime_type.map(|mt| bytes_to_data_url(&current_bytes, mt));

        // For SVG, also include raw text content for code view
        let content = if content_type == "svg" {
            String::from_utf8_lossy(&current_bytes).to_string()
        } else {
            String::new() // Binary images have no text content
        };

        // Get the diff to determine if file has changes
        let diff_output = source
            .get_diff(&comparison, Some(&file_path))
            .map_err(|e| {
                eprintln!("[get_file_content] ERROR getting diff: {}", e);
                e.to_string()
            })?;

        // Try to get old version of the image for diff comparison
        let old_image_data_url = if !diff_output.is_empty() {
            // File has changes, try to get old version
            let old_ref = if comparison.working_tree {
                "HEAD".to_string()
            } else {
                comparison.old.clone()
            };

            match source.get_file_bytes(&file_path, &old_ref) {
                Ok(old_bytes) => {
                    eprintln!(
                        "[get_file_content] got old image bytes: {} bytes",
                        old_bytes.len()
                    );
                    mime_type.map(|mt| bytes_to_data_url(&old_bytes, mt))
                }
                Err(e) => {
                    eprintln!("[get_file_content] no old version available: {}", e);
                    None // New file, no old version
                }
            }
        } else {
            None // No changes, no need for old version
        };

        // Parse diff hunks for SVG (can show code diff) or create placeholder for images
        let hunks = if diff_output.is_empty() {
            vec![crate::diff::parser::create_untracked_hunk(&file_path)]
        } else if content_type == "svg" {
            parse_diff(&diff_output, &file_path)
        } else {
            // For binary images, create a single "image changed" hunk
            vec![crate::diff::parser::create_untracked_hunk(&file_path)]
        };

        eprintln!("[get_file_content] SUCCESS (image)");
        return Ok(FileContent {
            content,
            old_content: None, // Images don't need text old content
            diff_patch: diff_output,
            hunks,
            content_type,
            image_data_url,
            old_image_data_url,
        });
    }

    // Standard text file handling
    let content = std::fs::read_to_string(&full_path).map_err(|e| {
        eprintln!("[get_file_content] ERROR reading file: {}", e);
        format!("{}: {}", full_path.display(), e)
    })?;
    eprintln!(
        "[get_file_content] file content length: {} bytes",
        content.len()
    );

    let diff_output = source
        .get_diff(&comparison, Some(&file_path))
        .map_err(|e| {
            eprintln!("[get_file_content] ERROR getting diff: {}", e);
            e.to_string()
        })?;
    eprintln!(
        "[get_file_content] diff output length: {} bytes",
        diff_output.len()
    );

    let hunks = if diff_output.is_empty() {
        // No diff output - this is an untracked file (if it had changes, git diff would show them)
        eprintln!("[get_file_content] no diff, creating untracked hunk");
        vec![crate::diff::parser::create_untracked_hunk(&file_path)]
    } else {
        eprintln!("[get_file_content] parsing diff...");
        let parsed = parse_diff(&diff_output, &file_path);
        eprintln!("[get_file_content] parsed {} hunks", parsed.len());
        parsed
    };

    // Get old and new content for diff expansion
    let (old_content, final_content) = if !diff_output.is_empty() {
        if comparison.working_tree {
            // Working tree: old from HEAD, new from filesystem
            let old = match source.get_file_bytes(&file_path, "HEAD") {
                Ok(bytes) => {
                    eprintln!(
                        "[get_file_content] got old content from HEAD: {} bytes",
                        bytes.len()
                    );
                    String::from_utf8(bytes).ok()
                }
                Err(e) => {
                    eprintln!("[get_file_content] no old version available: {}", e);
                    None
                }
            };
            (old, content) // Use filesystem content as new
        } else {
            // Branch comparison: both from git refs
            let old = match source.get_file_bytes(&file_path, &comparison.old) {
                Ok(bytes) => {
                    eprintln!(
                        "[get_file_content] got old content from {}: {} bytes",
                        comparison.old,
                        bytes.len()
                    );
                    String::from_utf8(bytes).ok()
                }
                Err(e) => {
                    eprintln!(
                        "[get_file_content] no old version at {}: {}",
                        comparison.old, e
                    );
                    None
                }
            };
            let new = match source.get_file_bytes(&file_path, &comparison.new) {
                Ok(bytes) => {
                    eprintln!(
                        "[get_file_content] got new content from {}: {} bytes",
                        comparison.new,
                        bytes.len()
                    );
                    String::from_utf8(bytes).ok()
                }
                Err(e) => {
                    eprintln!(
                        "[get_file_content] no new version at {}: {}",
                        comparison.new, e
                    );
                    None
                }
            };
            (old, new.unwrap_or(content)) // Use git content if available, else filesystem
        }
    } else {
        (None, content) // No changes
    };

    eprintln!("[get_file_content] SUCCESS");
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
pub fn list_branches(repo_path: String) -> Result<crate::sources::traits::BranchList, String> {
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

    let model = model.unwrap_or_else(|| "haiku".to_string());
    let batch_size = batch_size.unwrap_or(5).max(1).min(20);
    let max_concurrent = max_concurrent.unwrap_or(2).max(1).min(10);

    // Calculate timeout: base of 60s + 30s per batch (not per hunk)
    let num_batches = (hunks.len() + batch_size - 1) / batch_size;
    let timeout_secs = std::cmp::max(60, num_batches as u64 * 30);

    eprintln!(
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

    // Run batched classification with timeout, emitting progress events
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
                // Emit event when a batch completes
                let _ = app.emit("classify:batch-complete", completed_ids);
            },
        ),
    )
    .await
    .map_err(|_| format!("Classification timed out after {} seconds", timeout_secs))?
    .map_err(|e| e.to_string())?;

    eprintln!(
        "[classify_hunks_with_claude] SUCCESS: {} classifications",
        result.classifications.len()
    );
    Ok(result)
}

#[derive(Debug, Serialize)]
pub struct DetectMovePairsResponse {
    pub pairs: Vec<MovePair>,
    /// Updated hunks with move_pair_id populated
    pub hunks: Vec<DiffHunk>,
}

#[tauri::command]
pub fn detect_hunks_move_pairs(mut hunks: Vec<DiffHunk>) -> DetectMovePairsResponse {
    eprintln!(
        "[detect_hunks_move_pairs] Analyzing {} hunks for moves",
        hunks.len()
    );

    let pairs = detect_move_pairs(&mut hunks);

    eprintln!("[detect_hunks_move_pairs] Found {} move pairs", pairs.len());

    DetectMovePairsResponse { pairs, hunks }
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    std::fs::write(&path, contents).map_err(|e| format!("Failed to write file {}: {}", path, e))
}

#[tauri::command]
pub fn append_to_file(path: String, contents: String) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    // Create parent directories if needed
    if let Some(parent) = std::path::Path::new(&path).parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create directories for {}: {}", path, e))?;
    }

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| format!("Failed to open file {}: {}", path, e))?;

    file.write_all(contents.as_bytes())
        .map_err(|e| format!("Failed to append to file {}: {}", path, e))
}

#[derive(Debug, Serialize)]
pub struct ExpandedContextResult {
    pub lines: Vec<String>,
    #[serde(rename = "startLine")]
    pub start_line: u32,
    #[serde(rename = "endLine")]
    pub end_line: u32,
}

#[tauri::command]
pub fn get_expanded_context(
    repo_path: String,
    file_path: String,
    comparison: Comparison,
    start_line: u32,
    end_line: u32,
) -> Result<ExpandedContextResult, String> {
    eprintln!(
        "[get_expanded_context] file={}, lines {}-{}, comparison={:?}",
        file_path, start_line, end_line, comparison
    );

    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;

    // Use the "new" ref from comparison to get the current state of the file
    // For working tree changes, use HEAD
    let git_ref = if comparison.working_tree {
        "HEAD".to_string()
    } else {
        comparison.new.clone()
    };

    let lines = source
        .get_file_lines(&file_path, &git_ref, start_line, end_line)
        .map_err(|e| e.to_string())?;

    eprintln!("[get_expanded_context] SUCCESS: {} lines", lines.len());

    Ok(ExpandedContextResult {
        lines,
        start_line,
        end_line,
    })
}
