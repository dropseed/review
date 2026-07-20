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
    let comparison = resolve_review(&source, ref_name, effective_override)?;
    Ok(ResolvedReview {
        ref_name: ref_name.to_owned(),
        base_override: effective_override.map(str::to_owned),
        comparison,
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
) -> anyhow::Result<Comparison> {
    // 1. Explicit override wins.
    if let Some(base) = base_override {
        return Ok(Comparison::new(base, ref_name));
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
            return Ok(Comparison::new(base, ref_name));
        }
        return Ok(Comparison::new(default_branch, ref_name));
    }

    // 3. Any other resolvable rev: review the one commit.
    if source.resolve_ref(ref_name).is_some() {
        let base = source.resolve_ref_or_empty_tree(&format!("{ref_name}^"));
        return Ok(Comparison::new(base, ref_name));
    }

    // 4. Nothing resolved.
    anyhow::bail!("Could not resolve review ref '{ref_name}'")
}
