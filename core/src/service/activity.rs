//! Local activity listing — enumerate branch activity across registered repos.

use anyhow::Context;
use log::info;
use std::path::PathBuf;
use std::time::Instant;

use crate::sources::local_git::LocalGitSource;

use super::RepoLocalActivity;

/// List all local branch activity across registered repos.
pub fn list_all_local_activity() -> anyhow::Result<Vec<RepoLocalActivity>> {
    let t0 = Instant::now();
    let repos = crate::review::central::list_registered_repos()
        .context("Failed to list registered repos")?;
    let mut result = Vec::new();

    std::thread::scope(|s| {
        let handles: Vec<_> = repos
            .iter()
            .map(|repo_entry| {
                s.spawn(|| {
                    let repo_path = PathBuf::from(&repo_entry.path);
                    let source = match LocalGitSource::new(repo_path) {
                        Ok(s) => s,
                        Err(_) => return None, // Skip repos that no longer exist
                    };

                    let default_branch = source
                        .get_default_branch()
                        .unwrap_or_else(|_| "main".to_owned());
                    let branches = source
                        .list_branches_ahead(&default_branch)
                        .unwrap_or_default();

                    Some(RepoLocalActivity {
                        repo_path: repo_entry.path.clone(),
                        repo_name: repo_entry.name.clone(),
                        default_branch,
                        branches,
                    })
                })
            })
            .collect();

        for handle in handles {
            if let Ok(Some(activity)) = handle.join() {
                result.push(activity);
            }
        }
    });

    info!(
        "[list_all_local_activity] {} repos, {} total branches in {:?}",
        result.len(),
        result.iter().map(|r| r.branches.len()).sum::<usize>(),
        t0.elapsed()
    );
    Ok(result)
}
