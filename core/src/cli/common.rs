//! Shared helpers for the review data subcommands (`hunks`, `changes`,
//! staging, and review-state mutations).

use std::collections::HashSet;
use std::path::Path;

use clap::Args;
use serde::Serialize;

use crate::classify::{classify_hunks_static, ClassifyResponse};
use crate::diff::parser::{DiffHunk, LineType};
use crate::review::state::{unique_id_seed, Attributed, HunkStatus, ReviewState, Source};
use crate::review::storage::{self, StorageError};
use crate::service::targets::{self, ResolvedReview};

/// The `--repo` / `--spec` flags shared by the review-state subcommands.
///
/// Both are `global`, so they parse in any position within a command — e.g.
/// `review finding -s X resolve …` and `review finding resolve … -s X` are
/// equivalent. (This requires that no command flatten `ReviewTarget` at both a
/// parent and a child level, which would define the global twice; keep it on
/// the parent only.)
#[derive(Debug, Args)]
pub struct ReviewTarget {
    /// Repository path (defaults to the current directory)
    #[arg(short, long, global = true)]
    pub repo: Option<String>,
    /// Comparison spec ("base..head" or a single ref); falls back to
    /// `$REVIEW_SPEC`, then the `review use` default, then auto-detection
    #[arg(short, long, global = true)]
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

/// A unique ID suffix: [`unique_id_seed`] behind a `t`, which keeps
/// `parse_hunk_target`'s all-hex heuristic from mistaking a store-assigned ID
/// for a hunk hash.
pub fn new_id_suffix() -> String {
    format!("t{}", unique_id_seed())
}

/// A "42" or "42-48" line reference; never the redundant "42-42".
pub fn line_range(start: u32, end: Option<u32>) -> String {
    match end {
        Some(e) if e != start => format!("{start}-{e}"),
        _ => start.to_string(),
    }
}

/// Resolve the review a data command targets — its identity (`ref` +
/// `baseOverride`) and the concrete `Comparison` to diff.
///
/// Precedence for the spec: explicit `--spec` flag → `$REVIEW_SPEC` → the
/// `review use` stored default → auto-detection (the current branch as the
/// ref). The spec is parsed into `(ref, base?)` via [`parse_review_spec`].
///
/// Base resolution then layers three sources, most specific first: an explicit
/// base on the spec (`base..ref`) wins; otherwise the review's stored
/// `base_override` (set by `change-base`) applies; otherwise the ladder in
/// [`targets::resolve_review`] derives it.
pub fn resolve_review_arg(repo: &Path, spec: Option<&str>) -> Result<ResolvedReview, String> {
    let (ref_name, spec_base) = match effective_spec(repo, spec) {
        Some(spec) => super::parse_review_spec(&spec)?,
        None => (super::auto_detect_ref(repo)?, None),
    };
    let base_override = match spec_base {
        Some(base) => Some(base),
        None => storage::load_review_state(repo, &ref_name)
            .ok()
            .and_then(|state| state.base_override),
    };
    targets::resolve(repo, &ref_name, base_override.as_deref()).map_err(|e| e.to_string())
}

/// Resolve an optional directory argument: the given path made absolute, or the
/// current directory when it's absent. The shared spelling of "[DIR], defaulting
/// to here" — `review [path]`, `review workspace resolve`, `review terminal start`.
pub fn resolve_cwd_arg(dir: Option<String>) -> Result<std::path::PathBuf, String> {
    match dir {
        Some(dir) => super::resolve_absolute(Path::new(&dir)),
        None => std::env::current_dir().map_err(|e| e.to_string()),
    }
}

/// Trim `s` and return it as an owned string, unless it's blank.
pub(crate) fn non_blank(s: &str) -> Option<String> {
    let s = s.trim();
    (!s.is_empty()).then(|| s.to_owned())
}

/// The spec a command should use before falling back to auto-detection:
/// the explicit `--spec` flag, else `$REVIEW_SPEC`, else the repo's stored
/// `review use` default. `None` means "auto-detect". A blank/whitespace-only
/// value at any precedence level falls through to the next one, rather than
/// being taken literally.
pub fn effective_spec(repo: &Path, spec: Option<&str>) -> Option<String> {
    if let Some(spec) = spec.and_then(non_blank) {
        return Some(spec);
    }
    if let Some(env) = std::env::var("REVIEW_SPEC")
        .ok()
        .and_then(|env| non_blank(&env))
    {
        return Some(env);
    }
    storage::read_default_spec(repo)
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
    if state.labels_trusted(labels) {
        EffectiveStatus::Trusted
    } else {
        EffectiveStatus::Unreviewed
    }
}

/// Resolve the review and enumerate every hunk in its comparison (matching
/// what the desktop app shows).
pub fn load_comparison_hunks(
    repo: &Path,
    spec: Option<&str>,
) -> Result<(ResolvedReview, Vec<DiffHunk>), String> {
    let review = resolve_review_arg(repo, spec)?;
    let hunks = crate::service::files::comparison_hunks(repo, &review.comparison)
        .map_err(|e| format!("Failed to read hunks: {e}"))?;
    Ok((review, hunks))
}

/// A review's resolved identity and hunks joined with its classification and
/// saved review state.
pub struct ReviewView {
    pub review: ResolvedReview,
    pub hunks: Vec<DiffHunk>,
    pub classification: ClassifyResponse,
    pub state: ReviewState,
}

/// Enumerate a review's hunks, classify them, and load its saved state.
pub fn load_review_view(repo: &Path, spec: Option<&str>) -> Result<ReviewView, String> {
    let (review, hunks) = load_comparison_hunks(repo, spec)?;
    let classification = classify_hunks_static(&hunks);
    let mut state = storage::load_review_state(repo, &review.ref_name)
        .map_err(|e| format!("Failed to load review: {e}"))?;
    // Carry decisions forward onto the current diff for display (not persisted
    // until the next mutation), so `review hunks`/`status` reflect prior work
    // even after edits shifted hunk IDs. drop_orphans=true: `hunks` is the
    // authoritative full diff the CLI just computed.
    state.reconcile(&hunks, true);
    Ok(ReviewView {
        review,
        hunks,
        classification,
        state,
    })
}

pub(super) const MAX_SAVE_RETRIES: usize = 5;

/// The set of live hunk IDs from a parsed diff.
pub fn live_hunk_ids(hunks: &[DiffHunk]) -> HashSet<String> {
    hunks.iter().map(|h| h.id.clone()).collect()
}

/// Resolve a review, enumerate its hunks, and derive the live-ID set — the
/// prelude every mutating subcommand needs before `mutate_review`.
pub fn load_for_mutation(
    repo: &Path,
    spec: Option<&str>,
) -> Result<(ResolvedReview, Vec<DiffHunk>, HashSet<String>), String> {
    let (review, hunks) = load_comparison_hunks(repo, spec)?;
    let live_ids = live_hunk_ids(&hunks);
    Ok((review, hunks, live_ids))
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
    ref_name: &str,
    live_hunks: &[DiffHunk],
    apply: F,
) -> Result<ReviewState, String>
where
    F: Fn(&mut ReviewState) -> bool,
{
    for _ in 0..MAX_SAVE_RETRIES {
        let mut state = storage::load_review_state(repo, ref_name)
            .map_err(|e| format!("Failed to load review: {e}"))?;
        let changed = apply(&mut state);
        if !changed {
            // No-op: don't bump the version or rewrite the file.
            return Ok(state);
        }
        // drop_orphans=true: `live_hunks` is the authoritative full diff loaded
        // by `load_for_mutation`.
        state.reconcile(live_hunks, true);
        // Counted here for the same reason the desktop path counts on save: a
        // review the CLI touched has to report the same progress as one the app
        // touched, or the sidebar's number depends on which drove it last.
        state.progress = Some(state.measure(live_hunks));
        state.prepare_for_save();
        match storage::save_review_state(repo, &state) {
            Ok(()) => return Ok(state),
            Err(StorageError::VersionConflict { .. }) => {}
            Err(e) => return Err(format!("Failed to save review: {e}")),
        }
    }
    Err("Failed to save review after repeated version conflicts.".to_owned())
}

/// Resolve a `--source` flag (or `$REVIEW_SOURCE`) to a [`Source`], defaulting
/// to `cli`. Shared by the comment and status commands so an agent
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

/// Reject an empty/whitespace-only value, shared by CLI commands with a
/// user-supplied text field (comment content, guide group titles, ...).
pub fn reject_blank(field: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("empty {field}"));
    }
    Ok(())
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
    use crate::review::state::HunkState;

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

    #[test]
    fn line_range_single_line_has_no_end() {
        assert_eq!(line_range(42, None), "42");
    }

    #[test]
    fn line_range_spans_start_and_end() {
        assert_eq!(line_range(42, Some(48)), "42-48");
    }

    #[test]
    fn line_range_collapses_redundant_end() {
        assert_eq!(line_range(42, Some(42)), "42");
    }

    fn classify_response(hunk_id: &str, labels: &[&str]) -> ClassifyResponse {
        let mut classifications = std::collections::HashMap::new();
        classifications.insert(
            hunk_id.to_string(),
            crate::classify::ClassificationResult {
                label: labels.iter().map(|s| s.to_string()).collect(),
                reasoning: String::new(),
            },
        );
        ClassifyResponse { classifications }
    }

    #[test]
    fn hunk_labels_prefers_stored_labels_over_classification() {
        let mut state = ReviewState::new("main", None);
        state.hunks.insert(
            "src/foo.rs:abcd1234".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["comments:added".to_string()],
                    Source::Ui,
                )),
                status: None,
                stable_key: None,
            },
        );
        let classification = classify_response("src/foo.rs:abcd1234", &["imports:added"]);

        let labels = hunk_labels("src/foo.rs:abcd1234", &state, &classification);

        assert_eq!(labels, vec!["comments:added".to_string()]);
    }

    #[test]
    fn hunk_labels_falls_back_to_classification_when_unset() {
        let state = ReviewState::new("main", None);
        let classification = classify_response("src/foo.rs:abcd1234", &["imports:added"]);

        let labels = hunk_labels("src/foo.rs:abcd1234", &state, &classification);

        assert_eq!(labels, vec!["imports:added".to_string()]);
    }

    #[test]
    fn hunk_labels_falls_back_when_stored_labels_are_empty() {
        let mut state = ReviewState::new("main", None);
        state.hunks.insert(
            "src/foo.rs:abcd1234".to_string(),
            HunkState {
                classification: Some(Attributed::new(vec![], Source::Ui)),
                status: None,
                stable_key: None,
            },
        );
        let classification = classify_response("src/foo.rs:abcd1234", &["imports:added"]);

        let labels = hunk_labels("src/foo.rs:abcd1234", &state, &classification);

        assert_eq!(labels, vec!["imports:added".to_string()]);
    }

    #[test]
    fn effective_status_explicit_status_wins_over_trust() {
        let mut state = ReviewState::new("main", None);
        state.trust_list = vec!["imports:added".to_string()];
        state.hunks.insert(
            "src/foo.rs:abcd1234".to_string(),
            HunkState {
                classification: None,
                status: Some(Attributed::new(HunkStatus::Rejected, Source::Cli)),
                stable_key: None,
            },
        );

        // Even though the labels would otherwise be trust-listed, the
        // explicit decision takes precedence.
        let status = effective_status(
            "src/foo.rs:abcd1234",
            &["imports:added".to_string()],
            &state,
        );

        assert_eq!(status, EffectiveStatus::Rejected);
    }

    #[test]
    fn effective_status_maps_each_persisted_status() {
        let mut state = ReviewState::new("main", None);
        for (persisted, expected) in [
            (HunkStatus::Approved, EffectiveStatus::Approved),
            (HunkStatus::Rejected, EffectiveStatus::Rejected),
            (HunkStatus::SavedForLater, EffectiveStatus::Saved),
        ] {
            state.hunks.insert(
                "src/foo.rs:abcd1234".to_string(),
                HunkState {
                    classification: None,
                    status: Some(Attributed::new(persisted, Source::Cli)),
                    stable_key: None,
                },
            );
            assert_eq!(
                effective_status("src/foo.rs:abcd1234", &[], &state),
                expected
            );
        }
    }

    #[test]
    fn effective_status_falls_back_to_trust_list_when_no_decision_is_recorded() {
        let mut state = ReviewState::new("main", None);
        state.trust_list = vec!["imports:added".to_string()];

        // No entry in `state.hunks` at all.
        assert_eq!(
            effective_status(
                "src/foo.rs:abcd1234",
                &["imports:added".to_string()],
                &state
            ),
            EffectiveStatus::Trusted
        );
        assert_eq!(
            effective_status(
                "src/foo.rs:abcd1234",
                &["comments:added".to_string()],
                &state
            ),
            EffectiveStatus::Unreviewed
        );
    }

    #[test]
    fn effective_spec_falls_through_blank_levels() {
        let _lock = crate::review::central::tests::ENV_LOCK.lock().unwrap();
        let (_guard, _review_home, repo) = crate::review::central::tests::setup_test();
        std::env::remove_var("REVIEW_SPEC");

        // Nothing set at any level: auto-detect.
        assert_eq!(effective_spec(repo.path(), None), None);

        // A blank explicit flag falls through to $REVIEW_SPEC, not taken literally.
        std::env::set_var("REVIEW_SPEC", "from-env");
        assert_eq!(
            effective_spec(repo.path(), Some("  ")),
            Some("from-env".to_owned())
        );

        // A non-blank explicit flag still wins over $REVIEW_SPEC.
        assert_eq!(
            effective_spec(repo.path(), Some("from-flag")),
            Some("from-flag".to_owned())
        );

        // Blank at both the flag and the env var falls through to the stored default.
        std::env::set_var("REVIEW_SPEC", "  ");
        storage::write_default_spec(repo.path(), "from-default").unwrap();
        assert_eq!(
            effective_spec(repo.path(), Some("")),
            Some("from-default".to_owned())
        );

        std::env::remove_var("REVIEW_SPEC");
    }
}
