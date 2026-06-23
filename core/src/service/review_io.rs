//! Review-state load/save orchestration shared by the desktop app and HTTP
//! server, so reconciliation is wired in exactly one place rather than copied
//! into each command.
//!
//! Reconciliation carries persisted decisions forward across hunk-ID drift. It
//! runs against the live hunks the caller already has in hand — the UI loads the
//! diff once for display, so we reconcile against *those* hunks rather than
//! shelling out to a second `git diff`. (The CLI, which has no in-memory diff,
//! reconciles directly via [`crate::review::state::ReviewState::reconcile`] with
//! hunks it loaded itself.)

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::diff::parser::DiffHunk;
use crate::review::state::ReviewState;
use crate::review::storage;

/// A loaded review plus how many decisions reconciliation carried forward onto
/// the current diff — so the UI can surface "N carried forward since the diff
/// changed". The count is transient (not persisted); a later reconcile after a
/// save finds exact ID matches and reports 0.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewLoadResult {
    pub state: ReviewState,
    pub carried_forward: usize,
}

/// Carry a loaded review's decisions forward onto the live diff, returning the
/// reconciled state and how many decisions were carried. In-memory only — the
/// caller persists later (on the next save). A review with no decisions is a
/// no-op: there is nothing to carry forward.
pub fn reconcile_review(mut state: ReviewState, live_hunks: &[DiffHunk]) -> ReviewLoadResult {
    // drop_orphans=false: these are the hunks the UI loaded, which may be
    // incomplete — never delete a decision just because its hunk is absent here.
    let carried_forward = if state.hunks.is_empty() {
        0
    } else {
        state.reconcile(live_hunks, false).carried_forward
    };
    ReviewLoadResult {
        state,
        carried_forward,
    }
}

/// Reconcile against the live hunks (when supplied), then persist; returns the
/// new version. `live_hunks` is `None` only for callers with no diff in hand —
/// e.g. saving a worktree-path change — where there is nothing to reconcile.
pub fn save_review(
    repo: &Path,
    mut state: ReviewState,
    live_hunks: Option<&[DiffHunk]>,
) -> anyhow::Result<u64> {
    if let Some(hunks) = live_hunks {
        if !state.hunks.is_empty() {
            state.reconcile(hunks, false);
        }
    }
    state.prepare_for_save();
    storage::save_review_state(repo, &state)?;
    Ok(state.version)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};
    use crate::review::state::{Attributed, HunkState, HunkStatus, Source};
    use crate::sources::traits::Comparison;

    // Both diffs add the same line to `f.txt` with different surrounding context,
    // so their content-hash IDs differ while their stable hashes match — the
    // carry-forward case.
    const DIFF_A: &str = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -1,3 +1,4 @@\n alpha\n beta\n+NEW\n gamma\n";
    const DIFF_B: &str = "diff --git a/f.txt b/f.txt\n--- a/f.txt\n+++ b/f.txt\n@@ -10,3 +10,4 @@\n delta\n epsilon\n+NEW\n zeta\n";

    fn hunk(diff: &str) -> DiffHunk {
        crate::diff::parser::parse_multi_file_diff(diff)
            .into_iter()
            .next()
            .expect("one hunk")
    }

    fn approved_with_key(key: Option<String>) -> HunkState {
        HunkState {
            status: Some(Attributed::new(HunkStatus::Approved, Source::Ui)),
            stable_key: key,
            ..Default::default()
        }
    }

    #[test]
    fn reconcile_review_carries_drifted_decision_forward() {
        let a = hunk(DIFF_A);
        let b = hunk(DIFF_B);
        assert_ne!(a.id, b.id, "context drift changes the id");

        let mut state = ReviewState::new(Comparison::new("HEAD", "branch"));
        // Decision recorded against A, stamped with A's stable key.
        state
            .hunks
            .insert(a.id.clone(), approved_with_key(Some(a.stable_hash())));

        // Live diff now contains B (same change, shifted context).
        let result = reconcile_review(state, &[b.clone()]);
        assert_eq!(result.carried_forward, 1);
        assert!(
            result.state.hunks.contains_key(&b.id),
            "decision carried onto the live hunk's new id"
        );
    }

    #[test]
    fn reconcile_review_no_decisions_is_a_noop() {
        let state = ReviewState::new(Comparison::new("HEAD", "branch"));
        let result = reconcile_review(state, &[hunk(DIFF_A)]);
        assert_eq!(result.carried_forward, 0);
        assert!(result.state.hunks.is_empty());
    }

    #[test]
    fn save_review_stamps_stable_key_from_live_hunks() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        let p = repo.path();
        let comparison = Comparison::new("HEAD", "branch");
        let a = hunk(DIFF_A);

        let mut state = ReviewState::new(comparison.clone());
        // Decision with no stable key yet (as if just recorded in the UI).
        state.hunks.insert(a.id.clone(), approved_with_key(None));

        let version = save_review(p, state, Some(&[a.clone()])).unwrap();
        assert_eq!(version, 1);

        let loaded = storage::load_review_state(p, &comparison).unwrap();
        assert_eq!(
            loaded.hunks[&a.id].stable_key.as_deref(),
            Some(a.stable_hash().as_str()),
            "save reconciled against the live hunk and stamped its stable key"
        );
    }

    #[test]
    fn save_review_without_hunks_persists_unreconciled() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        let p = repo.path();
        let comparison = Comparison::new("HEAD", "branch");

        let state = ReviewState::new(comparison.clone());
        assert_eq!(save_review(p, state, None).unwrap(), 1);

        let loaded = storage::load_review_state(p, &comparison).unwrap();
        assert_eq!(loaded.version, 1);
    }
}
