use crate::diff::parser::DiffHunk;
use crate::sources::traits::Comparison;
use crate::trust::matches_pattern;
use crate::trust::patterns::get_all_pattern_ids;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// The on-disk format version for a serialized [`ReviewState`].
///
/// This is the *schema* version — distinct from [`ReviewState::version`], which
/// is the optimistic-concurrency counter. Bump this whenever the persisted
/// shape changes in a way old readers can't understand, and add a matching step
/// in [`super::migrate`]. Files are migrated forward on read; a file written by
/// a newer schema than this binary understands is rejected loudly rather than
/// silently dropped.
pub const REVIEW_SCHEMA_VERSION: u32 = 1;

/// Default for the `schema_version` field when absent — i.e. a file written
/// before schema versioning existed. Such files go through the migration path.
pub(crate) fn default_schema_version() -> u32 {
    0
}

/// A group of related hunks in the review guide.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HunkGroup {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(rename = "hunkIds")]
    pub hunk_ids: Vec<String>,
}

/// The authored guide state: the walkthrough `groups`, plus a snapshot of the
/// hunk IDs present when it was last written (`hunk_ids`) so readers can tell
/// when the diff has drifted out from under it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuideGenerated {
    pub groups: Vec<HunkGroup>,
    #[serde(rename = "hunkIds")]
    pub hunk_ids: Vec<String>,
    #[serde(rename = "generatedAt")]
    pub generated_at: String,
}

/// The review guide — an agent-authored grouping of a comparison's hunks into a
/// walkthrough (written via `review guide`, rendered by the desktop app). A thin
/// wrapper over [`GuideGenerated`], kept as its own object so the on-disk
/// `guide.state` shape stays stable and older files (which also carried an
/// `autoStart` flag, now ignored) still deserialize.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Guide {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state: Option<GuideGenerated>,
}

/// Lenient deserializer for the `guide` field: discards legacy/malformed data
/// instead of failing the entire ReviewState load.
fn deserialize_guide_lenient<'de, D>(deserializer: D) -> Result<Option<Guide>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value: Option<serde_json::Value> = Option::deserialize(deserializer)?;
    match value {
        None => Ok(None),
        Some(v) => match serde_json::from_value::<Guide>(v) {
            Ok(guide) => Ok(Some(guide)),
            Err(e) => {
                eprintln!("[review] Discarding incompatible guide data: {e}");
                Ok(None)
            }
        },
    }
}

/// A line annotation for inline comments
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LineAnnotation {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    #[serde(rename = "lineNumber")]
    pub line_number: u32,
    #[serde(
        rename = "endLineNumber",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub end_line_number: Option<u32>,
    pub side: AnnotationSide,
    pub content: String,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    /// Display name of who left the comment (e.g. git user, "claude", "codex",
    /// GitHub login). `None` for legacy annotations created before authorship.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    /// Where the annotation came from (ui, cli, agent, github, …). Used for
    /// styling and filtering. `None` for legacy data.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
    /// Last edit time; absent if never edited after creation.
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<String>,
    /// Resolution timestamp; presence means "resolved".
    #[serde(
        rename = "resolvedAt",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub resolved_at: Option<String>,
    /// Display name of who resolved the comment.
    #[serde(
        rename = "resolvedBy",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub resolved_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationSide {
    Old,
    New,
    File,
}

/// Where a value came from — the producer that set a classification, status,
/// risk level, or annotation. One provenance vocabulary across the whole model.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    /// Rule-based static classifier.
    Static,
    /// The app's built-in Claude classification pass.
    Ai,
    /// A human acting in the desktop app.
    Ui,
    /// A human via the review CLI.
    Cli,
    /// An external agent (Claude/Codex) acting through the CLI.
    Agent,
    Github,
    Gitlab,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewState {
    /// On-disk format version. See [`REVIEW_SCHEMA_VERSION`]. Migrated forward
    /// on read; not to be confused with `version` (the concurrency counter).
    #[serde(rename = "schemaVersion", default = "default_schema_version")]
    pub schema_version: u32,
    pub comparison: Comparison,
    pub hunks: HashMap<String, HunkState>,
    #[serde(rename = "trustList")]
    pub trust_list: Vec<String>,
    pub notes: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub annotations: Vec<LineAnnotation>,
    #[serde(rename = "createdAt")]
    pub created_at: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// Concurrency counter for optimistic conflict detection — incremented on
    /// each save. NOT the on-disk format version; see [`schema_version`].
    ///
    /// [`schema_version`]: ReviewState::schema_version
    #[serde(default)]
    pub version: u64,
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "deserialize_guide_lenient"
    )]
    pub guide: Option<Guide>,
    /// Total number of hunks in the diff (including unclassified).
    /// Used by `to_summary()` for accurate progress. Defaults to 0 for
    /// legacy data; `syncTotalDiffHunks` sets the real count when opened.
    #[serde(default, rename = "totalDiffHunks")]
    pub total_diff_hunks: usize,
    /// Optional GitHub PR reference (moved from Comparison).
    #[serde(rename = "githubPr", default, skip_serializing_if = "Option::is_none")]
    pub github_pr: Option<crate::sources::github::GitHubPrRef>,
    /// Path to the review-managed worktree, if one was created.
    #[serde(
        rename = "worktreePath",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub worktree_path: Option<String>,
}

