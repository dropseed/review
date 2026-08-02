//! Per-repo cache of `RepoLocalActivity` keyed by a cheap fingerprint.
//!
//! Watchers call `refresh_and_emit` on each event; git is re-invoked when the
//! fingerprint diverges or the cached entry ages past `MAX_CACHE_AGE`, and an
//! outgoing event is only produced when the newly computed activity actually
//! differs from the cached copy.
//!
//! The fingerprint is deliberately a *git-metadata* fingerprint, so a match
//! never proves the working tree is unchanged. `MAX_CACHE_AGE` is what covers
//! that gap for repos with no recursive watcher of their own.

use anyhow::Result;
use log::info;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant, SystemTime};

use super::{RepoActivityChangedPayload, RepoLocalActivity};
use crate::review::central::{
    compute_repo_id, get_registered_repo, list_registered_repos, resolve_git_dirs, RepoIndexEntry,
};
use crate::sources::local_git::LocalGitSource;

/// Files/dirs whose mtime or contents change whenever branch or review state
/// changes. All are stat-cheap compared to running git.
#[derive(Clone, Default, Debug, PartialEq, Eq)]
struct Fingerprint {
    head_contents: Option<String>,
    refs_heads_mtime: Option<SystemTime>,
    refs_remotes_mtime: Option<SystemTime>,
    index_mtime: Option<SystemTime>,
    reviews_dir_mtime: Option<SystemTime>,
    /// Covers externally-created linked worktrees (`git worktree add ...`).
    worktrees_dir_mtime: Option<SystemTime>,
    /// `.git/FETCH_HEAD` mtime — ticks even when a fetch updates no refs,
    /// so the "last fetched" stamp surfaces in the sidebar.
    fetch_head_mtime: Option<SystemTime>,
}

