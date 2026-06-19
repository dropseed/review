//! Review-state load/save orchestration shared by the desktop app and HTTP
//! server, so reconciliation is wired in exactly one place rather than copied
//! into each command.
//!
//! Both paths reconcile persisted decisions against the current diff (carrying
//! them forward across hunk-ID drift) — on load for display, and before save so
//! the stable keys are (re)stamped. Computing the diff is skipped when the review
//! records no decisions: there is nothing to reconcile, and it avoids a `git
//! diff` on every empty/fresh review.

use std::path::Path;
use std::time::Instant;

use log::debug;

use crate::review::state::ReviewState;
use crate::review::storage;
use crate::service::files::comparison_hunks;
use crate::sources::traits::Comparison;

/// Load a review and carry its decisions forward onto the current diff. Skips the
/// diff computation for a review with no recorded decisions. Reconcile is
/// best-effort: if the diff can't be read, the state is returned unreconciled
/// rather than failing the load.
pub fn load_reconciled_review(repo: &Path, comparison: &Comparison) -> anyhow::Result<ReviewState> {
    let t0 = Instant::now();
    let mut state = storage::load_review_state(repo, comparison)?;
    reconcile_against_diff(repo, &mut state);
    debug!(
        "[load_reconciled_review] {} in {:?}",
        comparison.key,
        t0.elapsed()
    );
    Ok(state)
}

/// Reconcile a review against the current diff, then persist it; returns the new
/// version. Skips the diff computation for a review with no recorded decisions.
pub fn reconcile_and_save(repo: &Path, mut state: ReviewState) -> anyhow::Result<u64> {
    let t0 = Instant::now();
    reconcile_against_diff(repo, &mut state);
    state.prepare_for_save();
    storage::save_review_state(repo, &state)?;
    debug!(
        "[reconcile_and_save] {} v{} in {:?}",
        state.comparison.key,
        state.version,
        t0.elapsed()
    );
    Ok(state.version)
}

/// Reconcile `state.hunks` against the comparison's live diff in place. No-op for
/// an empty review (nothing to carry forward, so the diff isn't computed).
/// Best-effort: a diff that can't be read leaves the state untouched.
fn reconcile_against_diff(repo: &Path, state: &mut ReviewState) {
    if state.hunks.is_empty() {
        return;
    }
    if let Ok(hunks) = comparison_hunks(repo, &state.comparison, state.github_pr.as_ref()) {
        state.reconcile(&hunks);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};
    use crate::review::state::{Attributed, HunkState, HunkStatus, Source};
    use std::process::Command as Cmd;

    fn git(dir: &Path, args: &[&str]) -> String {
        let out = Cmd::new("git")
            .args(args)
            .current_dir(dir)
            .env("GIT_AUTHOR_NAME", "t")
            .env("GIT_AUTHOR_EMAIL", "t@t")
            .env("GIT_COMMITTER_NAME", "t")
            .env("GIT_COMMITTER_EMAIL", "t@t")
            .env("GIT_CONFIG_GLOBAL", "/dev/null")
            .env("GIT_CONFIG_SYSTEM", "/dev/null")
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?} failed");
        String::from_utf8_lossy(&out.stdout).trim().to_owned()
    }

    /// A repo with one commit and an uncommitted addition, plus the working
    /// comparison (`HEAD..<branch>`) covering exactly that change.
    fn dirty_repo(dir: &Path) -> Comparison {
        git(dir, &["init", "-q"]);
        std::fs::write(dir.join("a.txt"), "a\nb\nc\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-qm", "base"]);
        std::fs::write(dir.join("a.txt"), "a\nb\nc\nNEW\n").unwrap();
        let branch = git(dir, &["rev-parse", "--abbrev-ref", "HEAD"]);
        Comparison::new("HEAD", branch)
    }

    #[test]
    fn reconcile_and_save_stamps_stable_key_then_loads() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        let p = repo.path();
        let comparison = dirty_repo(p);

        let id = comparison_hunks(p, &comparison, None).unwrap()[0]
            .id
            .clone();
        let mut state = storage::load_review_state(p, &comparison).unwrap();
        state.hunks.insert(
            id.clone(),
            HunkState {
                status: Some(Attributed::new(HunkStatus::Approved, Source::Ui)),
                ..Default::default()
            },
        );
        let version = reconcile_and_save(p, state).unwrap();
        assert_eq!(version, 1);

        let loaded = load_reconciled_review(p, &comparison).unwrap();
        let hunk_state = loaded.hunks.get(&id).expect("approved hunk persisted");
        assert!(matches!(
            hunk_state.status.as_ref().map(|s| &s.value),
            Some(HunkStatus::Approved)
        ));
        assert!(
            hunk_state.stable_key.is_some(),
            "save should stamp the stable key from the live diff"
        );
    }

    #[test]
    fn empty_review_round_trips_without_a_diff() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _home, repo) = setup_test();
        let p = repo.path();
        let comparison = dirty_repo(p);

        // No decisions recorded: the short-circuit skips reconcile but still saves.
        let state = storage::load_review_state(p, &comparison).unwrap();
        assert!(state.hunks.is_empty());
        assert_eq!(reconcile_and_save(p, state).unwrap(), 1);

        let loaded = load_reconciled_review(p, &comparison).unwrap();
        assert!(loaded.hunks.is_empty());
        assert_eq!(loaded.version, 1);
    }
}
