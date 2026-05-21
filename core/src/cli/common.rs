//! Shared helpers for the review data subcommands (`hunks`, `changes`,
//! staging, and review-state mutations).

use std::collections::HashSet;
use std::path::Path;

use clap::Args;
use serde::Serialize;

use crate::classify::{classify_hunks_static, ClassifyResponse};
use crate::diff::parser::{DiffHunk, LineType};
use crate::review::state::{ClassifiedVia, HunkStatus, ReviewState};
use crate::review::storage::{self, StorageError};
use crate::sources::traits::{Comparison, FileEntry};

/// The `--repo` / `--spec` flags shared by the review-state subcommands.
#[derive(Debug, Args)]
pub struct ReviewTarget {
    /// Repository path (defaults to the current directory)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// Comparison spec ("base..head" or a single ref); auto-detected if omitted
    #[arg(short, long)]
    pub spec: Option<String>,
}

/// The effective review status of a hunk — a superset of the persisted
/// [`HunkStatus`] that also covers unreviewed and trust-listed hunks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum EffectiveStatus {
    Unreviewed,
    Trusted,
    Approved,
    Rejected,
    Saved,
}

impl EffectiveStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            EffectiveStatus::Unreviewed => "unreviewed",
            EffectiveStatus::Trusted => "trusted",
            EffectiveStatus::Approved => "approved",
            EffectiveStatus::Rejected => "rejected",
            EffectiveStatus::Saved => "saved",
        }
    }
}

/// A staging/review target parsed from a CLI argument: either one specific
/// hunk (`<file>:<hash>`) or a whole file (`<file>`).
pub enum HunkTarget {
    Hunk { file: String, hash: String },
    File { path: String },
}

/// Parse a stage/unstage argument. A trailing `:<hex>` segment (8+ hex
/// characters) is treated as a hunk content hash; otherwise the whole
/// argument is taken as a file path.
pub fn parse_hunk_target(arg: &str) -> HunkTarget {
    if let Some((file, hash)) = arg.rsplit_once(':') {
        if !file.is_empty() && hash.len() >= 8 && hash.chars().all(|c| c.is_ascii_hexdigit()) {
            return HunkTarget::Hunk {
                file: file.to_owned(),
                hash: hash.to_owned(),
            };
        }
    }
    HunkTarget::File {
        path: arg.to_owned(),
    }
}

/// Resolve the comparison for a data command from an optional `--spec`,
/// falling back to the repo's default and current branches.
pub fn resolve_comparison_arg(repo: &Path, spec: Option<&str>) -> Result<Comparison, String> {
    match spec {
        Some(spec) => super::parse_comparison_spec(repo, spec),
        None => super::resolve_comparison(repo, None, None),
    }
}

/// Recursively collect non-directory file paths from a `FileEntry` tree.
pub fn collect_file_paths(entries: &[FileEntry], out: &mut Vec<String>) {
    for entry in entries {
        if entry.is_directory {
            if let Some(children) = &entry.children {
                collect_file_paths(children, out);
            }
        } else {
            out.push(entry.path.clone());
        }
    }
}

/// Count `(added, removed)` lines in a hunk.
pub fn hunk_line_stats(hunk: &DiffHunk) -> (usize, usize) {
    let mut added = 0;
    let mut removed = 0;
    for line in &hunk.lines {
        match line.line_type {
            LineType::Added => added += 1,
            LineType::Removed => removed += 1,
            LineType::Context => {}
        }
    }
    (added, removed)
}

/// Reconstruct a unified-diff representation of a hunk for display.
pub fn render_hunk_diff(hunk: &DiffHunk) -> String {
    let mut out = format!(
        "@@ -{},{} +{},{} @@\n",
        hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count
    );
    for line in &hunk.lines {
        let prefix = match line.line_type {
            LineType::Context => ' ',
            LineType::Added => '+',
            LineType::Removed => '-',
        };
        out.push(prefix);
        out.push_str(&line.content);
        out.push('\n');
    }
    out
}

