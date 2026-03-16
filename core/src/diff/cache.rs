//! Disk cache for parsed hunk results.
//!
//! Caches `Vec<DiffHunk>` keyed by the SHA-256 hash of the full diff
//! output. If the diff hasn't changed, the cached hunks are returned
//! directly, skipping diff parsing entirely.

use super::parser::DiffHunk;
use crate::review::central;
use crate::sources::traits::Comparison;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::BufWriter;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

/// Bump this when the diff parsing algorithm changes to auto-invalidate
/// stale caches.
const CACHE_VERSION: u32 = 1;

#[derive(Serialize, Deserialize)]
struct HunkCache {
    #[serde(default)]
    version: u32,
    diff_hash: String,
    hunks: Vec<DiffHunk>,
}

/// Compute a SHA-256 hex hash of the given string.
pub fn compute_hash(input: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(input.as_bytes());
    hex::encode(hasher.finalize())
}

/// Sanitize a comparison key for use as a filename.
fn sanitize_key(key: &str) -> String {
    key.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_")
}

/// Return the cache file path for a given repo + comparison.
fn cache_path(repo_path: &Path, comparison: &Comparison) -> Result<PathBuf> {
    let repo_dir = central::get_repo_storage_dir(repo_path)?;
    let filename = format!("{}.json", sanitize_key(&comparison.key));
    Ok(repo_dir.join("hunk-cache").join(filename))
}

/// Load cached hunks if the diff hash matches.
///
/// Returns `Some(hunks)` on cache hit, `None` on miss or version mismatch.
pub fn load(
    repo_path: &Path,
    comparison: &Comparison,
    current_diff_hash: &str,
) -> Result<Option<Vec<DiffHunk>>> {
    let path = cache_path(repo_path, comparison)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)?;
    let cached: HunkCache = serde_json::from_str(&content)?;
    if cached.version == CACHE_VERSION && cached.diff_hash == current_diff_hash {
        Ok(Some(cached.hunks))
    } else {
        Ok(None)
    }
}

/// Borrowing variant of `HunkCache` for zero-copy serialization.
#[derive(Serialize)]
struct HunkCacheRef<'a> {
    version: u32,
    diff_hash: &'a str,
    hunks: &'a [DiffHunk],
}

/// Save parsed hunks to the cache.
pub fn save(
    repo_path: &Path,
    comparison: &Comparison,
    diff_hash: &str,
    hunks: &[DiffHunk],
) -> Result<()> {
    let path = cache_path(repo_path, comparison)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let cache = HunkCacheRef {
        version: CACHE_VERSION,
        diff_hash,
        hunks,
    };
    let file = fs::File::create(&path)?;
    serde_json::to_writer(BufWriter::new(file), &cache)?;
    Ok(())
}
