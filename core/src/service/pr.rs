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

/// Report which tier a review is currently at.
///
/// A non-PR review is never `Listed` — its ref is by definition already in the
/// repo, so the diff is always available.
pub fn tier(repo_path: &Path, ref_name: &str) -> anyhow::Result<ReviewTierInfo> {
    let state = storage::load_review_state(repo_path, ref_name).ok();
    let worktree_path = state.as_ref().and_then(|s| s.worktree_path.clone());

    if let Some(path) = &worktree_path {
        if Path::new(path).is_dir() {
            return Ok(ReviewTierInfo {
                tier: ReviewTier::Materialized,
                worktree_path,
            });
        }
    }

    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    let github_pr = state.as_ref().and_then(|s| s.github_pr.as_ref());

    let fetched = match github_pr {
        Some(pr) => source.has_pr_ref(pr.number),
        // Not a PR: the ref is local, so the diff is always readable.
        None => source.resolve_ref(ref_name).is_some(),
    };

    Ok(ReviewTierInfo {
        tier: if fetched {
            ReviewTier::Fetched
        } else {
            ReviewTier::Listed
        },
        worktree_path: None,
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
/// survives a restart. Already-materialized reviews return their existing path
/// rather than provisioning a second worktree.
pub fn materialize(repo_path: &Path, ref_name: &str) -> anyhow::Result<String> {
    let mut state = storage::load_review_state(repo_path, ref_name)?;

    if let Some(existing) = &state.worktree_path {
        if Path::new(existing).is_dir() {
            return Ok(existing.clone());
        }
    }

    let source = LocalGitSource::new(repo_path.to_path_buf())?;

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
    storage::save_review_state(repo_path, &state)?;

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
    storage::save_review_state(repo_path, &state)?;
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
    let mut reclaimed = Vec::new();

    for state in states {
        let Some(pr) = state.github_pr.as_ref() else {
            continue;
        };
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
}
