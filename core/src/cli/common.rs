//! Shared helpers for the review data subcommands (`hunks`, `changes`,
//! staging, and review-state mutations).

use std::collections::HashSet;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};

use clap::Args;
use serde::Serialize;

use crate::classify::{classify_hunks_static, ClassifyResponse};
use crate::diff::parser::{DiffHunk, LineType};
use crate::review::state::{Attributed, HunkStatus, ReviewState, Source};
use crate::review::storage::{self, StorageError};
use crate::sources::traits::Comparison;

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

/// A unique ID suffix of the form `t{epoch_ms}-{pid}-{counter}`. The `t`
/// prefix keeps `parse_hunk_target`'s all-hex heuristic from mistaking a
/// store-assigned ID for a hunk hash; the per-process counter guarantees
/// uniqueness across rapid creations within the same millisecond, and the
/// process id discriminates between two processes minting IDs in that same
/// millisecond (which would otherwise collide).
pub fn new_id_suffix() -> String {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let epoch = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let counter = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("t{epoch}-{}-{counter}", std::process::id())
}

/// A "42" or "42-48" line reference; never the redundant "42-42".
pub fn line_range(start: u32, end: Option<u32>) -> String {
    match end {
        Some(e) if e != start => format!("{start}-{e}"),
        _ => start.to_string(),
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
        let labels = hunk_state.labels();
        if !labels.is_empty() {
            return labels.to_vec();
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
        if entry.classification.is_none() {
            entry.classification = Some(Attributed {
                value: result.label.clone(),
                source: Source::Static,
                reasoning: (!result.reasoning.is_empty()).then(|| result.reasoning.clone()),
            });
        }
    }
}

/// Effective review status of a hunk: an explicit status if one is set, else
/// `Trusted` when a label matches the trust list, else `Unreviewed`.
pub fn effective_status(hunk_id: &str, labels: &[String], state: &ReviewState) -> EffectiveStatus {
    let hunk_state = state.hunks.get(hunk_id);
    if let Some(hunk_state) = hunk_state {
        if let Some(status) = &hunk_state.status {
            return match &status.value {
                HunkStatus::Approved => EffectiveStatus::Approved,
                HunkStatus::Rejected => EffectiveStatus::Rejected,
                HunkStatus::SavedForLater => EffectiveStatus::Saved,
            };
        }
    }
    // High risk vetoes auto-trust: a risky hunk stays unreviewed until it's
    // explicitly decided, even when its label is trust-listed.
    let high_risk = hunk_state.map(|h| h.is_high_risk()).unwrap_or(false);
    if !high_risk && state.labels_trusted(labels) {
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
    let hunks = crate::service::files::comparison_hunks(repo, &comparison, None)
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
    let mut state = storage::load_review_state(repo, &comparison)
        .map_err(|e| format!("Failed to load review: {e}"))?;
    // Carry decisions forward onto the current diff for display (not persisted
    // until the next mutation), so `review hunks`/`status` reflect prior work
    // even after edits shifted hunk IDs. drop_orphans=true: `hunks` is the
    // authoritative full diff the CLI just computed.
    state.reconcile(&hunks, true);
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

/// Load a review, apply a mutation, reconcile `state.hunks` against the live
/// diff, then save — retrying on version conflicts so concurrent writes (e.g.
/// from the desktop app) don't fail.
///
/// `apply` returns `true` when it made a change worth persisting and `false`
/// for a no-op (e.g. resolving an already-resolved comment). On a no-op the
/// loaded state is returned untouched — no version bump, no write, no file-
/// watcher churn.
///
/// [`ReviewState::reconcile`] carries each decision forward onto the live hunk
/// with the same stable identity (so an edit that shifts hunk IDs doesn't
/// discard prior review work) and drops only the genuine orphans — keeping
/// `to_summary` and `review list` honest.
pub fn mutate_review<F>(
    repo: &Path,
    comparison: &Comparison,
    live_hunks: &[DiffHunk],
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
        // drop_orphans=true: `live_hunks` is the authoritative full diff loaded
        // by `load_for_mutation`.
        state.reconcile(live_hunks, true);
        state.prepare_for_save();
        match storage::save_review_state(repo, &state) {
            Ok(()) => return Ok(state),
            Err(StorageError::VersionConflict { .. }) if attempt + 1 < MAX_SAVE_RETRIES => {}
            Err(e) => return Err(format!("Failed to save review: {e}")),
        }
    }
    Err("Failed to save review after repeated version conflicts.".to_owned())
}

/// Resolve a `--source` flag (or `$REVIEW_SOURCE`) to a [`Source`], defaulting
/// to `cli`. Shared by the comment, status, and risk commands so an agent
/// harness can export `REVIEW_SOURCE=agent` once and have every mutation it
/// makes attributed correctly.
pub fn resolve_source(arg: Option<super::comments::SourceArg>) -> Result<Source, String> {
    if let Some(arg) = arg {
        return Ok(Source::from(arg));
    }
    match std::env::var("REVIEW_SOURCE") {
        Ok(value) => super::comments::parse_source_str(&value).ok_or_else(|| {
            format!("Invalid $REVIEW_SOURCE value '{value}' (expected one of: ui, cli, agent, github, gitlab)")
        }),
        Err(_) => Ok(Source::Cli),
    }
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
