//! Review runs and findings: the persistent record of an (AI) review pass.
//!
//! A [`ReviewRun`] records that a review pass ran over the comparison — the
//! tool, model, and a summary of what it concluded. A [`Finding`]
//! is one issue a run raised: typed, severity-rated, evidence-backed, anchored
//! to a file/line/hunk. Findings carry an **append-only** disposition event log
//! ([`DispositionEvent`]) rather than a mutable status field; the current status
//! is *derived* from the last event (see [`Finding::derived_status`]). The log is
//! the history — resolving, reopening, and re-resolving all append.
//!
//! These live on [`ReviewState`](super::state::ReviewState) as the `runs` and
//! `findings` fields, both defaulted so pre-findings review files load unchanged.

use serde::{Deserialize, Serialize};

use super::state::{AnnotationSide, Source};

/// A record that a review pass ran over the comparison: the tool, model, and a
/// summary of what it examined and concluded.
///
/// Deliberately no per-hunk coverage field. In local dev the diff is molten —
/// `/pre-review` fixes bugs and re-runs evidence before submitting — so any
/// snapshot of "hunks present" misrepresents what was actually reviewed. The
/// honest local coverage story is the `summary` plus the findings' own anchored
/// evidence. A verifiable coverage attestation belongs on the PR/CI side, where
/// the diff is frozen and "this run ran against this exact diff" is checkable.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewRun {
    /// Store-assigned ID (same style as annotations: a non-hex `t…` suffix).
    pub id: String,
    /// The tool that produced the run, e.g. "claude-code/code-review".
    pub tool: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    /// The run summary: what ran and what it concluded.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub source: Source,
    pub created_at: String,
}

/// A single issue raised by a run (or a standalone agent).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Finding {
    /// Store-assigned ID.
    pub id: String,
    /// The producer's own ID, if it sent one. Kept separate from our `id` on
    /// purpose — it's the producer's namespace, not ours.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub producer_id: Option<String>,
    /// The run this finding belongs to, if any.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
    pub kind: FindingKind,
    pub severity: FindingSeverity,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confidence: Option<FindingConfidence>,
    /// One-line summary of the issue.
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suggestion: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub evidence: Vec<Evidence>,
    pub anchor: FindingAnchor,
    /// Append-only disposition log. Empty means the finding is open.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub events: Vec<DispositionEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    pub source: Source,
    pub created_at: String,
}

/// Where a finding is anchored in the diff. A `None` `line_number` is a
/// file-level finding.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FindingAnchor {
    pub file_path: String,
    /// 1-based line number (like annotations); `None` = file-level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_number: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub end_line_number: Option<u32>,
    #[serde(default)]
    pub side: AnnotationSide,
    /// The stable hunk identity (`filepath:hash`) this anchor fell inside at
    /// submit time, if any. Best-effort — `None` when the line matched no hunk.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hunk_id: Option<String>,
    /// The matched hunk's drift-stable identity (`DiffHunk::stable_hash()`) at
    /// submit time — mirrors `HunkState::stable_key`, so a future reconcile can
    /// carry the finding forward when surrounding code shifts. `None` when no
    /// hunk matched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stable_key: Option<String>,
}

/// A piece of supporting evidence for a finding or a disposition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    pub kind: EvidenceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
}

/// One entry in a finding's append-only disposition log.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DispositionEvent {
    pub action: DispositionAction,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub actor: Option<String>,
    pub source: Source,
    pub at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub evidence: Option<Evidence>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FindingKind {
    Bug,
    Risk,
    Question,
    Improvement,
}

