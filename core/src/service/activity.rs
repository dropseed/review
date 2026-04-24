//! Local activity listing — enumerate branch activity across registered repos.
//!
//! Backed by `activity_cache`: the first call to `list_all_local_activity`
//! populates the cache; subsequent calls are near-free when no repo state
//! has changed. Watchers call into `activity_cache::refresh_repo` to push
//! scoped deltas rather than triggering a full rescan.

use super::RepoLocalActivity;

/// List all local branch activity across registered repos.
pub fn list_all_local_activity() -> anyhow::Result<Vec<RepoLocalActivity>> {
    super::activity_cache::snapshot_all()
}