/// Risk level for a hunk — how costly a mistake here would be, independent of
/// what kind of change it is (classification) or the review decision (status).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HunkRisk {
    Low,
    High,
}

/// A value paired with its provenance and an optional rationale. Every axis of
/// a [`HunkState`] is an `Attributed<T>`, so each independently records who or
/// what set it and why.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attributed<T> {
    pub value: T,
    pub source: Source,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
}

impl<T> Attributed<T> {
    /// An attributed value with no rationale.
    pub fn new(value: T, source: Source) -> Self {
        Self {
            value,
            source,
            reasoning: None,
        }
    }
}

/// The review record for a single hunk. Each field is an independent axis:
/// `classification` (what kind of change), `status` (the review decision), and
/// `risk` (blast radius). All optional — absent means "not set".
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HunkState {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub classification: Option<Attributed<Vec<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<Attributed<HunkStatus>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub risk: Option<Attributed<HunkRisk>>,
    /// The hunk's stable identity (changed lines only — see
    /// [`crate::diff::parser::DiffHunk::stable_hash`]) at the time a decision was
    /// recorded. Lets [`ReviewState::reconcile`] carry this decision forward onto
    /// the same change after surrounding context drifts and the hunk ID changes.
    #[serde(rename = "stableKey", default, skip_serializing_if = "Option::is_none")]
    pub stable_key: Option<String>,
}

impl HunkState {
    /// The classification labels, or an empty slice when unclassified.
    pub fn labels(&self) -> &[String] {
        self.classification
            .as_ref()
            .map(|c| c.value.as_slice())
            .unwrap_or(&[])
    }

    /// True when no axis is set. Used to prune entries that have nothing left
    /// on them after a status or risk is cleared.
    pub fn is_empty(&self) -> bool {
        self.classification.is_none() && self.status.is_none() && self.risk.is_none()
    }

    /// True when the hunk is flagged high-risk. High risk vetoes trust
    /// auto-approval — a risky change is never silently trusted.
    pub fn is_high_risk(&self) -> bool {
        matches!(self.risk.as_ref().map(|r| r.value), Some(HunkRisk::High))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HunkStatus {
    Approved,
    Rejected,
    #[serde(rename = "saved_for_later")]
    SavedForLater,
}

/// What [`ReviewState::reconcile`] did when re-associating persisted decisions
/// with a fresh diff: how many decisions were carried forward onto a drifted
/// hunk, and how many orphans were dropped for lack of a stable match.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Reconciliation {
    pub carried_forward: usize,
    pub dropped: usize,
}

impl ReviewState {
    pub fn new(comparison: Comparison) -> Self {
        let now = now_iso8601();
        Self {
            schema_version: REVIEW_SCHEMA_VERSION,
            comparison,
            hunks: HashMap::new(),
            trust_list: get_all_pattern_ids(),
            notes: String::new(),
            annotations: Vec::new(),
            created_at: now.clone(),
            updated_at: now,
            version: 0,
            guide: None,
            total_diff_hunks: 0,
            github_pr: None,
            worktree_path: None,
        }
    }