impl FindingKind {
    pub fn as_str(self) -> &'static str {
        match self {
            FindingKind::Bug => "bug",
            FindingKind::Risk => "risk",
            FindingKind::Question => "question",
            FindingKind::Improvement => "improvement",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FindingSeverity {
    High,
    Medium,
    Low,
}

impl FindingSeverity {
    pub fn as_str(self) -> &'static str {
        match self {
            FindingSeverity::High => "high",
            FindingSeverity::Medium => "medium",
            FindingSeverity::Low => "low",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FindingConfidence {
    Confirmed,
    Plausible,
}

impl FindingConfidence {
    pub fn as_str(self) -> &'static str {
        match self {
            FindingConfidence::Confirmed => "confirmed",
            FindingConfidence::Plausible => "plausible",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EvidenceKind {
    Command,
    Test,
    Trace,
    Reasoning,
}

impl EvidenceKind {
    pub fn as_str(self) -> &'static str {
        match self {
            EvidenceKind::Command => "command",
            EvidenceKind::Test => "test",
            EvidenceKind::Trace => "trace",
            EvidenceKind::Reasoning => "reasoning",
        }
    }
}

/// How a finding was disposed of. `Reopened` returns a resolved finding to open.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DispositionAction {
    Fixed,
    FalsePositive,
    AcceptedRisk,
    Deferred,
    Reopened,
}

impl DispositionAction {
    /// The kebab-case wire name, for display and JSON `status`/`resolution`.
    pub fn as_str(self) -> &'static str {
        match self {
            DispositionAction::Fixed => "fixed",
            DispositionAction::FalsePositive => "false-positive",
            DispositionAction::AcceptedRisk => "accepted-risk",
            DispositionAction::Deferred => "deferred",
            DispositionAction::Reopened => "reopened",
        }
    }
}

/// A finding's status, derived from its event log.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DerivedStatus {
    Open,
    /// Resolved, carrying the last event's disposition.
    Resolved(DispositionAction),
}

impl DerivedStatus {
    pub fn is_open(self) -> bool {
        matches!(self, DerivedStatus::Open)
    }

    /// "open" or "resolved" — the coarse status label.
    pub fn label(self) -> &'static str {
        match self {
            DerivedStatus::Open => "open",
            DerivedStatus::Resolved(_) => "resolved",
        }
    }

    /// The resolving action's name when resolved; `None` when open.
    pub fn resolution(self) -> Option<&'static str> {
        match self {
            DerivedStatus::Open => None,
            DerivedStatus::Resolved(action) => Some(action.as_str()),
        }
    }
}

impl Finding {
    /// Derive the current status from the append-only event log: open when the
    /// log is empty or the last event is `Reopened`; otherwise resolved with the
    /// last event's action.
    pub fn derived_status(&self) -> DerivedStatus {
        match self.events.last() {
            None => DerivedStatus::Open,
            Some(event) => match event.action {
                DispositionAction::Reopened => DerivedStatus::Open,
                action => DerivedStatus::Resolved(action),
            },
        }
    }

    /// Whether the finding is currently open.
    pub fn is_open(&self) -> bool {
        self.derived_status().is_open()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(action: DispositionAction) -> DispositionEvent {
        DispositionEvent {
            action,
            actor: None,
            source: Source::Agent,
            at: "2026-01-01T00:00:00.000Z".to_owned(),
            reason: None,
            evidence: None,
        }
    }

    fn finding_with(events: Vec<DispositionEvent>) -> Finding {
        Finding {
            id: "finding:t1-0".to_owned(),
            producer_id: None,
            run_id: None,
            kind: FindingKind::Bug,
            severity: FindingSeverity::High,
            confidence: Some(FindingConfidence::Confirmed),
            title: "t".to_owned(),
            body: None,
            suggestion: None,
            evidence: Vec::new(),
            anchor: FindingAnchor {
                file_path: "src/a.rs".to_owned(),
                line_number: Some(1),
                end_line_number: None,
                side: AnnotationSide::New,
                hunk_id: None,
                stable_key: None,
            },
            events,
            author: None,
            source: Source::Agent,
            created_at: "2026-01-01T00:00:00.000Z".to_owned(),
        }
    }

    #[test]
    fn empty_events_is_open() {
        assert_eq!(finding_with(vec![]).derived_status(), DerivedStatus::Open);
    }

    #[test]
    fn fixed_is_resolved() {
        let f = finding_with(vec![event(DispositionAction::Fixed)]);
        assert_eq!(
            f.derived_status(),
            DerivedStatus::Resolved(DispositionAction::Fixed)
        );
    }

    #[test]
    fn fixed_then_reopened_is_open() {
        let f = finding_with(vec![
            event(DispositionAction::Fixed),
            event(DispositionAction::Reopened),
        ]);
        assert_eq!(f.derived_status(), DerivedStatus::Open);
    }

    #[test]
    fn fixed_reopened_false_positive_is_resolved_false_positive() {
        let f = finding_with(vec![
            event(DispositionAction::Fixed),
            event(DispositionAction::Reopened),
            event(DispositionAction::FalsePositive),
        ]);
        assert_eq!(
            f.derived_status(),
            DerivedStatus::Resolved(DispositionAction::FalsePositive)
        );
    }

    #[test]
    fn disposition_action_kebab_roundtrip() {
        // The kebab renames the CLI and JSON depend on.
        assert_eq!(
            serde_json::to_string(&DispositionAction::FalsePositive).unwrap(),
            "\"false-positive\""
        );
        assert_eq!(
            serde_json::to_string(&DispositionAction::AcceptedRisk).unwrap(),
            "\"accepted-risk\""
        );
        let parsed: DispositionAction = serde_json::from_str("\"accepted-risk\"").unwrap();
        assert_eq!(parsed, DispositionAction::AcceptedRisk);
    }
}
