use crate::classify::{self, ClassifyResponse, HunkInput};
use crate::diff::parser::{detect_move_pairs, parse_diff, DiffHunk, MovePair};
use crate::review::state::ReviewState;
use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::{Comparison, DiffSource, FileEntry};
use serde::Serialize;
use std::path::PathBuf;

#[derive(Debug, Serialize)]
pub struct FileContent {
    pub content: String,
    #[serde(rename = "diffPatch")]
    pub diff_patch: String,
    pub hunks: Vec<crate::diff::parser::DiffHunk>,
}

#[tauri::command]
pub fn get_current_repo() -> Result<String, String> {
    // Check for PULLAPPROVE_REPO environment variable first
    if let Ok(repo_path) = std::env::var("PULLAPPROVE_REPO") {
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

    Err("Not a git repository. Set PULLAPPROVE_REPO environment variable.".to_string())
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

    // Validate path to prevent directory traversal attacks
    let canonical_repo = repo_path_buf
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize repo path: {}", e))?;
    let canonical_full = full_path
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize file path: {}", e))?;
    if !canonical_full.starts_with(&canonical_repo) {
        return Err("Path traversal detected: file path escapes repository".to_string());
    }

    eprintln!("[get_file_content] full_path={}", full_path.display());

    // Read the file content
    let content = std::fs::read_to_string(&full_path).map_err(|e| {
        eprintln!("[get_file_content] ERROR reading file: {}", e);
        format!("{}: {}", full_path.display(), e)
    })?;
    eprintln!(
        "[get_file_content] file content length: {} bytes",
        content.len()
    );

    // Get the diff hunks for this file if it has changes
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| {
        eprintln!("[get_file_content] ERROR creating source: {}", e);
        e.to_string()
    })?;

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

    eprintln!("[get_file_content] SUCCESS");
    Ok(FileContent {
        content,
        diff_patch: diff_output,
        hunks,
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
pub fn list_branches(repo_path: String) -> Result<Vec<String>, String> {
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    source.list_branches().map_err(|e| e.to_string())
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
    repo_path: String,
    hunks: Vec<HunkInput>,
    model: Option<String>,
) -> Result<ClassifyResponse, String> {
    use std::time::Duration;
    use tokio::time::timeout;

    let model = model.unwrap_or_else(|| "haiku".to_string());
    let max_concurrent = 5;
    // 30 seconds per hunk, with a minimum of 60 seconds
    let timeout_secs = std::cmp::max(60, hunks.len() as u64 * 30);

    eprintln!(
        "[classify_hunks_with_claude] repo_path={}, hunks={}, model={}, max_concurrent={}, timeout={}s",
        repo_path,
        hunks.len(),
        model,
        max_concurrent,
        timeout_secs
    );

    let repo_path_buf = PathBuf::from(&repo_path);

    // Run parallel classification with timeout
    let result = timeout(
        Duration::from_secs(timeout_secs),
        classify::classify_hunks_parallel(hunks, &repo_path_buf, &model, max_concurrent),
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
