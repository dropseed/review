//! Per-repo cache of `RepoLocalActivity` keyed by a cheap fingerprint.
//!
//! Watchers call `refresh_and_emit` on each event; git is only re-invoked when
//! the fingerprint diverges, and an outgoing event is only produced when the
//! newly computed activity actually differs from the cached copy.

use anyhow::Result;
use log::info;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Instant, SystemTime};

use super::{RepoActivityChangedPayload, RepoLocalActivity};
use crate::review::central::{
    compute_repo_id, get_registered_repo, list_registered_repos, RepoIndexEntry,
};
use crate::sources::local_git::LocalGitSource;

/// Files/dirs whose mtime or contents change whenever branch or review state
/// changes. All four are stat-cheap compared to running git.
#[derive(Clone, Default, Debug, PartialEq, Eq)]
struct Fingerprint {
    head_contents: Option<String>,
    refs_heads_mtime: Option<SystemTime>,
    index_mtime: Option<SystemTime>,
    reviews_dir_mtime: Option<SystemTime>,
}

impl Fingerprint {
    fn compute(repo_path: &Path) -> Self {
        let git_dir = repo_path.join(".git");
        Self {
            head_contents: fs::read_to_string(git_dir.join("HEAD")).ok(),
            refs_heads_mtime: dir_max_mtime(
                &git_dir.join("refs").join("heads"),
                DIR_WALK_MAX_DEPTH,
            ),
            index_mtime: file_mtime(&git_dir.join("index")),
            reviews_dir_mtime: reviews_dir_mtime(repo_path),
        }
    }
}

/// Git namespaces under refs/heads/ are rarely deeper than `team/feature/x`,
/// and review-state files sit one level under the reviews dir. Cap the walk
/// so a pathological layout can't inflate per-event fingerprint cost.
const DIR_WALK_MAX_DEPTH: usize = 3;

fn file_mtime(path: &Path) -> Option<SystemTime> {
    fs::metadata(path).ok()?.modified().ok()
}

fn dir_max_mtime(path: &Path, max_depth: usize) -> Option<SystemTime> {
    let mut latest = fs::metadata(path).ok()?.modified().ok()?;
    if max_depth == 0 {
        return Some(latest);
    }
    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if let Ok(m) = meta.modified() {
                    if m > latest {
                        latest = m;
                    }
                }
                if meta.is_dir() {
                    if let Some(child) = dir_max_mtime(&entry.path(), max_depth - 1) {
                        if child > latest {
                            latest = child;
                        }
                    }
                }
            }
        }
    }
    Some(latest)
}

fn reviews_dir_mtime(repo_path: &Path) -> Option<SystemTime> {
    let storage = crate::review::central::get_repo_storage_dir(repo_path).ok()?;
    dir_max_mtime(&storage.join("reviews"), DIR_WALK_MAX_DEPTH)
}

#[derive(Clone)]
struct CachedRepo {
    activity: RepoLocalActivity,
    fingerprint: Fingerprint,
}

static CACHE: LazyLock<Mutex<HashMap<String, CachedRepo>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_cache<R>(f: impl FnOnce(&mut HashMap<String, CachedRepo>) -> R) -> R {
    let mut guard = CACHE.lock().expect("activity_cache CACHE mutex poisoned");
    f(&mut guard)
}

fn build_activity(entry: &RepoIndexEntry) -> Option<RepoLocalActivity> {
    let repo_path = PathBuf::from(&entry.path);
    let source = LocalGitSource::new(repo_path).ok()?;
    let default_branch = source
        .get_default_branch()
        .unwrap_or_else(|_| "main".to_owned());
    let branches = source
        .list_branches_ahead(&default_branch)
        .unwrap_or_default();
    Some(RepoLocalActivity {
        repo_path: entry.path.clone(),
        repo_name: entry.name.clone(),
        default_branch,
        branches,
    })
}

