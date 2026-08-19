//! Pull request materialization.
//!
//! A PR is reviewed in one of three tiers, each a strict superset of the last:
//!
//! 1. **Listed** — `gh pr list` metadata only. No git objects, no cost.
//! 2. **Fetched** — the head commit lives at `refs/review/pr/N`. Everything that
//!    reads a diff works: hunks, classification, trust, comments, guide, symbols.
//! 3. **Materialized** — a worktree exists, so anything needing files on disk
//!    works too: terminals, LSP, staging, agents.
//!
//! Every tier diffs through [`LocalGitSource`], so hunk hashes are identical at
//! each one — promoting a PR mid-review never disturbs review state.

use std::path::Path;

use anyhow::Context;
use serde::{Deserialize, Serialize};

use crate::review::storage;
use crate::sources::github::{GhCliProvider, GitHubPrRef};
use crate::sources::local_git::LocalGitSource;

/// How much of a review is present locally.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ReviewTier {
    /// Metadata only — the diff has not been fetched.
    Listed,
    /// The diff is available locally; no working tree.
    Fetched,
    /// A worktree exists — terminals, LSP, and staging are available.
    Materialized,
}

/// Tier of a review, plus where its worktree lives when it has one.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewTierInfo {
    pub tier: ReviewTier,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub worktree_path: Option<String>,
}

/// Where a review's files live, or `None` when it has no checkout.
///
/// A worktree the review provisioned for itself wins, but a ref that is simply
/// *already checked out* counts too — including at the repo root. The files are
/// on disk either way, so everything the Materialized tier promises (terminals,
/// LSP, staging) works either way. Resolving this in one place is what keeps a
/// branch you have checked out from reading as "no checkout yet" to whichever
/// caller happened to look only at saved review state.
///
/// A recorded path that no longer exists falls through to the live lookup, so a
/// worktree deleted by hand doesn't strand the review at a tier it can't serve.
///
/// `branch_checkout` is a callback so a caller resolving many refs can answer
/// from a map it already built in one git call, rather than a spawn per review.
pub fn resolve_checkout(
    recorded: Option<&str>,
    ref_name: &str,
    branch_checkout: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    if let Some(path) = recorded {
        if Path::new(path).is_dir() {
            return Some(path.to_owned());
        }
    }
    branch_checkout(ref_name).filter(|path| Path::new(path).is_dir())
}

/// The tier ladder, over already-loaded parts.
///
/// The single definition of what each tier *means*, shared by the authoritative
/// probe in [`tier`] and the cheap per-row derivation in
/// [`crate::review::storage::list_all_reviews_global`]. Keeping one function
/// is what stops the listing and the probe disagreeing about the same review.
///
/// `checkout_path` is the already-resolved answer from [`resolve_checkout`] —
/// present means the files are on disk.
///
/// `is_pr_fetched` is a callback so the listing can answer it from a set it
/// already built in one git call, rather than a spawn per review.
pub fn tier_from_parts(
    checkout_path: Option<&str>,
    github_pr: Option<&GitHubPrRef>,
    is_pr_fetched: impl Fn(u32) -> bool,
) -> ReviewTier {
    if checkout_path.is_some() {
        return ReviewTier::Materialized;
    }
    match github_pr {
        Some(pr) if !is_pr_fetched(pr.number) => ReviewTier::Listed,
        // Either not a PR — the ref is local by definition — or a PR whose head
        // is fetched. Both mean the diff is readable.
        _ => ReviewTier::Fetched,
    }
}

/// Report which tier a review is currently at.
pub fn tier(repo_path: &Path, ref_name: &str) -> anyhow::Result<ReviewTierInfo> {
    let state = storage::load_review_state(repo_path, ref_name).ok();
    let recorded = state.as_ref().and_then(|s| s.worktree_path.clone());
    let github_pr = state.as_ref().and_then(|s| s.github_pr.as_ref());

    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    let checkouts = source.checkouts_by_branch();
    let checkout_path = resolve_checkout(recorded.as_deref(), ref_name, |name| {
        checkouts.get(name).cloned()
    });
    let tier = tier_from_parts(checkout_path.as_deref(), github_pr, |number| {
        source.has_pr_ref(number)
    });

    Ok(ReviewTierInfo {
        worktree_path: checkout_path,
        tier,
    })
}

