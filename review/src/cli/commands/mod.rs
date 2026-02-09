pub mod classify;
pub mod delete;
pub mod diff;
pub mod files;
pub mod list;
pub mod notes;
pub mod open;
pub mod pr;
pub mod reset;
pub mod start;
pub mod status;

use crate::review::storage;
use crate::sources::traits::Comparison;
use std::path::Path;

/// Shared error message for commands that require an active comparison.
const NO_COMPARISON_MSG: &str =
    "No active comparison. Use 'review start <base>..<head>' to set one.";

/// Load the current comparison or return a user-friendly error.
fn require_comparison(repo_path: &Path) -> Result<Comparison, String> {
    storage::get_current_comparison(repo_path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| NO_COMPARISON_MSG.to_owned())
}

/// Serialize a value as pretty-printed JSON and print it to stdout.
fn print_json(value: &impl serde::Serialize) {
    println!(
        "{}",
        serde_json::to_string_pretty(value).expect("failed to serialize JSON output")
    );
}

/// Split a unified diff string into per-file sections.
fn split_diff_by_file(diff: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut current = String::new();

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            if !current.is_empty() {
                files.push(current);
            }
            current = String::new();
        }
        current.push_str(line);
        current.push('\n');
    }

    if !current.is_empty() {
        files.push(current);
    }

    files
}

/// Extract the file path from a single-file diff section (from the +++ line).
fn extract_file_path(file_diff: &str) -> Option<String> {
    for line in file_diff.lines() {
        if let Some(path) = line.strip_prefix("+++ b/") {
            return Some(path.to_owned());
        }
        if let Some(path) = line.strip_prefix("+++ a/") {
            return Some(path.to_owned());
        }
    }
    None
}
