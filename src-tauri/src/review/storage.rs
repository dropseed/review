use super::state::{ReviewState, ReviewSummary};
use crate::sources::traits::Comparison;
use std::fs;
use std::io;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

/// Get the storage directory for review state
fn get_storage_dir(repo_path: &PathBuf) -> PathBuf {
    repo_path.join(".git").join("compare").join("reviews")
}

/// Get the file path for storing the current comparison
fn get_current_comparison_path(repo_path: &PathBuf) -> PathBuf {
    repo_path.join(".git").join("compare").join("current")
}

/// Sanitize a comparison key for use as a filename
/// Replaces characters that are problematic in filenames
fn sanitize_key(key: &str) -> String {
    key.replace('/', "_")
        .replace('\\', "_")
        .replace(':', "_")
        .replace('*', "_")
        .replace('?', "_")
        .replace('"', "_")
        .replace('<', "_")
        .replace('>', "_")
        .replace('|', "_")
}

/// Generate a filename for a comparison based on its key
fn comparison_filename(comparison: &Comparison) -> String {
    format!("{}.json", sanitize_key(&comparison.key))
}

/// Load review state for a comparison
pub fn load_review_state(
    repo_path: &PathBuf,
    comparison: &Comparison,
) -> Result<ReviewState, StorageError> {
    let storage_dir = get_storage_dir(repo_path);
    let filename = comparison_filename(comparison);
    let path = storage_dir.join(&filename);

    if path.exists() {
        let content = fs::read_to_string(&path)?;
        let state: ReviewState = serde_json::from_str(&content)?;
        Ok(state)
    } else {
        // Return a new empty state
        Ok(ReviewState::new(comparison.clone()))
    }
}

/// Save review state
pub fn save_review_state(repo_path: &PathBuf, state: &ReviewState) -> Result<(), StorageError> {
    let storage_dir = get_storage_dir(repo_path);
    fs::create_dir_all(&storage_dir)?;

    let filename = comparison_filename(&state.comparison);
    let path = storage_dir.join(&filename);

    let content = serde_json::to_string_pretty(state)?;
    fs::write(&path, content)?;

    Ok(())
}

/// Get the current comparison (persisted across sessions)
pub fn get_current_comparison(repo_path: &PathBuf) -> Result<Option<Comparison>, StorageError> {
    let path = get_current_comparison_path(repo_path);

    if path.exists() {
        let content = fs::read_to_string(&path)?;
        let comparison: Comparison = serde_json::from_str(&content)?;
        Ok(Some(comparison))
    } else {
        Ok(None)
    }
}

/// Set the current comparison (persisted across sessions)
pub fn set_current_comparison(
    repo_path: &PathBuf,
    comparison: &Comparison,
) -> Result<(), StorageError> {
    let path = get_current_comparison_path(repo_path);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let content = serde_json::to_string_pretty(comparison)?;
    fs::write(&path, content)?;

    Ok(())
}

/// List all saved reviews in the repository
pub fn list_saved_reviews(repo_path: &PathBuf) -> Result<Vec<ReviewSummary>, StorageError> {
    let storage_dir = get_storage_dir(repo_path);

    if !storage_dir.exists() {
        return Ok(Vec::new());
    }

    let mut summaries = Vec::new();

    for entry in fs::read_dir(&storage_dir)? {
        let entry = entry?;
        let path = entry.path();

        // Only process .json files
        if path.extension().map_or(false, |ext| ext == "json") {
            match fs::read_to_string(&path) {
                Ok(content) => match serde_json::from_str::<ReviewState>(&content) {
                    Ok(state) => {
                        summaries.push(state.to_summary());
                    }
                    Err(e) => {
                        eprintln!(
                            "[list_saved_reviews] Failed to parse {}: {}",
                            path.display(),
                            e
                        );
                    }
                },
                Err(e) => {
                    eprintln!(
                        "[list_saved_reviews] Failed to read {}: {}",
                        path.display(),
                        e
                    );
                }
            }
        }
    }

    // Sort by updated_at descending (most recent first)
    summaries.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));

    Ok(summaries)
}

/// Delete a saved review
pub fn delete_review(repo_path: &PathBuf, comparison: &Comparison) -> Result<(), StorageError> {
    let storage_dir = get_storage_dir(repo_path);
    let filename = comparison_filename(comparison);
    let path = storage_dir.join(&filename);

    if path.exists() {
        fs::remove_file(&path)?;
    }

    Ok(())
}
