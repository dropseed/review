//! Worktree lifecycle: what a repo's checkouts are, making one, removing one.
//!
//! The repo picker is the app's one worktree-management surface, so these are
//! the three questions it asks — and the destructive one keeps its safety rules
//! here rather than in either front end, because a UI flag is a stale answer by
//! the time a click lands on it.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde::Serialize;

use crate::sources::local_git::{LocalGitSource, WorktreeCheckout, WorktreeStatus};

/// One repo's worktrees.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoWorktrees {
    pub repo_path: String,
    pub worktrees: Vec<WorktreeStatus>,
}

/// The worktrees of every repo named, in the order they were named.
///
/// Batched because the picker lists every registered repo at once and a round
/// trip per repo was the whole cost of the answer. A repo that no longer opens
/// contributes an empty list rather than an error: it is a stale sidebar entry,
/// not a reason to fail the other twenty.
///
/// Fanned out one thread per repo, as `activity_cache::snapshot_all` does, and
/// for the same reason: each repo is several git processes of its own, the
/// picker mounts unconditionally in the empty state, and run in a row twenty
/// repos cost twenty repos' worth of wall time. The output keeps the order the
/// caller named.
pub fn status(repo_paths: &[String]) -> Vec<RepoWorktrees> {
    std::thread::scope(|s| {
        let handles: Vec<_> = repo_paths
            .iter()
            .map(|repo_path| {
                s.spawn(move || {
                    LocalGitSource::new(PathBuf::from(repo_path))
                        .and_then(|source| source.list_worktree_status())
                        .unwrap_or_default()
                })
            })
            .collect();
        repo_paths
            .iter()
            .zip(handles)
            .map(|(repo_path, handle)| RepoWorktrees {
                repo_path: repo_path.clone(),
                worktrees: handle.join().unwrap_or_default(),
            })
            .collect()
    })
}

/// Give `branch` a checkout, or report the one it already has.
pub fn create(repo_path: &Path, branch: &str) -> Result<WorktreeCheckout> {
    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    Ok(source.worktree_for_branch(branch)?)
}

/// Remove a worktree, refusing the main checkout, a path that isn't this repo's,
/// and anything holding uncommitted work.
pub fn remove(repo_path: &Path, worktree_path: &str) -> Result<()> {
    let source = LocalGitSource::new(repo_path.to_path_buf())?;
    Ok(source.remove_worktree(worktree_path)?)
}