impl Fingerprint {
    fn compute(repo_path: &Path) -> Self {
        // In a linked worktree, `.git` is a file whose contents are
        // `gitdir: /path/to/main/.git/worktrees/<name>`. HEAD and index live
        // there; refs/heads and the worktrees/ dir are in the common dir.
        // Resolving both is what makes fingerprints work for linked worktrees.
        let (git_dir, common_dir) = resolve_git_dirs(repo_path);
        Self {
            head_contents: fs::read_to_string(git_dir.join("HEAD")).ok(),
            refs_heads_mtime: dir_max_mtime(
                &common_dir.join("refs").join("heads"),
                DIR_WALK_MAX_DEPTH,
            ),
            refs_remotes_mtime: dir_max_mtime(
                &common_dir.join("refs").join("remotes"),
                DIR_WALK_MAX_DEPTH,
            ),
            index_mtime: file_mtime(&git_dir.join("index")),
            reviews_dir_mtime: reviews_dir_mtime(repo_path),
            worktrees_dir_mtime: dir_max_mtime(&common_dir.join("worktrees"), DIR_WALK_MAX_DEPTH),
            fetch_head_mtime: file_mtime(&common_dir.join("FETCH_HEAD")),
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
    /// When the fingerprint behind this entry was sampled. Serves two jobs:
    /// it ages the entry out (see `MAX_CACHE_AGE`), and it orders concurrent
    /// writers (see `store_if_newer`).
    observed_at: Instant,
}

/// How long a fingerprint match is allowed to stand in for "nothing changed".
///
/// The fingerprint only watches git metadata, so a matching fingerprint proves
/// *git* state is unchanged — it says nothing about unstaged working-tree
/// edits. For the open repo that gap is covered by the recursive watcher, which
/// forces a rebuild on every working-tree event. Every *other* registered repo
/// has only the lightweight `.git`-only watcher, so a periodic forced rebuild
/// is the sole way its dirty state is ever noticed. Bounded to once per repo
/// per window so a burst of snapshot calls still costs one git pass.
const MAX_CACHE_AGE: Duration = Duration::from_secs(60);

static CACHE: LazyLock<Mutex<HashMap<String, CachedRepo>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn with_cache<R>(f: impl FnOnce(&mut HashMap<String, CachedRepo>) -> R) -> R {
    let mut guard = CACHE.lock().expect("activity_cache CACHE mutex poisoned");
    f(&mut guard)
}

/// Publish `candidate` unless the map already holds an entry built from a
/// *later* observation. Returns whether the write landed.
///
/// Rebuilds run outside the lock, so a slow `snapshot_all` thread can finish
/// after a watcher rebuild of the same repo. A blind insert would then pair
/// that thread's older activity with a fingerprint that still matches the repo
/// on disk — and every later event would compare equal against it and
/// short-circuit, pinning the stale row until something else in git moved.
fn store_if_newer(repo_id: &str, candidate: CachedRepo) -> bool {
    with_cache(|c| match c.get(repo_id) {
        Some(existing) if existing.observed_at > candidate.observed_at => false,
        _ => {
            c.insert(repo_id.to_owned(), candidate);
            true
        }
    })
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
    let local_branch_names: std::collections::HashSet<String> =
        branches.iter().map(|b| b.name.clone()).collect();
    let recent_remote_branches = source
        .list_recent_remote_branches(&default_branch, &local_branch_names, 14, 8)
        .unwrap_or_default();
    let last_fetched_at = source.last_fetched_at();
    Some(RepoLocalActivity {
        repo_path: entry.path.clone(),
        repo_name: entry.name.clone(),
        default_branch,
        branches,
        recent_remote_branches,
        last_fetched_at,
    })
}

/// Return activity for every registered repo, using the cache when the
/// fingerprint indicates nothing has changed since the last scan and the
/// cached entry is younger than `MAX_CACHE_AGE`.
pub fn snapshot_all() -> Result<Vec<RepoLocalActivity>> {
    snapshot_all_within(MAX_CACHE_AGE)
}

fn snapshot_all_within(max_age: Duration) -> Result<Vec<RepoLocalActivity>> {
    let t0 = Instant::now();
    let repos = list_registered_repos()?;
    let (hits, misses, result) = std::thread::scope(|s| {
        let handles: Vec<_> = repos
            .iter()
            .map(|entry| s.spawn(move || compute_cached(entry, max_age)))
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

fn compute_cached(entry: &RepoIndexEntry, max_age: Duration) -> Option<(RepoLocalActivity, bool)> {
    let repo_path = PathBuf::from(&entry.path);
    let observed_at = Instant::now();
    let fp = Fingerprint::compute(&repo_path);

    if let Some(cached) = with_cache(|c| c.get(&entry.repo_id).cloned()) {
        // A fingerprint match is only trusted inside the age window — past it
        // we rebuild anyway, because working-tree edits never move the
        // fingerprint and this is the only pass that would ever see them.
        if cached.fingerprint == fp
            && observed_at.saturating_duration_since(cached.observed_at) < max_age
        {
            return Some((cached.activity, true));
        }
    }

    let activity = build_activity(entry)?;
    let candidate = CachedRepo {
        activity: activity.clone(),
        fingerprint: fp,
        observed_at,
    };
    if store_if_newer(&entry.repo_id, candidate) {
        return Some((activity, false));
    }
    // A newer rebuild beat us here. Hand back its copy rather than the one we
    // just decided was stale.
    with_cache(|c| c.get(&entry.repo_id).map(|e| (e.activity.clone(), true)))
}

/// What kind of filesystem event is prompting a refresh. Callers report the
/// event; the cache picks the refresh strategy (fingerprint-cached vs forced
/// rebuild), so this decision lives in one place and both watcher surfaces
/// stay consistent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefreshTrigger {
    /// `.git/HEAD`, refs, or index changed — fingerprint catches it.
    GitState,
    /// Review-state files changed — fingerprint catches it via reviews mtime.
    ReviewState,
    /// Working-tree edit (save, delete, untracked add). Fingerprint does NOT
    /// observe unstaged changes, so we force a rebuild and rely on the
    /// content-equality guard to suppress no-op emits.
    WorkingTree,
}

impl RefreshTrigger {
    fn forces_rebuild(self) -> bool {
        matches!(self, Self::WorkingTree)
    }

    /// Pick the right trigger for a debounce window, preferring the
    /// fingerprint-catchable kinds (`GitState`, `ReviewState`) over
    /// `WorkingTree` since those skip a git rebuild when state is unchanged.
    pub fn from_flags(git_state: bool, review: bool, working_tree: bool) -> Option<Self> {
        if git_state {
            Some(Self::GitState)
        } else if review {
            Some(Self::ReviewState)
        } else if working_tree {
            Some(Self::WorkingTree)
        } else {
            None
        }
    }
}

/// Refresh a single repo's cached activity. Returns `Some(activity)` **only
/// when the activity actually differs** from the previously cached copy —
/// a fingerprint match or a content-equal rescan both return `None`.
pub fn refresh_repo(
    repo_path: &Path,
    trigger: RefreshTrigger,
) -> Result<Option<RepoLocalActivity>> {
    let repo_id = compute_repo_id(repo_path)?;
    let Some(entry) = get_registered_repo(&repo_id)? else {
        return Ok(None);
    };

    let observed_at = Instant::now();
    let fp = Fingerprint::compute(repo_path);
    let cached = with_cache(|c| c.get(&repo_id).cloned());
    if !trigger.forces_rebuild() {
        if let Some(ref cached) = cached {
            if cached.fingerprint == fp {
                return Ok(None);
            }
        }
    }

    let Some(activity) = build_activity(&entry) else {
        return Ok(None);
    };

    let changed = cached.as_ref().is_none_or(|c| c.activity != activity);

    // Always attempt the write, even for a no-op rebuild: it restamps
    // `observed_at`, which is what keeps a repo the watcher is actively
    // proving unchanged from paying for an age-triggered rebuild as well.
    let stored = store_if_newer(
        &repo_id,
        CachedRepo {
            activity: activity.clone(),
            fingerprint: fp,
            observed_at,
        },
    );

    // Suppress the emit when a newer rebuild won the write — it already
    // emitted, and publishing our older copy on top would walk the row back.
    Ok(if changed && stored {
        Some(activity)
    } else {
        None
    })
}

/// Convenience for watcher callbacks: refresh `repo_path` and, if the cache
/// reports a real delta, hand the built `RepoActivityChangedPayload` to
/// `emit`. Errors are logged rather than propagated, since watcher callbacks
/// have nowhere useful to return them.
pub fn refresh_and_emit(
    repo_path: &str,
    trigger: RefreshTrigger,
    mut emit: impl FnMut(&RepoActivityChangedPayload),
) {
    match refresh_repo(&PathBuf::from(repo_path), trigger) {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::central::register_repo;
    use crate::review::central::tests::{setup_test, ENV_LOCK};
    use std::process::Command;

    fn git(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .expect("git should be on PATH for these tests");
        assert!(
            out.status.success(),
            "git {args:?} failed in {}: {}",
            dir.display(),
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn fake_activity(repo_name: &str) -> RepoLocalActivity {
        RepoLocalActivity {
            repo_path: format!("/nonexistent/{repo_name}"),
            repo_name: repo_name.to_owned(),
            default_branch: "main".to_owned(),
            branches: Vec::new(),
            recent_remote_branches: Vec::new(),
            last_fetched_at: None,
        }
    }

    /// Whether the snapshot reports the checked-out branch as dirty. The test
    /// REVIEW_HOME has exactly one registered repo, so path-matching (which a
    /// symlinked temp dir can defeat) isn't needed.
    fn current_branch_is_dirty(snapshot: &[RepoLocalActivity]) -> bool {
        let [activity] = snapshot else {
            panic!(
                "expected exactly one registered repo, got {}",
                snapshot.len()
            );
        };
        activity
            .branches
            .iter()
            .find(|b| b.is_current)
            .expect("the checked-out branch always belongs in the snapshot")
            .has_working_tree_changes
    }

    /// The 5-minute poll in `router.tsx` exists to notice working-tree edits in
    /// repos that aren't the open one — the only ones without a recursive
    /// watcher. A fingerprint match alone can't deliver that: nothing about an
    /// untracked write moves `HEAD`, `refs/`, or the index. Aging the entry out
    /// is what makes the poll do its job.
    #[test]
    fn an_aged_out_entry_notices_a_working_tree_edit_no_fingerprint_can_see() {
        let _lock = ENV_LOCK.lock().unwrap();
        let (_env, _review_home, repo_dir) = setup_test();
        let repo_path = repo_dir.path();

        git(repo_path, &["init"]);
        git(repo_path, &["config", "user.email", "test@example.com"]);
        git(repo_path, &["config", "user.name", "Test"]);
        git(repo_path, &["commit", "--allow-empty", "-m", "init"]);
        register_repo(repo_path).unwrap();
        invalidate(repo_path);

        let clean = snapshot_all_within(MAX_CACHE_AGE).unwrap();
        assert!(
            !current_branch_is_dirty(&clean),
            "a freshly committed repo starts clean"
        );

        // An untracked write. It touches no file the fingerprint stats.
        fs::write(repo_path.join("scratch.txt"), "work in progress\n").unwrap();

        let within_window = snapshot_all_within(Duration::from_secs(600)).unwrap();
        assert!(
            !current_branch_is_dirty(&within_window),
            "inside the age window the cached (clean) answer is reused — this is \
             the gap the poll has to close, not a bug in the cache"
        );

        let aged_out = snapshot_all_within(Duration::ZERO).unwrap();
        assert!(
            current_branch_is_dirty(&aged_out),
            "once the entry ages out the rebuild must see the dirty worktree"
        );
    }

    /// Rebuilds run outside the cache lock, so a slow `snapshot_all` thread can
    /// land after a watcher rebuild of the same repo. Writing its older
    /// activity under a current-looking fingerprint would pin the stale row:
    /// every later event compares equal and short-circuits to `None`.
    #[test]
    fn a_late_landing_stale_rebuild_cannot_overwrite_a_newer_one() {
        let repo_id = "test-store-if-newer";
        let observed_early = Instant::now();
        let observed_late = observed_early + Duration::from_secs(1);

        assert!(store_if_newer(
            repo_id,
            CachedRepo {
                activity: fake_activity("fresh"),
                fingerprint: Fingerprint::default(),
                observed_at: observed_late,
            }
        ));

        assert!(
            !store_if_newer(
                repo_id,
                CachedRepo {
                    activity: fake_activity("stale"),
                    fingerprint: Fingerprint::default(),
                    observed_at: observed_early,
                }
            ),
            "a write built from an older observation must be rejected"
        );

        assert_eq!(
            with_cache(|c| c.get(repo_id).map(|e| e.activity.repo_name.clone())),
            Some("fresh".to_owned()),
            "the newer activity must survive the late-landing write"
        );

        with_cache(|c| c.remove(repo_id));
    }

    /// A no-op rebuild still restamps `observed_at`. Without that, a repo the
    /// watcher keeps proving unchanged would keep aging out and pay for a
    /// redundant git pass on every snapshot.
    #[test]
    fn a_no_op_rebuild_still_restamps_the_age_clock() {
        let repo_id = "test-restamp-age-clock";
        let first = Instant::now();

        assert!(store_if_newer(
            repo_id,
            CachedRepo {
                activity: fake_activity("same"),
                fingerprint: Fingerprint::default(),
                observed_at: first,
            }
        ));
        assert!(
            store_if_newer(
                repo_id,
                CachedRepo {
                    activity: fake_activity("same"),
                    fingerprint: Fingerprint::default(),
                    observed_at: first + Duration::from_secs(1),
                }
            ),
            "an equal-content rebuild from a later observation still lands"
        );

        let stamped = with_cache(|c| c.get(repo_id).map(|e| e.observed_at));
        assert_eq!(stamped, Some(first + Duration::from_secs(1)));

        with_cache(|c| c.remove(repo_id));
    }
}
