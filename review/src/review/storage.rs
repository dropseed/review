use super::central;
use super::state::{ReviewState, ReviewSummary};
use crate::sources::github::GitHubPrRef;
use crate::sources::traits::Comparison;
use serde::Serialize;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum StorageError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Version conflict: expected version {expected}, found {found}. Another process modified the file.")]
    VersionConflict { expected: u64, found: u64 },
    #[error("Central storage error: {0}")]
    Central(#[from] central::CentralError),
}

/// Get the storage directory for review state (centralized).
fn get_storage_dir(repo_path: &Path) -> Result<PathBuf, StorageError> {
    Ok(central::get_repo_storage_dir(repo_path)?.join("reviews"))
}

/// A review summary tagged with repo information (for cross-repo listing).
#[derive(Debug, Clone, Serialize)]
pub struct GlobalReviewSummary {
    #[serde(flatten)]
    pub summary: ReviewSummary,
    #[serde(rename = "repoPath")]
    pub repo_path: String,
    #[serde(rename = "repoName")]
    pub repo_name: String,
}

/// List all reviews across all registered repos.
pub fn list_all_reviews_global() -> Result<Vec<GlobalReviewSummary>, StorageError> {
    let repos = central::list_registered_repos()?;
    let mut all = Vec::new();

    for entry in repos {
        let repo_path = PathBuf::from(&entry.path);
        // Skip repos whose paths no longer exist
        if !repo_path.exists() {
            continue;
        }
        match list_saved_reviews(&repo_path) {
            Ok(summaries) => {
                for summary in summaries {
                    all.push(GlobalReviewSummary {
                        summary,
                        repo_path: entry.path.clone(),
                        repo_name: entry.name.clone(),
                    });
                }
            }
            Err(e) => {
                eprintln!(
                    "[list_all_reviews_global] Error listing reviews for {}: {}",
                    entry.path, e
                );
            }
        }
    }

    // Sort by updated_at descending (most recent first)
    all.sort_by(|a, b| b.summary.updated_at.cmp(&a.summary.updated_at));
    Ok(all)
}

/// Sanitize a comparison key for use as a filename
/// Replaces characters that are problematic in filenames
fn sanitize_key(key: &str) -> String {
    key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
}

/// Generate a filename for a comparison based on its key
fn comparison_filename(comparison: &Comparison) -> String {
    format!("{}.json", sanitize_key(&comparison.key))
}

/// Load review state for a comparison
pub fn load_review_state(
    repo_path: &Path,
    comparison: &Comparison,
) -> Result<ReviewState, StorageError> {
    let storage_dir = get_storage_dir(repo_path)?;
    let filename = comparison_filename(comparison);
    let path = storage_dir.join(&filename);

    if path.exists() {
        let content = fs::read_to_string(&path)?;
        let state: ReviewState = serde_json::from_str(&content)?;
        Ok(state)
    } else {
        // Return a new empty state (not persisted — call ensure_review_exists for that)
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
pub fn save_review_state(repo_path: &Path, state: &ReviewState) -> Result<(), StorageError> {
    // Register repo in central index on first save
    central::register_repo(repo_path)?;

    let storage_dir = get_storage_dir(repo_path)?;
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

/// List all saved reviews in the repository
pub fn list_saved_reviews(repo_path: &Path) -> Result<Vec<ReviewSummary>, StorageError> {
    let storage_dir = get_storage_dir(repo_path)?;

    if !storage_dir.exists() {
        return Ok(Vec::new());
    }

    let mut summaries = Vec::new();

    for entry in fs::read_dir(&storage_dir)? {
        let entry = entry?;
        let path = entry.path();

        // Only process .json files
        if path.extension().is_some_and(|ext| ext == "json") {
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

/// Create a review file on disk if it doesn't already exist.
/// Used to make new reviews immediately visible in the sidebar.
pub fn ensure_review_exists(
    repo_path: &Path,
    comparison: &Comparison,
    github_pr: Option<GitHubPrRef>,
) -> Result<(), StorageError> {
    let storage_dir = get_storage_dir(repo_path)?;
    let filename = comparison_filename(comparison);
    let path = storage_dir.join(&filename);

    if !path.exists() {
        let mut state = ReviewState::new(comparison.clone());
        state.github_pr = github_pr;
        save_review_state(repo_path, &state)?;
    }

    Ok(())
}

/// Delete a saved review
pub fn delete_review(repo_path: &Path, comparison: &Comparison) -> Result<(), StorageError> {
    let storage_dir = get_storage_dir(repo_path)?;
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
    use crate::review::central::tests::ENV_LOCK;
    use crate::review::state::HunkState;
    use tempfile::TempDir;

    fn create_test_comparison() -> Comparison {
        Comparison::new("main", "HEAD")
    }

    /// Create a test repo and set REVIEW_HOME to a temp dir.
    /// Returns (repo_dir, review_home_dir) — both TempDirs kept alive.
    fn create_test_repo() -> (TempDir, TempDir) {
        let temp_dir = TempDir::new().unwrap();
        // Create .git directory to simulate a git repo
        fs::create_dir(temp_dir.path().join(".git")).unwrap();

        let review_home = TempDir::new().unwrap();
        std::env::set_var("REVIEW_HOME", review_home.path());

        (temp_dir, review_home)
    }

    #[test]
    fn test_sanitize_key() {
        assert_eq!(sanitize_key("main..HEAD"), "main..HEAD");
        assert_eq!(sanitize_key("origin/main..HEAD"), "origin_main..HEAD");
        assert_eq!(sanitize_key("main..HEAD"), "main..HEAD");
        assert_eq!(sanitize_key("a:b*c?d"), "a_b_c_d");
    }

    #[test]
    fn test_comparison_filename() {
        let comparison = create_test_comparison();
        let filename = comparison_filename(&comparison);
        assert_eq!(filename, "main..HEAD.json");
    }

    #[test]
    fn test_load_review_state_creates_new_if_not_exists() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        let state = load_review_state(&repo_path, &comparison).unwrap();

        assert_eq!(state.comparison.key, comparison.key);
        assert!(state.hunks.is_empty());
    }

    #[test]
    fn test_save_and_load_review_state_roundtrip() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
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
                classified_via: None,
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
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();

        let reviews = list_saved_reviews(&repo_path).unwrap();
        assert!(reviews.is_empty());
    }

    #[test]
    fn test_list_saved_reviews_with_reviews() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();

        // Create and save two reviews
        let comparison1 = Comparison::new("main", "feature-1");
        let comparison2 = Comparison::new("main", "feature-2");

        save_review_state(&repo_path, &ReviewState::new(comparison1)).unwrap();
        save_review_state(&repo_path, &ReviewState::new(comparison2)).unwrap();

        let reviews = list_saved_reviews(&repo_path).unwrap();
        assert_eq!(reviews.len(), 2);
    }

    #[test]
    fn test_delete_review() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
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
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        // Should not error when deleting non-existent review
        let result = delete_review(&repo_path, &comparison);
        assert!(result.is_ok());
    }
}
