//! History subcommands: `history` and `undo`.
//!
//! Neither keeps a log of its own. Every write to a review moves the version it
//! supersedes into `reviews/history/<review>/v<N>.json` — see
//! [`crate::review::storage::save_review_state`] — so this module reads that
//! directory and diffs adjacent versions to say what each one changed.
//!
//! `undo` restores a snapshot as a **new** version rather than rewinding the
//! counter: git-revert, not reset. Which is also why an undo is itself undoable
//! — its own save snapshots the pre-undo state like any other write.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use clap::Args;
use serde::Serialize;

use crate::review::state::{HunkStatus, ReviewState};
use crate::review::storage::{self, StorageError};

use super::common::{
    load_for_mutation, print_json, resolve_review_arg, ReviewTarget, MAX_SAVE_RETRIES,
};
use super::get_repo_path;

#[derive(Debug, Args)]
pub struct HistoryArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct UndoArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Version to restore (defaults to the newest snapshot — the state as it
    /// was before the most recent change). `review history` lists them.
    #[arg(long, value_name = "N")]
    pub to: Option<u64>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// What changed between two versions of a review: the hunk decisions, and
/// whether the review's other fields moved.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    /// Hunk-status transitions, grouped by what they became and who did it.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    statuses: Vec<StatusChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    trust_list: Option<CountChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    comments: Option<CountChange>,
    notes_changed: bool,
}

