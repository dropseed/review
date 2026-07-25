//! Resolve a review's identity — a ref plus an optional base override — into a
//! concrete [`Comparison`] for the diff pipeline.
//!
//! A review is *of one thing*: a ref (branch, SHA, tag, or `stash@{n}`). The
//! base is derived at read time by the ladder in [`resolve_review`], so a branch
//! review re-baselines naturally as the branch and its default branch move. An
//! explicit `base_override` short-circuits the ladder for the cases a human
//! wants to pin (e.g. a snapshot, or "vs develop").

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;

/// Which arm of the [`resolve_review`] ladder produced a review's base — the
/// intent behind the bare `base..head`, so the UI can label the comparison
/// honestly instead of showing raw refs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum BaseReason {
    /// An explicit base override is pinned (`base..ref` verbatim).
    Override,
    /// A pull request, diffed from its fetched head against its base branch.
    PullRequest,
    /// The default branch reviewed against itself — its uncommitted work.
    TrunkWorkingTree,
    /// A non-default branch reviewed against the default branch.
    BranchVsDefault,
    /// Any other rev (SHA, tag, `stash@{n}`, detached HEAD) reviewed as one commit.
    SingleCommit,
}

/// A resolved review: its identity (`ref` + optional `baseOverride`) alongside
/// the concrete [`Comparison`] the data endpoints diff. Returned by the identity
/// endpoints; the frontend keeps the identity and passes the comparison onward.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedReview {
    #[serde(rename = "ref")]
    pub ref_name: String,
    #[serde(rename = "baseOverride", skip_serializing_if = "Option::is_none")]
    pub base_override: Option<String>,
    pub comparison: Comparison,
    /// Why the base was chosen — lets the UI label the comparison.
    pub base_reason: BaseReason,
}

/// Resolve a review's `ref` (+ optional `base_override`) into a [`Comparison`]
/// against the repo at `repo_path`, and return it wrapped as a [`ResolvedReview`].
pub fn resolve(
    repo_path: &Path,
    ref_name: &str,
    base_override: Option<&str>,
) -> anyhow::Result<ResolvedReview> {
    // Loaded unconditionally: the persisted override is only consulted when the
    // caller didn't pass one, but `github_pr` is needed either way to point the
    // comparison at a fetched PR head.
    let stored = storage::load_review_state(repo_path, ref_name).ok();
    let stored_override = match base_override {
        Some(_) => None,
        None => stored.as_ref().and_then(|s| s.base_override.clone()),
    };
    let effective_override = base_override.or(stored_override.as_deref());

    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    let github_pr = stored.as_ref().and_then(|s| s.github_pr.as_ref());
    let (comparison, base_reason) =
        resolve_review(&source, ref_name, effective_override, github_pr)?;
    Ok(ResolvedReview {
        ref_name: ref_name.to_owned(),
        base_override: effective_override.map(str::to_owned),
        comparison,
        base_reason,
    })
}

/// Set (or clear) a review's persisted `base_override` and return the freshly
/// resolved review. The single writer behind the desktop command, HTTP handler,
/// and CLI — a missing review file is created by [`storage::set_base_override`].
pub fn set_base_override(
    repo_path: &Path,
    ref_name: &str,
    base: Option<String>,
) -> anyhow::Result<ResolvedReview> {
    storage::set_base_override(repo_path, ref_name, base.clone())?;
    resolve(repo_path, ref_name, base.as_deref())
}

