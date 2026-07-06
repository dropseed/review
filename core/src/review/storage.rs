use super::central;
use super::migrate;
use super::state::{ReviewState, ReviewSummary};
use crate::sources::github::GitHubPrRef;
use crate::sources::local_git::DiffShortStat;
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
    #[error("Schema migration error: {0}")]
    Migrate(#[from] migrate::MigrateError),
    #[error("Version conflict: expected version {expected}, found {found}. Another process modified the file.")]
    VersionConflict { expected: u64, found: u64 },
    #[error("Central storage error: {0}")]
    Central(#[from] central::CentralError),
}

/// Parse review JSON, migrating it forward to the current schema first.
///
/// All review reads funnel through here so a stored file is never deserialized
/// against the typed struct without going through migration — that is what
/// turns a breaking format change into a migration instead of silent data loss.
fn deserialize_review(content: &str) -> Result<ReviewState, StorageError> {
    let raw: serde_json::Value = serde_json::from_str(content)?;
    let migrated = migrate::migrate(raw)?;
    Ok(serde_json::from_value(migrated)?)
}

/// Build a placeholder summary for an unreadable review file, recovering the
/// comparison from the filename and the timestamp from the file's mtime.
fn unreadable_summary(path: &Path) -> ReviewSummary {
    // Inverts `comparison_filename`: the stem is the sanitized "base..head" key.
    let stem = path
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("unknown");
    let comparison = match stem.split_once("..") {
        Some((base, head)) => Comparison::new(base, head),
        None => Comparison::new("", stem),
    };
    let updated_at = fs::metadata(path)
        .and_then(|m| m.modified())
        .map(super::state::iso8601_from_system_time)
        .unwrap_or_default();
    ReviewSummary::unreadable(comparison, updated_at)
}

/// Get the storage directory for review state (centralized).
fn get_storage_dir(repo_path: &Path) -> Result<PathBuf, StorageError> {
    Ok(central::get_repo_storage_dir(repo_path)?.join("reviews"))
}

/// Path to the repo's stored default-comparison marker (`review use`).
fn default_spec_path(repo_path: &Path) -> Result<PathBuf, StorageError> {
    Ok(central::get_repo_storage_dir(repo_path)?.join("default-spec"))
}

/// The repo's stored default comparison spec, if `review use` set one. A blank
/// or missing file (or any read error) reads as "no default".
pub fn read_default_spec(repo_path: &Path) -> Option<String> {
    let path = default_spec_path(repo_path).ok()?;
    let content = fs::read_to_string(path).ok()?;
    let trimmed = content.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_owned())
    }
}

/// Persist the repo's default comparison spec (`review use <spec>`). The raw
/// spec string is stored and re-resolved on each use, so it stays valid as
/// branches move.
pub fn write_default_spec(repo_path: &Path, spec: &str) -> Result<(), StorageError> {
    let path = default_spec_path(repo_path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, spec.trim())?;
    Ok(())
}

/// Clear the repo's stored default comparison. Returns whether a default existed.
pub fn clear_default_spec(repo_path: &Path) -> Result<bool, StorageError> {
    let path = default_spec_path(repo_path)?;
    match fs::remove_file(&path) {
        Ok(()) => Ok(true),
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(e) => Err(e.into()),
    }
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
    #[serde(rename = "diffStats")]
    pub diff_stats: Option<DiffShortStat>,
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

        // Diff stats are intentionally NOT computed here: each shortstat fans
        // out to ~5 git subprocesses, and this fn iterates *every* saved review
        // across *every* registered repo, so populating stats inline scaled to
        // dozens of git spawns per call. Stats are filled in by the freshness
        // flow (`service::freshness::check_reviews_freshness`), which has
        // SHA-cache short-circuiting and runs reviews in parallel.
        match list_saved_reviews(&repo_path) {
            Ok(summaries) => {
                for summary in summaries {
                    all.push(GlobalReviewSummary {
                        summary,
                        repo_path: entry.path.clone(),
                        repo_name: entry.name.clone(),
                        diff_stats: None,
                    });
                }
            }
            Err(e) => {
                log::warn!(
                    "[list_all_reviews_global] Error listing reviews for {}: {}",
                    entry.path,
                    e
                );
            }
        }
    }

    // Sort by updated_at descending (most recent first)
    all.sort_by(|a, b| b.summary.updated_at.cmp(&a.summary.updated_at));
    Ok(all)
}