impl Changes {
    /// True when the two versions differ in nothing this can describe.
    fn is_empty(&self) -> bool {
        self.statuses.is_empty()
            && self.trust_list.is_none()
            && self.comments.is_none()
            && !self.notes_changed
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusChange {
    /// What the hunks became: "approved", "rejected", "saved", or "cleared".
    action: &'static str,
    /// Who set it. Absent for a clearing — nothing records who cleared a status.
    #[serde(skip_serializing_if = "Option::is_none")]
    source: Option<&'static str>,
    count: usize,
}

#[derive(Debug, Serialize)]
struct CountChange {
    before: usize,
    after: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryEntry {
    version: u64,
    updated_at: String,
    /// True for the live review file; every other entry is a snapshot.
    current: bool,
    /// What this version changed relative to the one before it. Absent on the
    /// oldest entry, which has nothing to compare against.
    #[serde(skip_serializing_if = "Option::is_none")]
    changes: Option<Changes>,
    /// The one-line rendering of `changes`, so a JSON consumer doesn't have to
    /// compose the sentence itself.
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HistoryJson {
    #[serde(rename = "ref")]
    ref_name: String,
    comparison: String,
    entries: Vec<HistoryEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoJson {
    #[serde(rename = "ref")]
    ref_name: String,
    comparison: String,
    /// The version whose contents were restored.
    restored: u64,
    /// The version the restore was written as.
    version: u64,
    changes: Changes,
    summary: String,
}

/// The verb a status reads as in a summary.
fn status_action(status: &HunkStatus) -> &'static str {
    match status {
        HunkStatus::Approved => "approved",
        HunkStatus::Rejected => "rejected",
        HunkStatus::SavedForLater => "saved",
    }
}

/// Diff two versions of a review into a terse account of what changed.
/// Direction matters: `before` → `after`.
///
/// A hunk counts as changed when its decision or that decision's attribution
/// moved — re-approving an already-approved hunk from a different surface is a
/// change, saving the same file twice is not.
fn changes_between(before: &ReviewState, after: &ReviewState) -> Changes {
    let mut grouped: BTreeMap<(&'static str, Option<&'static str>), usize> = BTreeMap::new();

    let ids: BTreeSet<&str> = before
        .hunks
        .keys()
        .chain(after.hunks.keys())
        .map(String::as_str)
        .collect();
    for id in ids {
        let old = before.hunks.get(id).and_then(|h| h.status.as_ref());
        let new = after.hunks.get(id).and_then(|h| h.status.as_ref());
        match (old, new) {
            (None, None) => {}
            (Some(_), None) => *grouped.entry(("cleared", None)).or_default() += 1,
            (old, Some(new)) => {
                let unchanged = old.is_some_and(|old| {
                    status_action(&old.value) == status_action(&new.value)
                        && old.source == new.source
                });
                if !unchanged {
                    *grouped
                        .entry((status_action(&new.value), Some(new.source.as_str())))
                        .or_default() += 1;
                }
            }
        }
    }

    let mut statuses: Vec<StatusChange> = grouped
        .into_iter()
        .map(|((action, source), count)| StatusChange {
            action,
            source,
            count,
        })
        .collect();
    // Biggest group first; ties fall back to the alphabetical order the
    // BTreeMap already gave us.
    statuses.sort_by_key(|s| std::cmp::Reverse(s.count));

    Changes {
        statuses,
        trust_list: count_change(before.trust_list.len(), after.trust_list.len()),
        comments: count_change(before.annotations.len(), after.annotations.len()),
        notes_changed: before.notes != after.notes,
    }
}

/// A count worth mentioning only when it moved.
fn count_change(before: usize, after: usize) -> Option<CountChange> {
    (before != after).then_some(CountChange { before, after })
}

/// One line for what [`changes_between`] found, e.g.
/// "approved 12 (agent), cleared 2, comments 3→4".
fn describe(changes: &Changes) -> String {
    if changes.is_empty() {
        return "no changes".to_owned();
    }
    let mut parts: Vec<String> = changes
        .statuses
        .iter()
        .map(|change| match change.source {
            Some(source) => format!("{} {} ({source})", change.action, change.count),
            None => format!("{} {}", change.action, change.count),
        })
        .collect();
    if let Some(trust) = &changes.trust_list {
        parts.push(format!("trust list {}→{}", trust.before, trust.after));
    }
    if let Some(comments) = &changes.comments {
        parts.push(format!("comments {}→{}", comments.before, comments.after));
    }
    if changes.notes_changed {
        parts.push("notes edited".to_owned());
    }
    parts.join(", ")
}

/// The review's versions, newest first: the live file, then each snapshot, each
/// annotated with what it changed relative to the version before it.
fn collect_history(repo: &Path, ref_name: &str, comparison: &str) -> Result<HistoryJson, String> {
    if !storage::review_exists(repo, ref_name).unwrap_or(false) {
        return Err(format!("No review exists for {ref_name}."));
    }
    let current = storage::load_review_state(repo, ref_name)
        .map_err(|e| format!("Failed to load review: {e}"))?;
    let snapshots = storage::list_review_history(repo, ref_name)
        .map_err(|e| format!("Failed to read review history: {e}"))?;

    // Newest first: the live file, then the snapshots as stored.
    let mut versions: Vec<(u64, ReviewState)> = Vec::with_capacity(snapshots.len() + 1);
    versions.push((current.version, current));
    versions.extend(snapshots.into_iter().map(|s| (s.version, s.state)));

    let entries = versions
        .iter()
        .enumerate()
        .map(|(i, (version, state))| {
            // The version below this one in the list is what it superseded.
            let changes = versions
                .get(i + 1)
                .map(|(_, previous)| changes_between(previous, state));
            HistoryEntry {
                version: *version,
                updated_at: state.updated_at.clone(),
                current: i == 0,
                summary: changes.as_ref().map(describe),
                changes,
            }
        })
        .collect();

    Ok(HistoryJson {
        ref_name: ref_name.to_owned(),
        comparison: comparison.to_owned(),
        entries,
    })
}

/// `review history` — list the review's versions and what each one changed.
pub fn run_history(args: HistoryArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let review = resolve_review_arg(&repo, args.target.spec.as_deref())?;
    let history = collect_history(&repo, &review.ref_name, &review.comparison.key)?;

    if args.json {
        print_json(&history);
        return Ok(());
    }

    println!(
        "{} — {} version(s)\n",
        history.comparison,
        history.entries.len()
    );
    for entry in &history.entries {
        println!(
            "  {:<6} {:<9} {}  {}",
            format!("v{}", entry.version),
            if entry.current { "current" } else { "" },
            entry.updated_at,
            entry
                .summary
                .as_deref()
                .unwrap_or("(earliest recorded version)")
        );
    }
    if history.entries.len() == 1 {
        println!("\nNo earlier versions recorded yet — the next change will keep one.");
    } else {
        println!("\n`review undo [--to N]` restores one as a new version.");
    }
    Ok(())
}

/// `review undo` — restore a snapshot as a new version. The decisions come from
/// the snapshot; the review's worktree and PR pointers stay as they are.
pub fn run_undo(args: UndoArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let (review, hunks, _) = load_for_mutation(&repo, args.target.spec.as_deref())?;
    let ref_name = &review.ref_name;
    if !storage::review_exists(&repo, ref_name).unwrap_or(false) {
        return Err(format!("No review exists for {ref_name}."));
    }

    let (restored, target) = if let Some(version) = args.to {
        let state = storage::load_review_snapshot(&repo, ref_name, version)
            .map_err(|e| format!("Failed to load v{version}: {e}"))?
            .ok_or_else(|| {
                format!(
                    "No v{version} recorded for {ref_name}. `review history` lists what's available."
                )
            })?;
        (version, state)
    } else {
        let newest = storage::list_review_history(&repo, ref_name)
            .map_err(|e| format!("Failed to read review history: {e}"))?
            .into_iter()
            .next()
            .ok_or_else(|| {
                format!("Nothing to undo on {ref_name} — no earlier version is recorded.")
            })?;
        (newest.version, newest.state)
    };

    // Wholesale replacement, so `mutate_review`'s mutate-what-you-loaded shape
    // doesn't fit; the retry against concurrent writers is the same, though.
    for _ in 0..MAX_SAVE_RETRIES {
        let current = storage::load_review_state(&repo, ref_name)
            .map_err(|e| format!("Failed to load review: {e}"))?;
        let mut state = target.clone();
        // The counter comes from disk, never from the snapshot: an undo lands as
        // the next version, so the history it walked stays intact behind it.
        state.version = current.version;
        state.ref_name.clone_from(&current.ref_name);
        // Undo restores review *decisions*. These three are not decisions:
        // two are pointers at things that exist outside the review — a
        // worktree on disk, a PR upstream — where reverting to what a snapshot
        // happened to say would orphan a real directory or forget an
        // association nothing else records. The base override is what the
        // review *compares* (`change-base` is an in-place edit, not a
        // decision), and silently reverting it would hand the restored
        // decisions to a different diff — the one `hunks` below was not loaded
        // against. All three survive an undo by definition, re-read here so a
        // retry sees whatever the concurrent writer left.
        state.worktree_path.clone_from(&current.worktree_path);
        state.github_pr.clone_from(&current.github_pr);
        state.base_override.clone_from(&current.base_override);
        // drop_orphans=true: `hunks` is the authoritative full diff, and the
        // snapshot may predate edits that moved hunks out of it entirely.
        state.reconcile(&hunks, true);
        state.progress = Some(state.measure(&hunks));
        state.prepare_for_save();

        match storage::save_review_state(&repo, &state) {
            Ok(()) => {
                let changes = changes_between(&current, &state);
                let summary = describe(&changes);
                if args.json {
                    print_json(&UndoJson {
                        ref_name: ref_name.clone(),
                        comparison: review.comparison.key.clone(),
                        restored,
                        version: state.version,
                        changes,
                        summary,
                    });
                } else {
                    println!(
                        "Restored v{restored} of {} as v{} — {summary}",
                        review.comparison.key, state.version
                    );
                    println!("`review undo` again to undo this.");
                }
                return Ok(());
            }
            Err(StorageError::VersionConflict { .. }) => {}
            Err(e) => return Err(format!("Failed to save review: {e}")),
        }
    }
    Err("Failed to save review after repeated version conflicts.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, EnvGuard, ENV_LOCK};
    use crate::review::state::{Attributed, HunkState, LineAnnotation, Source};
    use crate::test_git::{git, git_out};
    use tempfile::TempDir;

    fn state_with(statuses: &[(&str, HunkStatus, Source)]) -> ReviewState {
        let mut state = ReviewState::new("feature", None);
        for (id, status, source) in statuses {
            state.hunks.insert(
                (*id).to_owned(),
                HunkState {
                    status: Some(Attributed::new(status.clone(), *source)),
                    ..Default::default()
                },
            );
        }
        state
    }

    #[test]
    fn identical_versions_describe_no_changes() {
        let before = state_with(&[("f:a", HunkStatus::Approved, Source::Cli)]);
        let after = state_with(&[("f:a", HunkStatus::Approved, Source::Cli)]);
        let changes = changes_between(&before, &after);
        assert!(changes.is_empty());
        assert_eq!(describe(&changes), "no changes");
    }

    #[test]
    fn statuses_are_grouped_by_action_and_source() {
        let before = state_with(&[
            ("f:a", HunkStatus::Approved, Source::Cli),
            ("f:b", HunkStatus::Approved, Source::Cli),
        ]);
        let after = state_with(&[
            // f:a keeps its decision but a new agent re-attributed it.
            ("f:a", HunkStatus::Approved, Source::Agent),
            ("f:c", HunkStatus::Approved, Source::Agent),
            ("f:d", HunkStatus::Rejected, Source::Ui),
        ]);

        let changes = changes_between(&before, &after);
        // f:b lost its status; f:a and f:c are agent approvals; f:d a UI rejection.
        assert_eq!(
            describe(&changes),
            "approved 2 (agent), cleared 1, rejected 1 (ui)"
        );
    }

    #[test]
    fn trust_notes_and_comments_are_mentioned_when_they_move() {
        let before = ReviewState::new("feature", None);
        let mut after = before.clone();
        after.trust_list.push("custom:pattern".to_owned());
        after.notes = "looks fine".to_owned();
        after.annotations.push(LineAnnotation {
            id: "f.rs:1:new:t1".to_owned(),
            file_path: "f.rs".to_owned(),
            line_number: 1,
            end_line_number: None,
            side: crate::review::state::AnnotationSide::New,
            content: "hm".to_owned(),
            created_at: "now".to_owned(),
            author: None,
            source: None,
            updated_at: None,
            resolved_at: None,
            resolved_by: None,
        });

        let trust_before = before.trust_list.len();
        let summary = describe(&changes_between(&before, &after));
        assert_eq!(
            summary,
            format!(
                "trust list {trust_before}→{}, comments 0→1, notes edited",
                trust_before + 1
            )
        );
    }

    // --- end-to-end against a real repo and review ---

    /// A repo whose `feature` branch adds a line, plus an isolated REVIEW_HOME.
    /// Returns (guard, review_home, repo, spec).
    fn repo_with_feature() -> (EnvGuard, TempDir, TempDir, String) {
        let (guard, review_home, repo) = setup_test();
        let p = repo.path();
        git(p, &["init", "-q"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "first"]);
        let base = git_out(p, &["rev-parse", "--abbrev-ref", "HEAD"]);
        git(p, &["checkout", "-q", "-b", "feature"]);
        std::fs::write(p.join("a.txt"), "one\ntwo\nthree\n").unwrap();
        git(p, &["commit", "-aqm", "second"]);
        let spec = format!("{base}..feature");
        (guard, review_home, repo, spec)
    }

    fn target(repo: &Path, spec: &str) -> ReviewTarget {
        ReviewTarget {
            repo: Some(repo.to_string_lossy().to_string()),
            spec: Some(spec.to_owned()),
        }
    }

    fn approved_count(repo: &Path) -> usize {
        storage::load_review_state(repo, "feature")
            .unwrap()
            .hunks
            .values()
            .filter(|h| {
                matches!(
                    h.status.as_ref().map(|s| &s.value),
                    Some(HunkStatus::Approved)
                )
            })
            .count()
    }

    #[test]
    fn undo_restores_the_previous_version_forward() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_guard, _home, repo, spec) = repo_with_feature();
        let p = repo.path();

        // v1: approve everything in the diff.
        let (_review, hunks, _live) = load_for_mutation(p, Some(&spec)).unwrap();
        let ids: Vec<String> = hunks.iter().map(|h| h.id.clone()).collect();
        assert!(!ids.is_empty(), "the feature branch should have hunks");
        super::super::review_state::run_mark(
            super::super::review_state::MarkArgs {
                target: target(p, &spec),
                hunks: ids.clone(),
                reason: None,
                source: None,
                json: false,
            },
            HunkStatus::Approved,
        )
        .unwrap();
        assert_eq!(approved_count(p), ids.len());

        // v2: clear them again. That save is what puts v1 in history.
        super::super::review_state::run_unmark(super::super::review_state::MarkArgs {
            target: target(p, &spec),
            hunks: ids.clone(),
            reason: None,
            source: None,
            json: false,
        })
        .unwrap();
        assert_eq!(approved_count(p), 0);

        let history = collect_history(p, "feature", &spec).unwrap();
        assert_eq!(
            history
                .entries
                .iter()
                .map(|e| e.version)
                .collect::<Vec<_>>(),
            vec![2, 1]
        );
        assert!(history.entries[0].current);
        assert!(
            history.entries[0]
                .summary
                .as_deref()
                .unwrap()
                .contains("cleared"),
            "v2 cleared the approvals: {:?}",
            history.entries[0].summary
        );
        assert!(
            history.entries[1].summary.is_none(),
            "the oldest entry has nothing to compare against"
        );

        // Undo restores v1's decisions as v3 — forward, never a rewind.
        run_undo(UndoArgs {
            target: target(p, &spec),
            to: None,
            json: false,
        })
        .unwrap();
        let restored = storage::load_review_state(p, "feature").unwrap();
        assert_eq!(restored.version, 3);
        assert_eq!(approved_count(p), ids.len());

        // And the undo is itself undoable: its own save kept v2.
        run_undo(UndoArgs {
            target: target(p, &spec),
            to: None,
            json: false,
        })
        .unwrap();
        let again = storage::load_review_state(p, "feature").unwrap();
        assert_eq!(again.version, 4);
        assert_eq!(approved_count(p), 0, "back to the cleared state");
    }

    #[test]
    fn undo_can_name_a_version() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_guard, _home, repo, spec) = repo_with_feature();
        let p = repo.path();

        let (_review, hunks, _live) = load_for_mutation(p, Some(&spec)).unwrap();
        let ids: Vec<String> = hunks.iter().map(|h| h.id.clone()).collect();
        for status in [HunkStatus::Approved, HunkStatus::Rejected] {
            super::super::review_state::run_mark(
                super::super::review_state::MarkArgs {
                    target: target(p, &spec),
                    hunks: ids.clone(),
                    reason: None,
                    source: None,
                    json: false,
                },
                status,
            )
            .unwrap();
        }

        // v1 approved, v2 rejected. Naming v1 brings the approvals back.
        run_undo(UndoArgs {
            target: target(p, &spec),
            to: Some(1),
            json: false,
        })
        .unwrap();
        assert_eq!(approved_count(p), ids.len());

        // A version that was never recorded is a clear error, not a no-op.
        let err = run_undo(UndoArgs {
            target: target(p, &spec),
            to: Some(99),
            json: false,
        })
        .unwrap_err();
        assert!(err.contains("No v99"), "{err}");
    }

    /// A worktree on disk and a PR upstream outlive any decision about them, so
    /// undoing back past the moment they were recorded must not un-record them.
    #[test]
    fn undo_keeps_pointers_a_snapshot_predates() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_guard, _home, repo, spec) = repo_with_feature();
        let p = repo.path();

