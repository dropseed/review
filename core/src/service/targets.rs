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
    /// The default branch reviewed against its remote tip — i.e. unpushed work.
    DefaultVsRemote,
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
    /// Commits in `base..head`, for labels like "N unpushed". Only computed for
    /// [`BaseReason::DefaultVsRemote`]; `None` elsewhere (or on a git failure).
    #[serde(rename = "aheadCount", skip_serializing_if = "Option::is_none")]
    pub ahead_count: Option<u32>,
}

/// Resolve a review's `ref` (+ optional `base_override`) into a [`Comparison`]
/// against the repo at `repo_path`, and return it wrapped as a [`ResolvedReview`].
pub fn resolve(
    repo_path: &Path,
    ref_name: &str,
    base_override: Option<&str>,
) -> anyhow::Result<ResolvedReview> {
    // Fall back to the persisted override so callers can resolve by ref alone.
    let stored = match base_override {
        Some(_) => None,
        None => storage::load_review_state(repo_path, ref_name)
            .ok()
            .and_then(|state| state.base_override),
    };
    let effective_override = base_override.or(stored.as_deref());

    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    let (comparison, base_reason) = resolve_review(&source, ref_name, effective_override)?;
    // Only the default-vs-remote case has a natural "N unpushed" count to show.
    let ahead_count = match base_reason {
        BaseReason::DefaultVsRemote => {
            source.count_commits_in_range(&comparison.base, &comparison.head)
        }
        _ => None,
    };
    Ok(ResolvedReview {
        ref_name: ref_name.to_owned(),
        base_override: effective_override.map(str::to_owned),
        comparison,
        base_reason,
        ahead_count,
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
/// 1. `base_override` set → `base..ref` verbatim (`""` = empty tree, a snapshot).
/// 2. `ref` is a branch → vs the default branch (or, *for* the default branch,
///    vs `origin/<default>` else `HEAD`). Merge-base is applied later at diff
///    time by [`LocalGitSource::diff_base_ref`], so rebases re-baseline for free.
/// 3. any other resolvable rev (SHA, tag, `stash@{n}`, detached HEAD) → reviewed
///    as a single commit: `{ref}^..{ref}`.
/// 4. otherwise → error.
pub fn resolve_review(
    source: &LocalGitSource,
    ref_name: &str,
    base_override: Option<&str>,
) -> anyhow::Result<(Comparison, BaseReason)> {
    // 1. Explicit override wins.
    if let Some(base) = base_override {
        return Ok((Comparison::new(base, ref_name), BaseReason::Override));
    }

    // 2. A branch (checked specifically, so tags fall through to rule 3).
    if source.is_branch(ref_name) {
        let default_branch = source.get_default_branch()?;
        if ref_name == default_branch {
            // The default branch itself has no branch to diff against; show its
            // working-tree changes vs the remote tip when we have one.
            let origin = format!("origin/{default_branch}");
            let base = source
                .resolve_ref(&origin)
                .map_or_else(|| "HEAD".to_owned(), |_| origin);
            return Ok((Comparison::new(base, ref_name), BaseReason::DefaultVsRemote));
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
    fn default_branch_resolves_as_default_vs_remote() {
        let (_dir, source) = repo();
        let (_c, reason) = resolve_review(&source, "main", None).unwrap();
        assert_eq!(reason, BaseReason::DefaultVsRemote);
    }

    #[test]
    fn feature_branch_resolves_vs_default() {
        let (_dir, source) = repo();
        let (comparison, reason) = resolve_review(&source, "feature", None).unwrap();
        assert_eq!(reason, BaseReason::BranchVsDefault);
        assert_eq!(comparison.base, "main");
    }

    #[test]
    fn explicit_base_resolves_as_override() {
        let (_dir, source) = repo();
        let (_c, reason) = resolve_review(&source, "feature", Some("main")).unwrap();
        assert_eq!(reason, BaseReason::Override);
    }

    #[test]
    fn bare_sha_resolves_as_single_commit() {
        let (_dir, source) = repo();
        let sha = source.resolve_ref("feature").unwrap();
        let (_c, reason) = resolve_review(&source, &sha, None).unwrap();
        assert_eq!(reason, BaseReason::SingleCommit);
    }
}