/// Generate a filename for a comparison based on its key
fn comparison_filename(comparison: &Comparison) -> String {
    format!("{}.json", central::sanitize_path_component(&comparison.key))
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
        let state = deserialize_review(&content)?;
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

    // Check for version conflict if the file exists.
    if path.exists() {
        let existing_content = fs::read_to_string(&path)?;
        // An existing file we can't read is a hard conflict, never silently
        // overwritten: it may be a newer schema or genuinely corrupt, and
        // clobbering it would be the data loss the loud-load path prevents.
        let existing_state = deserialize_review(&existing_content)?;
        // version 0 means a fresh save (no conflict check needed); otherwise the
        // expected on-disk version is state.version - 1.
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
                Ok(content) => match deserialize_review(&content) {
                    Ok(state) => {
                        summaries.push(state.to_summary());
                    }
                    Err(e) => {
                        // Don't silently drop an unreadable review — that is the
                        // failure mode this whole effort is undoing. Log loudly
                        // and surface a placeholder so it stays visible; opening
                        // it still fails loudly via `load_review_state`.
                        log::error!(
                            "[list_saved_reviews] Unreadable review {}: {e}",
                            path.display()
                        );
                        summaries.push(unreadable_summary(&path));
                    }
                },
                Err(e) => {
                    log::error!(
                        "[list_saved_reviews] Failed to read {}: {e}",
                        path.display()
                    );
                    summaries.push(unreadable_summary(&path));
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

/// Check whether a review file exists on disk for the given comparison.
pub fn review_exists(repo_path: &Path, comparison: &Comparison) -> Result<bool, StorageError> {
    let storage_dir = get_storage_dir(repo_path)?;
    let filename = comparison_filename(comparison);
    Ok(storage_dir.join(&filename).exists())
}

/// Change the base ref of an existing review, atomically renaming the file.
///
/// Loads the review for `old_comparison`, creates a new comparison with `new_base`
/// and the same head, saves under the new filename, and deletes the old file.
/// Returns the new comparison.
pub fn change_review_base(
    repo_path: &Path,
    old_comparison: &Comparison,
    new_base: &str,
) -> Result<Comparison, StorageError> {
    let new_comparison = Comparison::new(new_base, &old_comparison.head);

    // Don't allow no-op
    if new_comparison.key == old_comparison.key {
        return Ok(new_comparison);
    }

    // Check target doesn't already exist
    if review_exists(repo_path, &new_comparison)? {
        return Err(StorageError::Io(io::Error::new(
            io::ErrorKind::AlreadyExists,
            format!("A review for {} already exists", new_comparison.key),
        )));
    }

    // Load existing state
    let storage_dir = get_storage_dir(repo_path)?;
    let old_filename = comparison_filename(old_comparison);
    let old_path = storage_dir.join(&old_filename);

    let mut state = if old_path.exists() {
        let content = fs::read_to_string(&old_path)?;
        deserialize_review(&content)?
    } else {
        ReviewState::new(old_comparison.clone())
    };

    // Update comparison in state
    state.comparison = new_comparison.clone();
    state.version = 0; // Fresh save, no conflict check
    state.updated_at = super::state::now_iso8601();

    // Update GitHub PR base if present
    if let Some(ref mut pr) = state.github_pr {
        pr.base_ref_name = new_base.to_string();
    }

    // Save under new filename
    save_review_state(repo_path, &state)?;

    // Delete old file
    if old_path.exists() {
        fs::remove_file(&old_path)?;
    }

    Ok(new_comparison)
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
    use crate::review::state::{
        AnnotationSide, Attributed, HunkState, LineAnnotation, Source, REVIEW_SCHEMA_VERSION,
    };
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
                classification: Some(Attributed {
                    value: vec!["imports:added".to_string()],
                    source: Source::Static,
                    reasoning: Some("Added import".to_string()),
                }),
                ..Default::default()
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
        assert_eq!(hunk.labels(), &["imports:added".to_string()]);
        let classification = hunk.classification.as_ref().unwrap();
        assert_eq!(classification.reasoning, Some("Added import".to_string()));
    }

    #[test]
    fn test_annotation_fields_roundtrip() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        let mut state = ReviewState::new(comparison.clone());
        // A fully-populated, resolved annotation.
        state.annotations.push(LineAnnotation {
            id: "file.rs:42:new:t123-0".to_string(),
            file_path: "file.rs".to_string(),
            line_number: 42,
            end_line_number: Some(45),
            side: AnnotationSide::New,
            content: "needs work".to_string(),
            created_at: "2026-01-01T00:00:00.000Z".to_string(),
            author: Some("claude".to_string()),
            source: Some(Source::Agent),
            updated_at: Some("2026-01-02T00:00:00.000Z".to_string()),
            resolved_at: Some("2026-01-03T00:00:00.000Z".to_string()),
            resolved_by: Some("Dave".to_string()),
        });
        // A legacy annotation: no author/source/updated/resolved fields.
        state.annotations.push(LineAnnotation {
            id: "file.rs:7:old:legacy".to_string(),
            file_path: "file.rs".to_string(),
            line_number: 7,
            end_line_number: None,
            side: AnnotationSide::Old,
            content: "old comment".to_string(),
            created_at: "2025-01-01T00:00:00.000Z".to_string(),
            author: None,
            source: None,
            updated_at: None,
            resolved_at: None,
            resolved_by: None,
        });

        save_review_state(&repo_path, &state).unwrap();
        let loaded = load_review_state(&repo_path, &comparison).unwrap();

        assert_eq!(loaded.annotations.len(), 2);

        let full = &loaded.annotations[0];
        assert_eq!(full.author.as_deref(), Some("claude"));
        assert!(matches!(full.source, Some(Source::Agent)));
        assert_eq!(full.end_line_number, Some(45));
        assert_eq!(full.updated_at.as_deref(), Some("2026-01-02T00:00:00.000Z"));
        assert_eq!(
            full.resolved_at.as_deref(),
            Some("2026-01-03T00:00:00.000Z")
        );
        assert_eq!(full.resolved_by.as_deref(), Some("Dave"));

        let legacy = &loaded.annotations[1];
        assert_eq!(legacy.author, None);
        assert!(legacy.source.is_none());
        assert_eq!(legacy.updated_at, None);
        assert_eq!(legacy.resolved_at, None);
        assert_eq!(legacy.resolved_by, None);
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
    fn test_review_exists() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        // Should not exist initially
        assert!(!review_exists(&repo_path, &comparison).unwrap());

        // Save a review
        save_review_state(&repo_path, &ReviewState::new(comparison.clone())).unwrap();

        // Should exist now
        assert!(review_exists(&repo_path, &comparison).unwrap());

        // Delete it
        delete_review(&repo_path, &comparison).unwrap();

        // Should not exist again
        assert!(!review_exists(&repo_path, &comparison).unwrap());
    }

    #[test]
    fn test_schema_version_roundtrip() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        save_review_state(&repo_path, &ReviewState::new(comparison.clone())).unwrap();
        let loaded = load_review_state(&repo_path, &comparison).unwrap();
        assert_eq!(loaded.schema_version, REVIEW_SCHEMA_VERSION);
    }

    #[test]
    fn test_load_rejects_newer_schema() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        central::register_repo(&repo_path).unwrap();
        let dir = get_storage_dir(&repo_path).unwrap();
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(comparison_filename(&comparison));
        // A review claiming a schema this build can't understand must fail
        // loudly, never load as empty (which would invite an overwrite).
        fs::write(
            &path,
            r#"{"schemaVersion":9999,"comparison":{"base":"main","head":"HEAD","key":"main..HEAD"},"hunks":{},"trustList":[],"notes":"","createdAt":"x","updatedAt":"x","version":1}"#,
        )
        .unwrap();

        let err = load_review_state(&repo_path, &comparison).unwrap_err();
        assert!(matches!(err, StorageError::Migrate(_)));
    }

    #[test]
    fn test_save_refuses_to_overwrite_unreadable_file() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();
        let comparison = create_test_comparison();

        central::register_repo(&repo_path).unwrap();
        let dir = get_storage_dir(&repo_path).unwrap();
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(comparison_filename(&comparison));
        // A too-new file already on disk must not be clobbered by a save.
        fs::write(
            &path,
            r#"{"schemaVersion":9999,"comparison":{"base":"main","head":"HEAD","key":"main..HEAD"},"hunks":{},"trustList":[],"notes":"","createdAt":"x","updatedAt":"x","version":1}"#,
        )
        .unwrap();

        let mut state = ReviewState::new(comparison.clone());
        state.version = 1; // not a fresh save
        let err = save_review_state(&repo_path, &state).unwrap_err();
        assert!(matches!(err, StorageError::Migrate(_)));
    }

    #[test]
    fn test_list_surfaces_unreadable_review() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (temp_dir, _review_home) = create_test_repo();
        let repo_path = temp_dir.path().to_path_buf();

        central::register_repo(&repo_path).unwrap();
        let dir = get_storage_dir(&repo_path).unwrap();
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("main..broken.json"), "{ not valid json").unwrap();

        let reviews = list_saved_reviews(&repo_path).unwrap();
        assert_eq!(reviews.len(), 1);
        assert!(reviews[0].unreadable);
        assert_eq!(reviews[0].comparison.key, "main..broken");
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