    /// Increment version and update timestamp for a save operation
    pub fn prepare_for_save(&mut self) {
        self.version += 1;
        self.updated_at = now_iso8601();
        // Always persist the current format version, so a state constructed
        // without one (e.g. a frontend fallback) doesn't write a stale
        // schemaVersion that the next read has to migrate back up.
        self.schema_version = REVIEW_SCHEMA_VERSION;
    }

    /// Re-associate persisted per-hunk decisions with the current diff, so a
    /// review survives the hunk IDs changing underneath it (working-tree edits,
    /// new commits on a branch, a re-pushed PR).
    ///
    /// - Entries whose ID still matches a live hunk are kept, and re-stamped with
    ///   that hunk's current stable key so the next reconcile can match them.
    /// - Orphaned entries (the content hash drifted) are carried forward onto the
    ///   live hunk with the same [`DiffHunk::stable_hash`] — i.e. the same change
    ///   in the same file, just with shifted surrounding context.
    /// - Orphans with no stable match, or whose stable key maps to more than one
    ///   live hunk (ambiguous), are dropped when `drop_orphans` is set — keeping
    ///   `to_summary` / `review list` honest rather than leaving meaningless
    ///   entries behind. When it is clear, such orphans are **retained** as-is.
    ///
    /// `drop_orphans` must only be set when `live_hunks` is the *authoritative*,
    /// complete diff for the comparison (e.g. the CLI computing it itself). The
    /// desktop/web path reconciles against the hunks the UI happened to load,
    /// which can be incomplete (skipped/build-artifact files, a per-file load
    /// failure) — dropping there would silently delete decisions whose hunk was
    /// merely absent, so it passes `false`.
    ///
    /// Carry-forward only kicks in for entries that were previously stamped with
    /// a stable key; older entries (pre-`stable_key`) that orphan are dropped or
    /// retained per `drop_orphans`, exactly as any other orphan.
    pub fn reconcile(&mut self, live_hunks: &[DiffHunk], drop_orphans: bool) -> Reconciliation {
        // One stable hash per live hunk, computed once and reused throughout.
        let stable_by_id: HashMap<&str, String> = live_hunks
            .iter()
            .map(|hunk| (hunk.id.as_str(), hunk.stable_hash()))
            .collect();

        // Candidate carry-forward targets: live hunks that don't already have an
        // entry, mapped stable key -> hunk id. A key shared by >1 such hunk is
        // ambiguous and disqualified (`None`) so a decision is never
        // mis-attributed.
        let mut targets: HashMap<String, Option<String>> = HashMap::new();
        for hunk in live_hunks {
            if self.hunks.contains_key(&hunk.id) {
                continue;
            }
            targets
                .entry(stable_by_id[hunk.id.as_str()].clone())
                .and_modify(|slot| *slot = None)
                .or_insert_with(|| Some(hunk.id.clone()));
        }

        let mut result = Reconciliation::default();
        let mut next: HashMap<String, HunkState> = HashMap::with_capacity(self.hunks.len());

        for (id, mut hunk_state) in std::mem::take(&mut self.hunks) {
            if let Some(stable) = stable_by_id.get(id.as_str()) {
                // Still present: refresh the stable key and keep as-is.
                hunk_state.stable_key = Some(stable.clone());
                next.insert(id, hunk_state);
                continue;
            }
            // Orphan: carry forward onto an unambiguous, unclaimed live hunk with
            // the same stable identity.
            let target_id = hunk_state
                .stable_key
                .as_deref()
                .and_then(|key| targets.get(key).and_then(|slot| slot.clone()))
                .filter(|tid| !next.contains_key(tid));
            match target_id {
                Some(tid) => {
                    hunk_state.stable_key = stable_by_id.get(tid.as_str()).cloned();
                    next.insert(tid, hunk_state);
                    result.carried_forward += 1;
                }
                // No stable match. Drop only against an authoritative diff;
                // otherwise retain the decision (its hunk may simply not be in
                // this — possibly partial — hunk set).
                None if drop_orphans => result.dropped += 1,
                None => {
                    next.insert(id, hunk_state);
                }
            }
        }

        self.hunks = next;
        result
    }

    /// Whether any of `labels` matches a pattern in the trust list.
    pub fn labels_trusted(&self, labels: &[String]) -> bool {
        labels.iter().any(|label| {
            self.trust_list
                .iter()
                .any(|pattern| matches_pattern(label, pattern))
        })
    }

