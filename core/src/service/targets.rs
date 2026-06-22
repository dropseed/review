//! Resolve a "review target" — a *kind* of thing to review — into a `Comparison`.
//!
//! These mirror the `review start` flags but live in the service layer so the
//! desktop app and HTTP server can offer the same targets, not just the CLI.
//! Each resolves to an ordinary `Comparison` that flows through the normal diff
//! pipeline (resolving the index/commit/stash to a concrete git object).

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;

/// A kind of thing to review, chosen in the UI (or via `review start` flags).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReviewTarget {
    /// Uncommitted changes only (staged + unstaged + untracked) on the current branch.
    Working,
    /// Staged changes only — the git index, captured as a tree object.
    Staged,
    /// A stash entry's changes vs the commit it was based on.
    Stash { index: u32 },
    /// A single commit, reviewed against its parent.
    Commit { rev: String },
    /// The full tree state at a ref, diffed against the empty tree.
    Snapshot { rev: String },
}

/// Resolve a target into a `Comparison` for the repo at `repo_path`.
pub fn resolve_target(repo_path: &Path, target: &ReviewTarget) -> anyhow::Result<Comparison> {
    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    match target {
        ReviewTarget::Working => Ok(working_comparison(&source)),
        ReviewTarget::Staged => staged_comparison(&source),
        ReviewTarget::Stash { index } => stash_comparison(&source, *index),
        ReviewTarget::Commit { rev } => commit_comparison(&source, rev),
        ReviewTarget::Snapshot { rev } => snapshot_comparison(&source, rev),
    }
}

/// Uncommitted changes only: base is `HEAD` (kept relative so this is a single
/// live review per branch) and head is the current branch, which folds the
/// working tree into the diff.
pub(crate) fn working_comparison(source: &LocalGitSource) -> Comparison {
    let head = source
        .get_current_branch()
        .unwrap_or_else(|_| "HEAD".to_owned());
    Comparison::new("HEAD", head)
}

/// Staged changes only: the index captured via `git write-tree`, reviewed as
/// `HEAD..<index-tree>`. A frozen snapshot of the index at resolution time.
pub(crate) fn staged_comparison(source: &LocalGitSource) -> anyhow::Result<Comparison> {
    let base = source.resolve_ref_or_empty_tree("HEAD");
    let tree = source.write_index_tree()?;
    Ok(Comparison::new(base, tree))
}

/// A stash entry's changes against the commit it was created on (`stash@{n}^1`).
pub(crate) fn stash_comparison(source: &LocalGitSource, index: u32) -> anyhow::Result<Comparison> {
    let stash_ref = format!("stash@{{{index}}}");
    let head = source
        .resolve_ref(&stash_ref)
        .ok_or_else(|| anyhow::anyhow!("No stash entry {stash_ref}"))?;
    let base = source.resolve_ref_or_empty_tree(&format!("{stash_ref}^1"));
    Ok(Comparison::new(base, head))
}

/// A single commit (`parent..rev`), both sides resolved to concrete SHAs. A root
/// commit is compared against the empty tree; a merge against its first parent.
pub(crate) fn commit_comparison(source: &LocalGitSource, rev: &str) -> anyhow::Result<Comparison> {
    let head = source
        .resolve_ref(rev)
        .ok_or_else(|| anyhow::anyhow!("Could not resolve commit '{rev}'"))?;
    let base = source.resolve_ref_or_empty_tree(&format!("{rev}^"));
    Ok(Comparison::new(base, head))
}

/// The full tree at a ref, diffed against the empty tree (every file shows as
/// added). Empty-string base is the empty-tree convention.
pub(crate) fn snapshot_comparison(
    source: &LocalGitSource,
    rev: &str,
) -> anyhow::Result<Comparison> {
    let head = source
        .resolve_ref(rev)
        .ok_or_else(|| anyhow::anyhow!("Could not resolve '{rev}'"))?;
    Ok(Comparison::new("", head))
}