/// The static-classification labels recorded for a hunk ID.
pub fn classified_labels(classification: &ClassifyResponse, hunk_id: &str) -> Vec<String> {
    classification
        .classifications
        .get(hunk_id)
        .map(|c| c.label.clone())
        .unwrap_or_default()
}

/// The labels for a hunk: stored review labels take precedence over a fresh
/// static classification.
pub fn hunk_labels(
    hunk_id: &str,
    state: &ReviewState,
    classification: &ClassifyResponse,
) -> Vec<String> {
    if let Some(hunk_state) = state.hunks.get(hunk_id) {
        if !hunk_state.label.is_empty() {
            return hunk_state.label.clone();
        }
    }
    classified_labels(classification, hunk_id)
}

/// Persist static-classification labels into the review state so summaries
/// — `review list` and the desktop app's sidebar — see every classified
/// hunk, matching what the app stores. Existing labels (e.g. from the app's
/// AI classification) are left untouched.
pub fn sync_classification(state: &mut ReviewState, classification: &ClassifyResponse) {
    for (hunk_id, result) in &classification.classifications {
        if result.label.is_empty() {
            continue;
        }
        let entry = state.hunks.entry(hunk_id.clone()).or_default();
        if entry.label.is_empty() {
            entry.label.clone_from(&result.label);
            if entry.classified_via.is_none() {
                entry.classified_via = Some(ClassifiedVia::Static);
            }
        }
    }
}

/// Effective review status of a hunk: an explicit status if one is set, else
/// `Trusted` when a label matches the trust list, else `Unreviewed`.
pub fn effective_status(hunk_id: &str, labels: &[String], state: &ReviewState) -> EffectiveStatus {
    if let Some(hunk_state) = state.hunks.get(hunk_id) {
        if let Some(status) = &hunk_state.status {
            return match status {
                HunkStatus::Approved => EffectiveStatus::Approved,
                HunkStatus::Rejected => EffectiveStatus::Rejected,
                HunkStatus::SavedForLater => EffectiveStatus::Saved,
            };
        }
    }
    if state.labels_trusted(labels) {
        EffectiveStatus::Trusted
    } else {
        EffectiveStatus::Unreviewed
    }
}

/// Enumerate every hunk in a comparison (matching what the desktop app shows).
pub fn load_comparison_hunks(
    repo: &Path,
    spec: Option<&str>,
) -> Result<(Comparison, Vec<DiffHunk>), String> {
    let comparison = resolve_comparison_arg(repo, spec)?;
    let files = crate::service::files::list_files(repo, &comparison, None)
        .map_err(|e| format!("Failed to list files: {e}"))?;
    let mut paths = Vec::new();
    collect_file_paths(&files, &mut paths);
    let hunks = crate::service::files::get_all_hunks(repo, &comparison, &paths)
        .map_err(|e| format!("Failed to read hunks: {e}"))?;
    Ok((comparison, hunks))
}

/// A comparison's hunks joined with its classification and saved review state.
pub struct ReviewView {
    pub comparison: Comparison,
    pub hunks: Vec<DiffHunk>,
    pub classification: ClassifyResponse,
    pub state: ReviewState,
}

/// Enumerate a comparison's hunks, classify them, and load its review state.
pub fn load_review_view(repo: &Path, spec: Option<&str>) -> Result<ReviewView, String> {
    let (comparison, hunks) = load_comparison_hunks(repo, spec)?;
    let classification = classify_hunks_static(&hunks);
    let state = storage::load_review_state(repo, &comparison)
        .map_err(|e| format!("Failed to load review: {e}"))?;
    Ok(ReviewView {
        comparison,
        hunks,
        classification,
        state,
    })
}

const MAX_SAVE_RETRIES: usize = 5;

/// The set of live hunk IDs from a parsed diff.
pub fn live_hunk_ids(hunks: &[DiffHunk]) -> HashSet<String> {
    hunks.iter().map(|h| h.id.clone()).collect()
}

