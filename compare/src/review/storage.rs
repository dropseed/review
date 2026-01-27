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
    #[error("Version conflict: expected version {expected}, found {found}. Another process modified the file.")]
    VersionConflict { expected: u64, found: u64 },
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

/// Save review state with optimistic concurrency control.
///
/// This function checks that the file hasn't been modified by another process
/// since the state was loaded. If the version on disk is different from the
/// expected version (state.version - 1), a VersionConflict error is returned.
///
/// Call `state.prepare_for_save()` before saving to increment the version.
pub fn save_review_state(repo_path: &PathBuf, state: &ReviewState) -> Result<(), StorageError> {
    let storage_dir = get_storage_dir(repo_path);
    fs::create_dir_all(&storage_dir)?;

    let filename = comparison_filename(&state.comparison);
    let path = storage_dir.join(&filename);

    // Check for version conflict if the file exists
    if path.exists() {
        let existing_content = fs::read_to_string(&path)?;
        if let Ok(existing_state) = serde_json::from_str::<ReviewState>(&existing_content) {
            // If state.version is 0, this is a new save (no conflict check needed)
            // Otherwise, the expected on-disk version is state.version - 1
            if state.version > 0 {
                let expected_disk_version = state.version - 1;
                if existing_state.version != expected_disk_version {
                    return Err(StorageError::VersionConflict {
                        expected: expected_disk_version,
                        found: existing_state.version,
                    });
                }
            }
        }
    }

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::state::HunkState;
    use tempfile::TempDir;

    fn create_test_comparison() -> Comparison {
        Comparison {
            old: "main".to_string(),
            new: "HEAD".to_string(),
            working_tree: true,
            staged_only: false,
            key: "main..HEAD+working-tree".to_string(),
        }
    }

    fn create_test_repo() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        // Create .git directory to simulate a git repo
        fs::create_dir(temp_dir.path().join(".git")).unwrap();
        temp_dir
    }

    #[test]
    fn test_sanitize_key() {
        assert_eq!(sanitize_key("main..HEAD"), "main..HEAD");
        assert_eq!(sanitize_key("origin/main..HEAD"), "origin_main..HEAD");
        assert_eq!(
            sanitize_key("main..HEAD+working-tree"),
            "main..HEAD+working-tree"
        );
        assert_eq!(sanitize_key("a:b*c?d"), "a_b_c_d");
    }

    #[test]
    fn test_comparison_filename() {
        let comparison = create_test_comparison();
        let filename = comparison_filename(&comparison);
        assert_eq!(filename, "main..HEAD+working-tree.json");
    }

    #[test]
    fn test_load_review_state_creates_new_if_not_exists() {
        let temp_dir = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        let state = load_review_state(&repo_path, &comparison).unwrap();

        assert_eq!(state.comparison.key, comparison.key);
        assert!(state.hunks.is_empty());
    }

    #[test]
    fn test_save_and_load_review_state_roundtrip() {
        let temp_dir = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        // Create a state with some data
        let mut state = ReviewState::new(comparison.clone());
        state.notes = "Test notes".to_string();
        state.trust_list = vec!["imports:*".to_string(), "formatting:*".to_string()];
        state.hunks.insert(
            "file.rs:abc123".to_string(),
            HunkState {
                label: vec!["imports:added".to_string()],
                reasoning: Some("Added import".to_string()),
                status: None,
            },
        );

        // Save the state
        save_review_state(&repo_path, &state).unwrap();

        // Load it back
        let loaded_state = load_review_state(&repo_path, &comparison).unwrap();

        assert_eq!(loaded_state.notes, "Test notes");
        assert_eq!(loaded_state.trust_list.len(), 2);
        assert!(loaded_state.hunks.contains_key("file.rs:abc123"));
        let hunk = loaded_state.hunks.get("file.rs:abc123").unwrap();
        assert_eq!(hunk.label, vec!["imports:added".to_string()]);
        assert_eq!(hunk.reasoning, Some("Added import".to_string()));
    }

    #[test]
    fn test_list_saved_reviews_empty() {
        let temp_dir = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();

        let reviews = list_saved_reviews(&repo_path).unwrap();
        assert!(reviews.is_empty());
    }

    #[test]
    fn test_list_saved_reviews_with_reviews() {
        let temp_dir = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();

        // Create and save two reviews
        let comparison1 = Comparison {
            old: "main".to_string(),
            new: "feature-1".to_string(),
            working_tree: false,
            staged_only: false,
            key: "main..feature-1".to_string(),
        };
        let comparison2 = Comparison {
            old: "main".to_string(),
            new: "feature-2".to_string(),
            working_tree: false,
            staged_only: false,
            key: "main..feature-2".to_string(),
        };

        save_review_state(&repo_path, &ReviewState::new(comparison1)).unwrap();
        save_review_state(&repo_path, &ReviewState::new(comparison2)).unwrap();

        let reviews = list_saved_reviews(&repo_path).unwrap();
        assert_eq!(reviews.len(), 2);
    }

    #[test]
    fn test_delete_review() {
        let temp_dir = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        // Save a review
        save_review_state(&repo_path, &ReviewState::new(comparison.clone())).unwrap();

        // Verify it exists
        let reviews = list_saved_reviews(&repo_path).unwrap();
        assert_eq!(reviews.len(), 1);

        // Delete it
        delete_review(&repo_path, &comparison).unwrap();

        // Verify it's gone
        let reviews = list_saved_reviews(&repo_path).unwrap();
        assert!(reviews.is_empty());
    }

    #[test]
    fn test_delete_review_nonexistent() {
        let temp_dir = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        // Should not error when deleting non-existent review
        let result = delete_review(&repo_path, &comparison);
        assert!(result.is_ok());
    }

    #[test]
    fn test_current_comparison_roundtrip() {
        let temp_dir = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        // Initially no current comparison
        let current = get_current_comparison(&repo_path).unwrap();
        assert!(current.is_none());

        // Set current comparison
        set_current_comparison(&repo_path, &comparison).unwrap();

        // Get it back
        let current = get_current_comparison(&repo_path).unwrap();
        assert!(current.is_some());
        assert_eq!(current.unwrap().key, comparison.key);
    }
}
