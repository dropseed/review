//! Centralized review state storage.
//!
//! Stores all review data in `~/.review/` (or `$REVIEW_HOME`) so that
//! reviews from every repository are accessible system-wide.
//!
//! Layout:
//! ```text
//! ~/.review/
//!   index.json                        # repo_id -> { path, name, last_accessed }
//!   repos/
//!     <16-char-hex-hash>/
//!       repo.json                     # { canonical_path, display_name }
//!       reviews/
//!         <comparison-key>.json       # ReviewState
//!       current                       # Current comparison JSON
//!       custom-patterns.json          # Repo-specific trust overrides
//! ```

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CentralError {
    #[error("IO error: {0}")]
    Io(#[from] io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Could not determine home directory")]
    Home,
}

/// A single entry in the repo index.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RepoIndexEntry {
    pub repo_id: String,
    pub path: String,
    pub name: String,
    pub last_accessed: String,
}

/// The full repo index stored at `~/.review/index.json`.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RepoIndex {
    pub repos: HashMap<String, RepoIndexEntry>,
}

/// Return the central storage root.
///
/// Uses `$REVIEW_HOME` if set, otherwise `~/.review/`.
pub fn get_central_root() -> Result<PathBuf, CentralError> {
    if let Ok(review_home) = std::env::var("REVIEW_HOME") {
        return Ok(PathBuf::from(review_home));
    }
    let home = dirs::home_dir().ok_or(CentralError::Home)?;
    Ok(home.join(".review"))
}

/// Resolve the canonical path, falling back to the original if canonicalization fails.
fn canonical_path(repo_path: &Path) -> PathBuf {
    repo_path
        .canonicalize()
        .unwrap_or_else(|_| repo_path.to_path_buf())
}

/// Compute a 16-character hex repo ID from the canonical path.
pub fn compute_repo_id(repo_path: &Path) -> Result<String, CentralError> {
    let canonical = canonical_path(repo_path);
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    let result = hasher.finalize();
    Ok(hex::encode(&result[..8])) // 8 bytes = 16 hex chars
}

/// Get the storage directory for a specific repo.
pub fn get_repo_storage_dir(repo_path: &Path) -> Result<PathBuf, CentralError> {
    let root = get_central_root()?;
    let repo_id = compute_repo_id(repo_path)?;
    Ok(root.join("repos").join(repo_id))
}

/// Load the global repo index.
pub fn load_index() -> Result<RepoIndex, CentralError> {
    let root = get_central_root()?;
    let index_path = root.join("index.json");
    if !index_path.exists() {
        return Ok(RepoIndex::default());
    }
    let content = fs::read_to_string(&index_path)?;
    let index: RepoIndex = serde_json::from_str(&content)?;
    Ok(index)
}

/// Save the global repo index (atomic: write tmp + rename).
pub fn save_index(index: &RepoIndex) -> Result<(), CentralError> {
    let root = get_central_root()?;
    fs::create_dir_all(&root)?;

    let index_path = root.join("index.json");
    let tmp_path = root.join("index.json.tmp");
    let content = serde_json::to_string_pretty(index)?;
    fs::write(&tmp_path, &content)?;
    fs::rename(&tmp_path, &index_path)?;
    Ok(())
}

/// Register (upsert) a repo in the index and create its storage directory.
pub fn register_repo(repo_path: &Path) -> Result<(), CentralError> {
    let repo_id = compute_repo_id(repo_path)?;
    let repo_dir = get_repo_storage_dir(repo_path)?;
    fs::create_dir_all(repo_dir.join("reviews"))?;

    let canonical = canonical_path(repo_path);
    let canonical_str = canonical.to_string_lossy().to_string();
    let display_name = canonical
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "unknown".to_string());

    // Write repo.json
    let repo_json = serde_json::json!({
        "canonical_path": canonical_str,
        "display_name": display_name,
    });
    fs::write(
        repo_dir.join("repo.json"),
        serde_json::to_string_pretty(&repo_json)?,
    )?;

    // Update the index
    let mut index = load_index()?;
    index.repos.insert(
        repo_id.clone(),
        RepoIndexEntry {
            repo_id,
            path: canonical_str,
            name: display_name,
            last_accessed: now_iso8601(),
        },
    );
    save_index(&index)?;
    Ok(())
}