/// Fetch a PR's head (and base) so it can be diffed locally — the Listed →
/// Fetched promotion. Idempotent and cheap to repeat: re-fetching picks up new
/// commits pushed to the PR.
pub fn fetch(repo_path: &Path, pr: &GitHubPrRef) -> anyhow::Result<String> {
    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    source
        .fetch_pr(pr.number, &pr.base_ref_name)
        .with_context(|| format!("Failed to fetch PR #{}", pr.number))
}

/// Materialize a review into a worktree — the Fetched → Materialized promotion.
///
/// Returns the worktree path, and records it on the review state so the tier
/// survives a restart. A review whose files are already on disk returns that
/// path rather than provisioning a second checkout of the same ref.
pub fn materialize(repo_path: &Path, ref_name: &str) -> anyhow::Result<String> {
    let mut state = storage::load_review_state(repo_path, ref_name)?;
    let source = LocalGitSource::new(repo_path.to_path_buf())?;

    let checkouts = source.checkouts_by_branch();
    if let Some(existing) = resolve_checkout(state.worktree_path.as_deref(), ref_name, |name| {
        checkouts.get(name).cloned()
    }) {
        // Deliberately not recorded on the review state when it's a checkout the
        // review didn't create: `worktree_path` is what release/remove act on,
        // and reclaiming a checkout we merely borrowed — the repo root, most of
        // all — is not ours to do.
        return Ok(existing);
    }

    // A PR's head branch may not exist in this repo (fork PRs), so the worktree
    // is created from whatever ref the diff is already reading.
    let checkout_ref = match &state.github_pr {
        Some(pr) if source.has_pr_ref(pr.number) => LocalGitSource::pr_ref(pr.number),
        _ => ref_name.to_owned(),
    };

    let info = source
        .create_review_worktree(ref_name, &checkout_ref)
        .with_context(|| format!("Failed to create worktree for '{ref_name}'"))?;

    state.worktree_path = Some(info.path.clone());
    crate::service::review_io::save_review(repo_path, state, None)?;

    Ok(info.path)
}

/// Drop a review's worktree, keeping its review state. The inverse of
/// [`materialize`] — demotes Materialized → Fetched.
pub fn release(repo_path: &Path, ref_name: &str) -> anyhow::Result<()> {
    let mut state = storage::load_review_state(repo_path, ref_name)?;
    let Some(worktree_path) = state.worktree_path.clone() else {
        return Ok(());
    };

    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    // A worktree the user already deleted by hand shouldn't block clearing the
    // pointer to it.
    let _ = source.remove_review_worktree(&worktree_path);

    state.worktree_path = None;
    crate::service::review_io::save_review(repo_path, state, None)?;
    Ok(())
}

