//! Disk cache for symbol diff results.
//!
//! Caches `Vec<FileSymbolDiff>` keyed by the SHA-256 hash of the full diff
//! output. If the diff hasn't changed, the cached results are returned
//! directly, skipping tree-sitter parsing and symbol diffing.

use super::FileSymbolDiff;
use crate::review::central;
use crate::sources::traits::Comparison;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::{Path, PathBuf};

type Result<T> = std::result::Result<T, Box<dyn std::error::Error>>;

#[derive(Serialize, Deserialize)]
struct SymbolDiffCache {
    diff_hash: String,
    symbol_diffs: Vec<FileSymbolDiff>,
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
    Ok(repo_dir.join("symbol-cache").join(filename))
}

/// Load cached symbol diffs if the diff hash matches.
///
/// Returns `Some(results)` on cache hit, `None` on miss or any error.
pub fn load(
    repo_path: &Path,
    comparison: &Comparison,
    current_diff_hash: &str,
) -> Result<Option<Vec<FileSymbolDiff>>> {
    let path = cache_path(repo_path, comparison)?;
    if !path.exists() {
        return Ok(None);
    }
    let content = fs::read_to_string(&path)?;
    let cached: SymbolDiffCache = serde_json::from_str(&content)?;
    if cached.diff_hash == current_diff_hash {
        Ok(Some(cached.symbol_diffs))
    } else {
        Ok(None)
    }
}

/// Save symbol diff results to the cache.
pub fn save(
    repo_path: &Path,
    comparison: &Comparison,
    diff_hash: &str,
    results: &[FileSymbolDiff],
) -> Result<()> {
    let path = cache_path(repo_path, comparison)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let cache = SymbolDiffCache {
        diff_hash: diff_hash.to_owned(),
        symbol_diffs: results.to_vec(),
    };
    let content = serde_json::to_string(&cache)?;
    fs::write(&path, content)?;
    Ok(())
}