/// The base-resolution ladder — the single source of truth for turning a review
/// identity into a diff:
///
/// 0. `github_pr` set and its head fetched → that head vs the PR's base branch.
/// 1. `base_override` set → `base..ref` verbatim (`""` = empty tree, a snapshot).
/// 2. `ref` is a branch → vs the default branch (or, *for* the default branch,
///    vs `origin/<default>` else `HEAD`). Merge-base is applied later at diff
///    time by [`LocalGitSource::diff_base_ref`], so rebases re-baseline for free.
/// 3. any other resolvable rev (SHA, tag, `stash@{n}`, detached HEAD) → reviewed
///    as a single commit: `{ref}^..{ref}`.
/// 4. otherwise → error.
///
/// `github_pr` is a parameter rather than a wrapper function so there is no
/// signature a caller can reach that silently forgets PR substitution.
pub fn resolve_review(
    source: &LocalGitSource,
    ref_name: &str,
    base_override: Option<&str>,
    github_pr: Option<&crate::sources::github::GitHubPrRef>,
) -> anyhow::Result<(Comparison, BaseReason)> {
    // 0. A PR's identity is its head *branch name*, which for a fork PR names no
    // ref in this repo. Once fetched, its head lives at `refs/review/pr/N`, so
    // the comparison diffs that while the review keeps its branch-name identity
    // — and therefore its state file. Falls through when it isn't fetched yet.
    if let Some(pr) = github_pr {
        let pr_ref = LocalGitSource::pr_ref(pr.number);
        if source.resolve_ref(&pr_ref).is_some() {
            let base = base_override.unwrap_or(pr.base_ref_name.as_str());
            return Ok((Comparison::new(base, pr_ref), BaseReason::PullRequest));
        }
    }

    // 1. Explicit override wins.
    if let Some(base) = base_override {
        return Ok((Comparison::new(base, ref_name), BaseReason::Override));
    }

    // 2. A branch (checked specifically, so tags fall through to rule 3).
    if source.is_branch(ref_name) {
        let default_branch = source.get_default_branch()?;
        if ref_name == default_branch {
            // The trunk has no fork point to diff from, so reviewing it means
            // reviewing its uncommitted work: `ref..ref`, which the diff layer
            // resolves against the working tree when the trunk is checked out.
            // Defaulting to `origin/<default>` instead would let push state
            // decide what you review — pushing would silently empty the review
            // and committing would silently grow it. "vs origin" is still one
            // base override away; it just isn't the default.
            return Ok((
                Comparison::new(ref_name, ref_name),
                BaseReason::TrunkWorkingTree,
            ));
        }
        return Ok((
            Comparison::new(default_branch, ref_name),
            BaseReason::BranchVsDefault,
        ));
    }

    // 3. Any other resolvable rev: review the one commit.
    if source.resolve_ref(ref_name).is_some() {
        let base = source.resolve_ref_or_empty_tree(&format!("{ref_name}^"));
        return Ok((Comparison::new(base, ref_name), BaseReason::SingleCommit));
    }

    // 4. Nothing resolved.
    anyhow::bail!("Could not resolve review ref '{ref_name}'")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let status = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("run git");
        assert!(
            status.status.success(),
            "git {args:?} failed: {}",
            String::from_utf8_lossy(&status.stderr)
        );
    }

    /// A repo on `main` with one commit, plus a `feature` branch a commit ahead.
    fn repo() -> (tempfile::TempDir, LocalGitSource) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path();
        git(path, &["init", "-b", "main"]);
        git(path, &["config", "user.email", "me@example.com"]);
        git(path, &["config", "user.name", "Me"]);
        git(path, &["commit", "--allow-empty", "-m", "init"]);
        git(path, &["checkout", "-b", "feature"]);
        git(path, &["commit", "--allow-empty", "-m", "work"]);
        git(path, &["checkout", "main"]);
        let source = LocalGitSource::new(path.to_path_buf()).unwrap();
        (dir, source)
    }

    #[test]
    fn default_branch_resolves_to_its_own_working_tree() {
        let (_dir, source) = repo();
        let (comparison, reason) = resolve_review(&source, "main", None, None).unwrap();
        assert_eq!(reason, BaseReason::TrunkWorkingTree);
        // `main..main` — the diff layer reads this as "uncommitted work".
        assert_eq!(comparison.base, "main");
        assert_eq!(comparison.head, "main");
    }

    /// Push state must not pick the trunk's contents: a repo with an
    /// `origin/main` behind the local tip still reviews only uncommitted work.
    #[test]
    fn default_branch_ignores_the_remote_tip() {
        let (dir, source) = repo();
        let path = dir.path();
        git(path, &["update-ref", "refs/remotes/origin/main", "main"]);
        git(path, &["commit", "--allow-empty", "-m", "unpushed"]);
        let (comparison, reason) = resolve_review(&source, "main", None, None).unwrap();
        assert_eq!(reason, BaseReason::TrunkWorkingTree);
        assert_eq!(comparison.base, "main");
    }

    #[test]
    fn feature_branch_resolves_vs_default() {
        let (_dir, source) = repo();
        let (comparison, reason) = resolve_review(&source, "feature", None, None).unwrap();
        assert_eq!(reason, BaseReason::BranchVsDefault);
        assert_eq!(comparison.base, "main");
    }

    #[test]
    fn explicit_base_resolves_as_override() {
        let (_dir, source) = repo();
        let (_c, reason) = resolve_review(&source, "feature", Some("main"), None).unwrap();
        assert_eq!(reason, BaseReason::Override);
    }

    #[test]
    fn bare_sha_resolves_as_single_commit() {
        let (_dir, source) = repo();
        let sha = source.resolve_ref("feature").unwrap();
        let (_c, reason) = resolve_review(&source, &sha, None, None).unwrap();
        assert_eq!(reason, BaseReason::SingleCommit);
    }
}