/// Release the worktrees and fetched refs of PR reviews whose PR has merged or
/// closed. Review state is left intact — the record outlives the disk.
///
/// Returns the refs that were reclaimed. Best-effort throughout: a PR whose
/// status can't be read (offline, `gh` missing) is simply skipped.
pub fn reclaim_closed(repo_path: &Path) -> anyhow::Result<Vec<String>> {
    let states = storage::list_saved_reviews(repo_path)?;
    let provider = GhCliProvider::new(repo_path.to_path_buf());
    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    // One spawn to learn what is still on disk. Without this the sweep costs a
    // `gh` round trip per PR review *ever* saved — review records outlive the
    // disk they're reclaimed from, so already-reclaimed PRs would be re-queried
    // forever and the cost would grow with history rather than with work to do.
    let fetched_prs = source.fetched_pr_numbers();
    let mut reclaimed = Vec::new();

    for state in states {
        let Some(pr) = state.github_pr.as_ref() else {
            continue;
        };
        let has_worktree = state
            .worktree_path
            .as_deref()
            .is_some_and(|path| Path::new(path).is_dir());
        if !has_worktree && !fetched_prs.contains(&pr.number) {
            continue;
        }
        let Ok(status) = provider.get_pr_status(pr.number) else {
            continue;
        };
        if status.state == "OPEN" {
            continue;
        }

        if state.worktree_path.is_some() {
            let _ = release(repo_path, &state.ref_name);
        }
        let _ = source.prune_pr_ref(pr.number);
        reclaimed.push(state.ref_name.clone());
    }

    Ok(reclaimed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::tests::{setup_test, ENV_LOCK};
    use crate::review::state::ReviewState;
    use std::path::PathBuf;
    use std::process::Command;

    fn run_git_cmd(dir: &Path, args: &[&str]) -> String {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("run git");
        assert!(
            out.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&out.stderr)
        );
        String::from_utf8_lossy(&out.stdout).into_owned()
    }

    /// A PR review climbs listed -> fetched -> materialized, and releasing
    /// walks it back down without destroying the review record.
    #[test]
    fn tier_tracks_what_is_actually_on_disk() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        let repo_path = repo_dir.path();
        run_git_cmd(repo_path, &["init"]);
        run_git_cmd(repo_path, &["commit", "--allow-empty", "-m", "init"]);
        let head_sha = run_git_cmd(repo_path, &["rev-parse", "HEAD"])
            .trim()
            .to_owned();

        // A PR review whose head hasn't been fetched: metadata only.
        let mut state = ReviewState::new("feature", Some("main".to_owned()));
        state.github_pr = Some(GitHubPrRef {
            number: 5,
            title: "Add a thing".to_owned(),
            head_ref_name: "feature".to_owned(),
            base_ref_name: "main".to_owned(),
            body: None,
        });
        storage::save_review_state(repo_path, &state).unwrap();

        assert_eq!(tier(repo_path, "feature").unwrap().tier, ReviewTier::Listed);

        // Fetching the head is what makes the diff readable.
        run_git_cmd(
            repo_path,
            &["update-ref", &LocalGitSource::pr_ref(5), &head_sha],
        );
        assert_eq!(
            tier(repo_path, "feature").unwrap().tier,
            ReviewTier::Fetched
        );

        // Materializing records the worktree, so the tier survives a restart.
        let worktree_path = materialize(repo_path, "feature").unwrap();
        let info = tier(repo_path, "feature").unwrap();
        assert_eq!(info.tier, ReviewTier::Materialized);
        assert_eq!(info.worktree_path.as_deref(), Some(worktree_path.as_str()));

        // Materializing twice reuses the checkout rather than provisioning a
        // second one for the same review.
        assert_eq!(materialize(repo_path, "feature").unwrap(), worktree_path);

        release(repo_path, "feature").unwrap();
        assert_eq!(
            tier(repo_path, "feature").unwrap().tier,
            ReviewTier::Fetched
        );
        assert!(
            storage::load_review_state(repo_path, "feature")
                .unwrap()
                .github_pr
                .is_some(),
            "releasing the checkout must keep the review record"
        );
    }

    /// A review of an ordinary local ref is never `Listed` — its ref is already
    /// in the repo, so there is nothing to fetch.
    #[test]
    fn non_pr_review_is_always_at_least_fetched() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        let repo_path = repo_dir.path();
        run_git_cmd(repo_path, &["init"]);
        run_git_cmd(repo_path, &["commit", "--allow-empty", "-m", "init"]);
        run_git_cmd(repo_path, &["branch", "topic"]);

        let state = ReviewState::new("topic", None);
        storage::save_review_state(repo_path, &state).unwrap();

        assert_eq!(tier(repo_path, "topic").unwrap().tier, ReviewTier::Fetched);
    }

    /// The branch you already have checked out is materialized — the repo root
    /// is a worktree like any other. Without this, reviewing the branch you are
    /// standing on offers to create a second checkout of it.
    #[test]
    fn a_ref_checked_out_at_the_repo_root_is_already_materialized() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        let repo_path = repo_dir.path();
        run_git_cmd(repo_path, &["init"]);
        run_git_cmd(repo_path, &["commit", "--allow-empty", "-m", "init"]);
        let head_branch = run_git_cmd(repo_path, &["branch", "--show-current"])
            .trim()
            .to_owned();

        let state = ReviewState::new(&head_branch, None);
        storage::save_review_state(repo_path, &state).unwrap();

        let info = tier(repo_path, &head_branch).unwrap();
        assert_eq!(info.tier, ReviewTier::Materialized);
        assert_eq!(
            info.worktree_path
                .map(|p| PathBuf::from(p).canonicalize().unwrap()),
            Some(repo_path.canonicalize().unwrap()),
        );

        // Materializing is a no-op that hands back the root, and must not claim
        // it on the review state — release/remove act on that field.
        let path = materialize(repo_path, &head_branch).unwrap();
        assert_eq!(
            PathBuf::from(path).canonicalize().unwrap(),
            repo_path.canonicalize().unwrap()
        );
        assert!(
            storage::load_review_state(repo_path, &head_branch)
                .unwrap()
                .worktree_path
                .is_none(),
            "the repo root is borrowed, not a checkout this review owns"
        );
    }
}