/// List all registered repos from the index.
pub fn list_registered_repos() -> Result<Vec<RepoIndexEntry>, CentralError> {
    let index = load_index()?;
    let mut repos: Vec<RepoIndexEntry> = index.repos.into_values().collect();
    repos.sort_by(|a, b| b.last_accessed.cmp(&a.last_accessed));
    Ok(repos)
}

/// Remove a repo from the index and delete its storage directory.
pub fn unregister_repo(repo_id: &str) -> Result<(), CentralError> {
    let root = get_central_root()?;
    let repo_dir = root.join("repos").join(repo_id);
    if repo_dir.exists() {
        fs::remove_dir_all(&repo_dir)?;
    }

    let mut index = load_index()?;
    index.repos.remove(repo_id);
    save_index(&index)?;
    Ok(())
}

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

fn now_iso8601() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();

    let days = secs / 86400;
    let remaining = secs % 86400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;

    let mut year = 1970i32;
    let mut remaining_days = days as i32;
    loop {
        let days_in_year = if is_leap_year(year) { 366 } else { 365 };
        if remaining_days < days_in_year {
            break;
        }
        remaining_days -= days_in_year;
        year += 1;
    }

    let days_in_months: [i32; 12] = if is_leap_year(year) {
        [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    } else {
        [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
    };

    let mut month = 1;
    for days_in_month in &days_in_months {
        if remaining_days < *days_in_month {
            break;
        }
        remaining_days -= *days_in_month;
        month += 1;
    }
    let day = remaining_days + 1;

    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}.{millis:03}Z")
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::sync::Mutex;
    use tempfile::TempDir;

    /// Mutex to serialize tests that modify REVIEW_HOME env var.
    /// Also used by storage::tests.
    pub static ENV_LOCK: Mutex<()> = Mutex::new(());

    /// Create a REVIEW_HOME temp dir and a fake repo temp dir.
    /// Returns (review_home, repo_dir) — both TempDirs kept alive.
    /// Caller MUST hold ENV_LOCK.
    fn setup_test() -> (TempDir, TempDir) {
        let review_home = TempDir::new().unwrap();
        std::env::set_var("REVIEW_HOME", review_home.path());
        let repo_dir = TempDir::new().unwrap();
        (review_home, repo_dir)
    }

    #[test]
    fn test_compute_repo_id_is_deterministic() {
        let tmp = TempDir::new().unwrap();
        let id1 = compute_repo_id(tmp.path()).unwrap();
        let id2 = compute_repo_id(tmp.path()).unwrap();
        assert_eq!(id1, id2);
        assert_eq!(id1.len(), 16);
    }

    #[test]
    fn test_get_central_root_with_env() {
        let _lock = ENV_LOCK.lock().unwrap();
        std::env::set_var("REVIEW_HOME", "/tmp/test-review");
        let root = get_central_root().unwrap();
        assert_eq!(root, PathBuf::from("/tmp/test-review"));
        std::env::remove_var("REVIEW_HOME");
    }

    #[test]
    fn test_register_and_list_repos() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_review_home, repo_dir) = setup_test();
        register_repo(repo_dir.path()).unwrap();

        let repos = list_registered_repos().unwrap();
        assert_eq!(repos.len(), 1);
    }

    #[test]
    fn test_unregister_repo() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_review_home, repo_dir) = setup_test();
        register_repo(repo_dir.path()).unwrap();

        let repos = list_registered_repos().unwrap();
        assert_eq!(repos.len(), 1);

        let repo_id = compute_repo_id(repo_dir.path()).unwrap();
        unregister_repo(&repo_id).unwrap();

        let repos = list_registered_repos().unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_empty_index() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_review_home, _repo_dir) = setup_test();
        let repos = list_registered_repos().unwrap();
        assert!(repos.is_empty());
    }

    #[test]
    fn test_repo_storage_dir_structure() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_review_home, repo_dir) = setup_test();
        register_repo(repo_dir.path()).unwrap();

        let storage_dir = get_repo_storage_dir(repo_dir.path()).unwrap();
        let central_root = get_central_root().unwrap();
        assert!(storage_dir.starts_with(&central_root));
        assert!(storage_dir.join("reviews").exists());
        assert!(storage_dir.join("repo.json").exists());
    }
}