        // v1: approvals, and no pointers yet.
        let (_review, hunks, _live) = load_for_mutation(p, Some(&spec)).unwrap();
        let ids: Vec<String> = hunks.iter().map(|h| h.id.clone()).collect();
        super::super::review_state::run_mark(
            super::super::review_state::MarkArgs {
                target: target(p, &spec),
                hunks: ids.clone(),
                reason: None,
                source: None,
                json: false,
            },
            HunkStatus::Approved,
        )
        .unwrap();

        // v2: the app clears the decisions, attaches a worktree and a PR, and
        // a `change-base` lands.
        let mut state = storage::load_review_state(p, "feature").unwrap();
        state.hunks.values_mut().for_each(|hunk| hunk.status = None);
        state.worktree_path = Some("/tmp/review-worktrees/feature".to_owned());
        state.base_override = Some("main".to_owned());
        state.github_pr = Some(crate::sources::github::GitHubPrRef {
            number: 42,
            title: "Add the thing".to_owned(),
            head_ref_name: "feature".to_owned(),
            base_ref_name: "main".to_owned(),
            body: None,
        });
        state.prepare_for_save();
        storage::save_review_state(p, &state).unwrap();
        assert_eq!(approved_count(p), 0);

        run_undo(UndoArgs {
            target: target(p, &spec),
            to: None,
            json: false,
        })
        .unwrap();