    /// Create a summary of this review state
    pub fn to_summary(&self) -> ReviewSummary {
        let total_hunks = self.total_diff_hunks;

        // Single pass over hunks to count all status categories
        let mut approved_hunks = 0usize;
        let mut rejected_hunks = 0usize;
        let mut saved_for_later_hunks = 0usize;
        let mut trusted_hunks = 0usize;
        let mut high_risk_pending_hunks = 0usize;

        for h in self.hunks.values() {
            match h.status.as_ref().map(|s| &s.value) {
                Some(HunkStatus::Approved) => approved_hunks += 1,
                Some(HunkStatus::Rejected) => rejected_hunks += 1,
                Some(HunkStatus::SavedForLater) => saved_for_later_hunks += 1,
                None => {
                    // Hunks with no explicit status count as reviewed when a
                    // label matches the trust list — unless they're high-risk,
                    // which vetoes auto-trust and leaves them to review.
                    if h.is_high_risk() {
                        high_risk_pending_hunks += 1;
                    } else if self.labels_trusted(h.labels()) {
                        trusted_hunks += 1;
                    }
                }
            }
        }

        let reviewed_hunks = trusted_hunks + approved_hunks + rejected_hunks;

        let state = overall_review_state(rejected_hunks, reviewed_hunks, total_hunks)
            .map(ToOwned::to_owned);

        ReviewSummary {
            comparison: self.comparison.clone(),
            total_hunks,
            trusted_hunks,
            approved_hunks,
            reviewed_hunks,
            rejected_hunks,
            saved_for_later_hunks,
            high_risk_pending_hunks,
            state,
            unreadable: false,
            updated_at: self.updated_at.clone(),
            github_pr: self.github_pr.clone(),
            worktree_path: self.worktree_path.clone(),
        }
    }
}

impl ReviewSummary {
    /// A placeholder summary for a review file that could not be read. Keeps the
    /// review visible in listings (flagged `unreadable`) instead of dropping it.
    /// `comparison` is recovered best-effort from the filename.
    pub fn unreadable(comparison: Comparison, updated_at: String) -> Self {
        ReviewSummary {
            comparison,
            total_hunks: 0,
            trusted_hunks: 0,
            approved_hunks: 0,
            reviewed_hunks: 0,
            rejected_hunks: 0,
            saved_for_later_hunks: 0,
            high_risk_pending_hunks: 0,
            state: None,
            unreadable: true,
            updated_at,
            github_pr: None,
            worktree_path: None,
        }
    }
}

/// Derive the overall review state from hunk tallies. `None` means in progress.
pub fn overall_review_state(
    rejected: usize,
    reviewed: usize,
    total: usize,
) -> Option<&'static str> {
    if rejected > 0 {
        Some("changes_requested")
    } else if total > 0 && reviewed == total {
        Some("approved")
    } else {
        None
    }
}

pub(crate) fn now_iso8601() -> String {
    iso8601_from_system_time(std::time::SystemTime::now())
}