/// Return activity for every registered repo, using the cache when the
/// fingerprint indicates nothing has changed since the last scan.
pub fn snapshot_all() -> Result<Vec<RepoLocalActivity>> {
    let t0 = Instant::now();
    let repos = list_registered_repos()?;
    let (hits, misses, result) = std::thread::scope(|s| {
        let handles: Vec<_> = repos
            .iter()
            .map(|entry| s.spawn(|| compute_cached(entry)))
            .collect();
        let mut hits = 0usize;
        let mut misses = 0usize;
        let mut result = Vec::with_capacity(handles.len());
        for h in handles {
            if let Ok(Some((activity, cache_hit))) = h.join() {
                if cache_hit {
                    hits += 1;
                } else {
                    misses += 1;
                }
                result.push(activity);
            }
        }
        (hits, misses, result)
    });

    info!(
        "[activity_cache::snapshot_all] {} repos ({} hits, {} misses), {} total branches in {:?}",
        result.len(),
        hits,
        misses,
        result.iter().map(|r| r.branches.len()).sum::<usize>(),
        t0.elapsed()
    );
    Ok(result)
}

fn compute_cached(entry: &RepoIndexEntry) -> Option<(RepoLocalActivity, bool)> {
    let repo_path = PathBuf::from(&entry.path);
    let fp = Fingerprint::compute(&repo_path);

    if let Some(cached) = with_cache(|c| c.get(&entry.repo_id).cloned()) {
        if cached.fingerprint == fp {
            return Some((cached.activity, true));
        }
    }

    let activity = build_activity(entry)?;
    with_cache(|c| {
        c.insert(
            entry.repo_id.clone(),
            CachedRepo {
                activity: activity.clone(),
                fingerprint: fp,
            },
        );
    });
    Some((activity, false))
}

/// Refresh a single repo's cached activity. Returns `Some(activity)` **only
/// when the activity actually differs** from the previously cached copy —
/// a fingerprint match or a content-equal rescan both return `None`.
pub fn refresh_repo(repo_path: &Path) -> Result<Option<RepoLocalActivity>> {
    let repo_id = compute_repo_id(repo_path)?;
    let Some(entry) = get_registered_repo(&repo_id)? else {
        return Ok(None);
    };

    let fp = Fingerprint::compute(repo_path);
    let cached = with_cache(|c| c.get(&repo_id).cloned());
    if let Some(ref cached) = cached {
        if cached.fingerprint == fp {
            return Ok(None);
        }
    }

    let Some(activity) = build_activity(&entry) else {
        return Ok(None);
    };

    let changed = cached.as_ref().is_none_or(|c| c.activity != activity);

    with_cache(|c| {
        c.insert(
            repo_id,
            CachedRepo {
                activity: activity.clone(),
                fingerprint: fp,
            },
        );
    });

    Ok(if changed { Some(activity) } else { None })
}

/// Convenience for watcher callbacks: refresh `repo_path` and, if the cache
/// reports a real delta, hand the built `RepoActivityChangedPayload` to
/// `emit`. Errors are logged rather than propagated, since watcher callbacks
/// have nowhere useful to return them.
pub fn refresh_and_emit(repo_path: &str, mut emit: impl FnMut(&RepoActivityChangedPayload)) {
    let path = PathBuf::from(repo_path);
    match refresh_repo(&path) {
        Ok(Some(activity)) => {
            let payload = RepoActivityChangedPayload {
                repo_path: repo_path.to_owned(),
                activity,
            };
            emit(&payload);
        }
        Ok(None) => {}
        Err(e) => log::warn!("[activity_cache] refresh_repo failed for {repo_path}: {e}"),
    }
}

/// Drop a repo's cache entry. Safe to call even if the repo was never cached.
pub fn invalidate(repo_path: &Path) {
    if let Ok(repo_id) = compute_repo_id(repo_path) {
        with_cache(|c| {
            c.remove(&repo_id);
        });
    }
}