/// Resolve a comparison, enumerate its hunks, and derive the live-ID set —
/// the prelude every mutating subcommand needs before `mutate_review`.
pub fn load_for_mutation(
    repo: &Path,
    spec: Option<&str>,
) -> Result<(Comparison, Vec<DiffHunk>, HashSet<String>), String> {
    let (comparison, hunks) = load_comparison_hunks(repo, spec)?;
    let live_ids = live_hunk_ids(&hunks);
    Ok((comparison, hunks, live_ids))
}

/// Load a review, apply a mutation, prune entries in `state.hunks` whose ID
/// is no longer in the live diff, then save — retrying on version conflicts
/// so concurrent writes (e.g. from the desktop app) don't fail.
///
/// `apply` returns `true` when it made a change worth persisting and `false`
/// for a no-op (e.g. resolving an already-resolved comment). On a no-op the
/// loaded state is returned untouched — no version bump, no write, no file-
/// watcher churn.
///
/// Pruning keeps `to_summary` and `review list` honest: an approval is
/// content-tied; when content changes the hash drifts and the entry is a
/// meaningless orphan.
pub fn mutate_review<F>(
    repo: &Path,
    comparison: &Comparison,
    live_ids: &HashSet<String>,
    apply: F,
) -> Result<ReviewState, String>
where
    F: Fn(&mut ReviewState) -> bool,
{
    for attempt in 0..MAX_SAVE_RETRIES {
        let mut state = storage::load_review_state(repo, comparison)
            .map_err(|e| format!("Failed to load review: {e}"))?;
        let changed = apply(&mut state);
        if !changed {
            // No-op: don't bump the version or rewrite the file.
            return Ok(state);
        }
        state.hunks.retain(|id, _| live_ids.contains(id));
        state.prepare_for_save();
        match storage::save_review_state(repo, &state) {
            Ok(()) => return Ok(state),
            Err(StorageError::VersionConflict { .. }) if attempt + 1 < MAX_SAVE_RETRIES => {}
            Err(e) => return Err(format!("Failed to save review: {e}")),
        }
    }
    Err("Failed to save review after repeated version conflicts.".to_owned())
}

/// Print a value as pretty JSON to stdout.
pub fn print_json<T: Serialize>(value: &T) {
    match serde_json::to_string_pretty(value) {
        Ok(text) => println!("{text}"),
        Err(e) => eprintln!("Failed to serialize JSON: {e}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_hunk_target_recognizes_hunk_id() {
        match parse_hunk_target("src/foo.rs:a1b2c3d4e5f60718") {
            HunkTarget::Hunk { file, hash } => {
                assert_eq!(file, "src/foo.rs");
                assert_eq!(hash, "a1b2c3d4e5f60718");
            }
            HunkTarget::File { .. } => panic!("expected a hunk target"),
        }
    }

    #[test]
    fn parse_hunk_target_treats_plain_path_as_file() {
        match parse_hunk_target("src/foo.rs") {
            HunkTarget::File { path } => assert_eq!(path, "src/foo.rs"),
            HunkTarget::Hunk { .. } => panic!("expected a file target"),
        }
    }

    #[test]
    fn parse_hunk_target_non_hex_suffix_is_a_file() {
        // A colon followed by a non-hex segment is treated as a file path.
        match parse_hunk_target("weird:name.rs") {
            HunkTarget::File { path } => assert_eq!(path, "weird:name.rs"),
            HunkTarget::Hunk { .. } => panic!("expected a file target"),
        }
    }

    #[test]
    fn parse_hunk_target_short_hex_suffix_is_a_file() {
        // Hash segments are 8+ hex chars; a shorter suffix stays a file path.
        match parse_hunk_target("a:bcd") {
            HunkTarget::File { path } => assert_eq!(path, "a:bcd"),
            HunkTarget::Hunk { .. } => panic!("expected a file target"),
        }
    }
}