/// Format a `SystemTime` as an ISO 8601 UTC timestamp with milliseconds (for JS
/// compatibility), without pulling in a date crate.
pub(crate) fn iso8601_from_system_time(time: std::time::SystemTime) -> String {
    use std::time::UNIX_EPOCH;
    let duration = time.duration_since(UNIX_EPOCH).unwrap_or_default();
    let secs = duration.as_secs();
    let millis = duration.subsec_millis();

    // Convert to ISO 8601 format (simplified UTC)
    // Days since Unix epoch
    let days = secs / 86400;
    let remaining = secs % 86400;
    let hours = remaining / 3600;
    let minutes = (remaining % 3600) / 60;
    let seconds = remaining % 60;

    // Calculate year, month, day from days since epoch (1970-01-01)
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

fn is_leap_year(year: i32) -> bool {
    (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0)
}

/// Summary information about a saved review (for listing on start screen)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReviewSummary {
    pub comparison: Comparison,
    #[serde(rename = "totalHunks")]
    pub total_hunks: usize,
    #[serde(rename = "trustedHunks")]
    pub trusted_hunks: usize,
    #[serde(rename = "approvedHunks")]
    pub approved_hunks: usize,
    #[serde(rename = "reviewedHunks")]
    pub reviewed_hunks: usize,
    #[serde(rename = "rejectedHunks")]
    pub rejected_hunks: usize,
    #[serde(rename = "savedForLaterHunks")]
    pub saved_for_later_hunks: usize,
    /// High-risk hunks with no explicit decision yet — the ones to look at.
    #[serde(rename = "highRiskPendingHunks")]
    pub high_risk_pending_hunks: usize,
    /// Review state: "approved", "changes_requested", or null (in progress)
    pub state: Option<String>,
    /// True when the review file exists but could not be read (parse/migration
    /// failure). Surfaced so a broken review stays visible instead of silently
    /// vanishing from the list; opening it still fails loudly.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub unreadable: bool,
    #[serde(rename = "updatedAt")]
    pub updated_at: String,
    /// Optional GitHub PR reference
    #[serde(rename = "githubPr", default, skip_serializing_if = "Option::is_none")]
    pub github_pr: Option<crate::sources::github::GitHubPrRef>,
    /// Path to the review-managed worktree, if one was created.
    #[serde(
        rename = "worktreePath",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub worktree_path: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Pattern matching tests are now in crate::trust::matching::tests
    // These tests verify ReviewState integration with pattern matching

    fn test_comparison() -> Comparison {
        Comparison::new("main", "HEAD")
    }

    #[test]
    fn test_review_state_new() {
        let comparison = test_comparison();
        let state = ReviewState::new(comparison.clone());

        assert_eq!(state.comparison.key, "main..HEAD");
        assert!(state.hunks.is_empty());
        // All taxonomy patterns are enabled by default
        assert!(!state.trust_list.is_empty());
        assert!(state.trust_list.contains(&"imports:added".to_string()));
        assert!(state
            .trust_list
            .contains(&"formatting:whitespace".to_string()));
        assert!(state.notes.is_empty());
        assert!(state.annotations.is_empty());
    }

    #[test]
    fn test_review_state_to_summary_empty() {
        let state = ReviewState::new(test_comparison());
        let summary = state.to_summary();

        assert_eq!(summary.total_hunks, 0);
        assert_eq!(summary.reviewed_hunks, 0);
    }

    #[test]
    fn test_review_state_to_summary_with_approved_hunks() {
        let mut state = ReviewState::new(test_comparison());
        state.total_diff_hunks = 2;

        // Add an approved hunk
        state.hunks.insert(
            "file.rs:abc123".to_string(),
            HunkState {
                status: Some(Attributed::new(HunkStatus::Approved, Source::Ui)),
                ..Default::default()
            },
        );

        // Add a pending hunk
        state
            .hunks
            .insert("file.rs:def456".to_string(), HunkState::default());

        let summary = state.to_summary();
        assert_eq!(summary.total_hunks, 2);
        assert_eq!(summary.reviewed_hunks, 1);
    }

    #[test]
    fn test_review_state_to_summary_with_trusted_labels() {
        let mut state = ReviewState::new(test_comparison());
        state.total_diff_hunks = 2;
        state.trust_list = vec!["imports:*".to_string()];

        // Add a hunk with trusted label (should count as reviewed)
        state.hunks.insert(
            "file.rs:abc123".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["imports:added".to_string()],
                    Source::Static,
                )),
                ..Default::default()
            },
        );

        // Add a hunk with non-trusted label
        state.hunks.insert(
            "file.rs:def456".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["code:logic".to_string()],
                    Source::Static,
                )),
                ..Default::default()
            },
        );

        let summary = state.to_summary();
        assert_eq!(summary.total_hunks, 2);
        assert_eq!(summary.reviewed_hunks, 1);
    }

    #[test]
    fn test_high_risk_vetoes_trust_in_summary() {
        let mut state = ReviewState::new(test_comparison());
        state.total_diff_hunks = 2;
        state.trust_list = vec!["imports:*".to_string()];

        // Trust-listed label but high-risk → must NOT count as trusted.
        state.hunks.insert(
            "file.rs:high".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["imports:added".to_string()],
                    Source::Static,
                )),
                risk: Some(Attributed::new(HunkRisk::High, Source::Agent)),
                ..Default::default()
            },
        );
        // Trust-listed label, low-risk → counts as trusted.
        state.hunks.insert(
            "file.rs:low".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["imports:added".to_string()],
                    Source::Static,
                )),
                risk: Some(Attributed::new(HunkRisk::Low, Source::Agent)),
                ..Default::default()
            },
        );

        let summary = state.to_summary();
        assert_eq!(summary.trusted_hunks, 1);
        assert_eq!(summary.reviewed_hunks, 1);
    }

    #[test]
    fn test_high_risk_pending_counted_in_summary() {
        let mut state = ReviewState::new(test_comparison());
        state.total_diff_hunks = 3;
        state.trust_list = vec!["imports:*".to_string()];

        // High-risk, no decision → pending.
        state.hunks.insert(
            "f:1".to_string(),
            HunkState {
                risk: Some(Attributed::new(HunkRisk::High, Source::Agent)),
                ..Default::default()
            },
        );
        // High-risk but explicitly approved → done, not pending.
        state.hunks.insert(
            "f:2".to_string(),
            HunkState {
                risk: Some(Attributed::new(HunkRisk::High, Source::Agent)),
                status: Some(Attributed::new(HunkStatus::Approved, Source::Ui)),
                ..Default::default()
            },
        );
        // High-risk with a trusted label → still pending (veto).
        state.hunks.insert(
            "f:3".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["imports:added".to_string()],
                    Source::Static,
                )),
                risk: Some(Attributed::new(HunkRisk::High, Source::Agent)),
                ..Default::default()
            },
        );

        let summary = state.to_summary();
        assert_eq!(summary.high_risk_pending_hunks, 2); // f:1 and f:3
        assert_eq!(summary.approved_hunks, 1);
        assert_eq!(summary.trusted_hunks, 0);
    }

    #[test]
    fn test_review_state_to_summary_uses_total_diff_hunks() {
        let mut state = ReviewState::new(test_comparison());
        // Simulate 200 total hunks in the diff but only 2 classified
        state.total_diff_hunks = 200;
        state.trust_list = vec!["imports:*".to_string()];

        state.hunks.insert(
            "file.rs:abc123".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["imports:added".to_string()],
                    Source::Static,
                )),
                ..Default::default()
            },
        );
        state.hunks.insert(
            "file.rs:def456".to_string(),
            HunkState {
                classification: Some(Attributed::new(
                    vec!["code:logic".to_string()],
                    Source::Static,
                )),
                status: Some(Attributed::new(HunkStatus::Approved, Source::Ui)),
                ..Default::default()
            },
        );

        let summary = state.to_summary();
        // total_hunks should use total_diff_hunks (200), not self.hunks.len() (2)
        assert_eq!(summary.total_hunks, 200);
        assert_eq!(summary.trusted_hunks, 1);
        assert_eq!(summary.approved_hunks, 1);
        assert_eq!(summary.reviewed_hunks, 2);
        // Not all 200 hunks are reviewed, so state should be None
        assert!(summary.state.is_none());
    }

    #[test]
    fn test_review_state_to_summary_without_total_diff_hunks_defaults_to_zero() {
        let mut state = ReviewState::new(test_comparison());
        // total_diff_hunks defaults to 0 — progress shows empty until synced

        state.hunks.insert(
            "file.rs:abc123".to_string(),
            HunkState {
                status: Some(Attributed::new(HunkStatus::Approved, Source::Ui)),
                ..Default::default()
            },
        );

        let summary = state.to_summary();
        assert_eq!(summary.total_hunks, 0);
        assert_eq!(summary.approved_hunks, 1);
        assert_eq!(summary.reviewed_hunks, 1);
        // reviewed > total: not "approved" state (incomplete data)
        assert!(summary.state.is_none());
    }

    #[test]
    fn test_chrono_now_format() {
        let timestamp = now_iso8601();
        // Should be ISO 8601 format: YYYY-MM-DDTHH:MM:SS.mmmZ
        assert!(timestamp.contains('T'));
        assert!(timestamp.ends_with('Z'));
        // Check rough format with regex pattern
        assert!(timestamp.len() >= 24); // "2024-01-01T00:00:00.000Z"
    }

    // --- stable identity + carry-forward (reconcile) ---

    // Both diffs add the same line `NEW` to `f.txt`, but with different
    // surrounding context (and line numbers), so their content-hash IDs differ
    // while their stable hashes match.
    const DIFF_A: &str = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,4 @@\n alpha\n beta\n+NEW\n gamma\n";
    const DIFF_B: &str = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -10,3 +10,4 @@\n delta\n epsilon\n+NEW\n zeta\n";

    fn hunk_from(diff: &str) -> DiffHunk {
        crate::diff::parser::parse_multi_file_diff(diff)
            .into_iter()
            .next()
            .expect("expected one hunk")
    }

    fn approved_entry(stable_key: Option<String>) -> HunkState {
        HunkState {
            status: Some(Attributed::new(HunkStatus::Approved, Source::Cli)),
            stable_key,
            ..Default::default()
        }
    }

    #[test]
    fn stable_hash_ignores_context() {
        let a = hunk_from(DIFF_A);
        let b = hunk_from(DIFF_B);
        assert_ne!(a.id, b.id, "different context → different content-hash ID");
        assert_eq!(
            a.stable_hash(),
            b.stable_hash(),
            "same change → same stable hash"
        );
    }

    #[test]
    fn reconcile_carries_decision_forward_on_context_drift() {
        let a = hunk_from(DIFF_A);
        let b = hunk_from(DIFF_B);
        let mut state = ReviewState::new(test_comparison());
        state
            .hunks
            .insert(a.id.clone(), approved_entry(Some(a.stable_hash())));

        // The diff now contains `b` (same change, drifted context) instead of `a`.
        let recon = state.reconcile(&[b.clone()], true);

        assert_eq!(recon.carried_forward, 1);
        assert_eq!(recon.dropped, 0);
        assert!(!state.hunks.contains_key(&a.id), "old ID is gone");
        let migrated = state
            .hunks
            .get(&b.id)
            .expect("decision re-keyed onto live hunk");
        assert!(matches!(
            migrated.status.as_ref().map(|s| &s.value),
            Some(HunkStatus::Approved)
        ));
        assert_eq!(
            migrated.stable_key.as_deref(),
            Some(b.stable_hash().as_str())
        );
    }

    #[test]
    fn reconcile_drops_orphan_without_stable_match() {
        let a = hunk_from(DIFF_A);
        let mut state = ReviewState::new(test_comparison());
        // An old-style entry (no stable key), now orphaned with nothing live.
        state.hunks.insert(a.id.clone(), approved_entry(None));

        let recon = state.reconcile(&[], true);

        assert_eq!(recon.carried_forward, 0);
        assert_eq!(recon.dropped, 1);
        assert!(state.hunks.is_empty());
    }

    #[test]
    fn reconcile_retains_orphan_when_not_dropping() {
        let a = hunk_from(DIFF_A);
        let mut state = ReviewState::new(test_comparison());
        state.hunks.insert(a.id.clone(), approved_entry(None));

        // drop_orphans=false: the hunk is merely absent from this (possibly
        // partial) set, so the decision must be retained, not deleted.
        let recon = state.reconcile(&[], false);

        assert_eq!(recon.carried_forward, 0);
        assert_eq!(recon.dropped, 0);
        assert!(
            state.hunks.contains_key(&a.id),
            "orphan retained against a non-authoritative hunk set"
        );
    }

    #[test]
    fn reconcile_keeps_exact_match_and_stamps_stable_key() {
        let a = hunk_from(DIFF_A);
        let mut state = ReviewState::new(test_comparison());
        state.hunks.insert(a.id.clone(), approved_entry(None));

        let recon = state.reconcile(&[a.clone()], true);

        assert_eq!(recon.carried_forward, 0);
        assert_eq!(recon.dropped, 0);
        assert_eq!(
            state.hunks[&a.id].stable_key.as_deref(),
            Some(a.stable_hash().as_str()),
            "exact-match entries get their stable key stamped for next time"
        );
    }

    #[test]
    fn reconcile_skips_ambiguous_stable_key() {
        let a = hunk_from(DIFF_A);
        let b = hunk_from(DIFF_B);
        assert_eq!(a.stable_hash(), b.stable_hash());
        let mut state = ReviewState::new(test_comparison());
        // An orphan whose stable key matches *two* live hunks — can't safely pick.
        state.hunks.insert(
            "f.txt:deadbeefdeadbeef".to_owned(),
            approved_entry(Some(a.stable_hash())),
        );

        let recon = state.reconcile(&[a.clone(), b.clone()], true);

        assert_eq!(recon.carried_forward, 0, "ambiguous match is not carried");
        assert_eq!(recon.dropped, 1);
    }
}