        let restored = storage::load_review_state(p, "feature").unwrap();
        // The decisions came back from v1…
        assert_eq!(approved_count(p), ids.len());
        // …and the pointers v1 never knew about are still here.
        assert_eq!(
            restored.worktree_path.as_deref(),
            Some("/tmp/review-worktrees/feature")
        );
        assert_eq!(restored.github_pr.as_ref().map(|pr| pr.number), Some(42));
        assert_eq!(restored.base_override.as_deref(), Some("main"));
    }

    #[test]
    fn history_and_undo_need_a_review_and_a_snapshot() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_guard, _home, repo, spec) = repo_with_feature();
        let p = repo.path();

        // Nothing saved yet.
        assert!(collect_history(p, "feature", &spec)
            .unwrap_err()
            .contains("No review exists"));
        assert!(run_undo(UndoArgs {
            target: target(p, &spec),
            to: None,
            json: false,
        })
        .unwrap_err()
        .contains("No review exists"));

        // One version saved, so there is a review but nothing behind it.
        let (_review, hunks, _live) = load_for_mutation(p, Some(&spec)).unwrap();
        super::super::review_state::run_mark(
            super::super::review_state::MarkArgs {
                target: target(p, &spec),
                hunks: hunks.iter().map(|h| h.id.clone()).collect(),
                reason: None,
                source: None,
                json: false,
            },
            HunkStatus::Approved,
        )
        .unwrap();

        assert_eq!(
            collect_history(p, "feature", &spec).unwrap().entries.len(),
            1
        );
        assert!(run_undo(UndoArgs {
            target: target(p, &spec),
            to: None,
            json: false,
        })
        .unwrap_err()
        .contains("Nothing to undo"));
    }
}
