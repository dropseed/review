//! File system watcher for detecting repository changes.
//!
//! Watches the repository for working tree changes, git state changes,
//! and review state changes, then emits events to the frontend.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use review::service::activity_cache::RefreshTrigger;
use review::service::watcher_events::{
    categorize_change, is_git_state_path, ChangeKind, GitChangedPayload,
};
use review::service::EVENT_REPO_ACTIVITY_CHANGED;
use std::collections::{BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Debounce interval for file system events in milliseconds.
const WATCHER_DEBOUNCE_MS: u64 = 200;

/// Event names emitted to the frontend. Must match the strings in `tauri-client.ts`.
const EVENT_REVIEW_STATE_CHANGED: &str = "review-state-changed";
const EVENT_GIT_CHANGED: &str = "git-changed";

/// Log a message to the app.log file (for debugging watcher events, dev only)
#[cfg(debug_assertions)]
fn log_to_file(repo_path: &Path, message: &str) {
    use std::io::Write;

    let log_path = if let Ok(dir) = review::review::central::get_repo_storage_dir(repo_path) {
        dir.join("app.log")
    } else {
        return;
    };
    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_path)
    {
        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
        let _ = writeln!(file, "[{timestamp}] [WATCHER] {message}");
    }
}

#[cfg(not(debug_assertions))]
fn log_to_file(_repo_path: &Path, _message: &str) {}

// Global map of repo_path -> watcher handle (using thread for debouncer)
static WATCHERS: Mutex<Option<HashMap<String, WatcherHandle>>> = Mutex::new(None);

struct WatcherHandle {
    // Keep debouncer alive - dropping it stops watching
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}

/// Build a gitignore matcher for a repository
fn build_gitignore(repo_path: &Path) -> Option<Gitignore> {
    let mut builder = GitignoreBuilder::new(repo_path);

    // Add the repo's .gitignore if it exists
    let gitignore_path = repo_path.join(".gitignore");
    if gitignore_path.exists() {
        builder.add(&gitignore_path);
    }

    // Add global gitignore if it exists (~/.gitignore_global or ~/.config/git/ignore)
    if let Ok(home) = std::env::var("HOME") {
        let home_path = PathBuf::from(&home);
        let global_gitignore = home_path.join(".gitignore_global");
        if global_gitignore.exists() {
            builder.add(&global_gitignore);
        }
        let config_gitignore = home_path.join(".config/git/ignore");
        if config_gitignore.exists() {
            builder.add(&config_gitignore);
        }
    }

    builder.build().ok()
}

/// Check if a path is ignored by gitignore
fn is_gitignored(gitignore: Option<&Arc<Gitignore>>, path: &Path, repo_path: &Path) -> bool {
    if let Some(gi) = gitignore {
        // Get path relative to repo root for proper matching
        if let Ok(relative) = path.strip_prefix(repo_path) {
            let is_dir = path.is_dir();
            return gi.matched(relative, is_dir).is_ignore();
        }
    }
    false
}

/// Initialize the global watchers map
fn init_watchers() {
    let mut watchers = WATCHERS
        .lock()
        .expect("WATCHERS mutex poisoned - another thread panicked while holding lock");
    if watchers.is_none() {
        *watchers = Some(HashMap::new());
    }
}

/// Start watching a repository for changes
///
/// Watches the entire repository recursively for:
/// - Working tree changes (file creates, edits, deletes)
/// - Git state changes (commits, branch switches, staging)
/// - Review state changes (.git/review/)
#[expect(
    clippy::needless_pass_by_value,
    reason = "AppHandle is cloned into the watcher closure and must be owned"
)]
pub fn start_watching(repo_path: &str, app: AppHandle) -> Result<(), String> {
    init_watchers();

    let repo_path_str = repo_path.to_owned();
    let repo_path_buf = PathBuf::from(repo_path);
    let git_dir = repo_path_buf.join(".git");

    if !git_dir.exists() {
        return Err(format!("Not a git repository: {repo_path}"));
    }

    // Build gitignore matcher for this repo
    let gitignore = build_gitignore(&repo_path_buf).map(Arc::new);

    let app_clone = app.clone();
    let repo_for_closure = repo_path_str.clone();
    let repo_path_for_closure = repo_path_buf.clone();

    // Clone gitignore for the closure
    let gitignore_for_closure = gitignore.clone();

    let mut debouncer = new_debouncer(
        Duration::from_millis(WATCHER_DEBOUNCE_MS),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            match result {
                Ok(events) => {
                    let mut review_changed = false;
                    let mut git_state_changed = false;
                    let mut working_tree_changed = false;
                    // Deduped set of repo-relative paths that changed in this window.
                    // Sorted for stable payload ordering.
                    let mut changed_paths: BTreeSet<String> = BTreeSet::new();

                    for event in events {
                        if event.kind != DebouncedEventKind::Any {
                            continue;
                        }

                        let path_str = event.path.to_string_lossy();

                        // Skip our own log file completely to avoid feedback loops
                        if path_str.ends_with("/app.log") || path_str.ends_with("\\app.log") {
                            continue;
                        }

                        // Skip gitignored paths (but not .git internal paths which we handle separately)
                        if !path_str.contains("/.git/")
                            && !path_str.contains("\\.git\\")
                            && is_gitignored(
                                gitignore_for_closure.as_ref(),
                                &event.path,
                                &repo_path_for_closure,
                            )
                        {
                            log_to_file(&repo_path_for_closure, &format!("GITIGNORED: {path_str}"));
                            continue;
                        }

                        let category = categorize_change(&path_str);

                        // Only log non-ignored events to reduce noise
                        if !matches!(category, ChangeKind::Ignored) {
                            let category_str = match &category {
                                ChangeKind::ReviewState => "ReviewState",
                                ChangeKind::GitState => "GitState",
                                ChangeKind::WorkingTree => "WorkingTree",
                                ChangeKind::Ignored => "Ignored",
                            };
                            log_to_file(
                                &repo_path_for_closure,
                                &format!("Event: {category_str} -> {path_str}"),
                            );
                        }

                        match category {
                            ChangeKind::ReviewState => {
                                review_changed = true;
                            }
                            ChangeKind::GitState => {
                                git_state_changed = true;
                            }
                            ChangeKind::WorkingTree => {
                                working_tree_changed = true;
                                let rel = review::service::util::repo_relative_path(
                                    &event.path,
                                    &repo_path_for_closure,
                                );
                                if !rel.is_empty() {
                                    changed_paths.insert(rel);
                                }
                            }
                            ChangeKind::Ignored => {}
                        }
                    }

                    // Emit events to frontend
                    if review_changed {
                        eprintln!("[watcher] Review state changed for {repo_for_closure}");
                        let _ = app_clone.emit(EVENT_REVIEW_STATE_CHANGED, &repo_for_closure);
                    }

                    // Git state changes (index, HEAD, refs/heads) are a subset of
                    // working tree changes — emit git-changed for both.
                    if working_tree_changed || git_state_changed {
                        let payload = GitChangedPayload {
                            repo_path: repo_for_closure.clone(),
                            changed_paths: changed_paths.into_iter().collect(),
                            git_state_changed,
                        };
                        eprintln!(
                            "[watcher] git-changed for {repo_for_closure} (paths={}, git_state={git_state_changed})",
                            payload.changed_paths.len()
                        );
                        let _ = app_clone.emit(EVENT_GIT_CHANGED, &payload);
                    }

                    if let Some(trigger) = RefreshTrigger::from_flags(
                        git_state_changed,
                        review_changed,
                        working_tree_changed,
                    ) {
                        review::service::activity_cache::refresh_and_emit(
                            &repo_for_closure,
                            trigger,
                            |payload| {
                                let _ = app_clone.emit(EVENT_REPO_ACTIVITY_CHANGED, payload);
                            },
                        );
                    }
                }
                Err(e) => {
                    eprintln!("[watcher] Error: {e}");
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {e}"))?;

    // Watch the entire repository recursively
    debouncer
        .watcher()
        .watch(&repo_path_buf, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch repository: {e}"))?;

    // Also watch the repo's central storage dir for review state changes
    if let Ok(central_dir) = review::review::central::get_repo_storage_dir(&repo_path_buf) {
        if central_dir.exists() {
            debouncer
                .watcher()
                .watch(&central_dir, RecursiveMode::Recursive)
                .ok();
        }
    }

    // Store the watcher handle
    let handle = WatcherHandle {
        _debouncer: debouncer,
    };

    let mut watchers = WATCHERS
        .lock()
        .expect("WATCHERS mutex poisoned - another thread panicked while holding lock");
    if let Some(ref mut map) = *watchers {
        // Stop existing watcher for this repo if any
        map.remove(&repo_path_str);
        // Also remove the lightweight local-activity watcher if present,
        // since the full watcher covers refs/heads/ changes too
        map.remove(&local_activity_key(&repo_path_str));
        map.insert(repo_path_str.clone(), handle);
    }

    eprintln!("[watcher] Started file watcher for {repo_path_str}");
    Ok(())
}

/// Key under which a repo's lightweight watcher is stored in `WATCHERS`.
fn local_activity_key(repo_path: &str) -> String {
    format!("local-activity:{repo_path}")
}

/// Stop watching a repository. If the repo is still registered, resume
/// lightweight watching so branch/staging/review-state deltas keep reaching
/// the sidebar.
pub fn stop_watching(repo_path: &str, app: AppHandle) {
    eprintln!("[watcher] Stopping file watcher for {repo_path}");
    {
        let mut watchers = WATCHERS
            .lock()
            .expect("WATCHERS mutex poisoned - another thread panicked while holding lock");
        if let Some(ref mut map) = *watchers {
            if map.remove(repo_path).is_some() {
                eprintln!("[watcher] Stopped file watcher for {repo_path}");
            }
        }
    }
    if let Err(e) = start_local_activity_watcher_for(repo_path, app) {
        eprintln!("[watcher] Failed to restart lightweight watcher for {repo_path}: {e}");
    }
}

/// Build (but do not register) a lightweight watcher for a single repo.
/// The watcher observes only git-internal state (`.git/HEAD`, refs, index)
/// and emits scoped `repo-activity-changed` deltas via the activity cache.
fn build_local_activity_watcher(
    repo_path_str: &str,
    app: AppHandle,
) -> Result<WatcherHandle, String> {
    let repo_path = PathBuf::from(repo_path_str);
    let git_dir = repo_path.join(".git");
    if !git_dir.exists() {
        return Err(format!("Not a git repository: {repo_path_str}"));
    }

    let repo_path_for_closure = repo_path_str.to_owned();
    let mut debouncer = new_debouncer(
        Duration::from_millis(500),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            if let Ok(events) = result {
                let any_meaningful = events
                    .iter()
                    .any(|e| is_git_state_path(&e.path.to_string_lossy()));
                if !any_meaningful {
                    return;
                }
                review::service::activity_cache::refresh_and_emit(
                    &repo_path_for_closure,
                    RefreshTrigger::GitState,
                    |payload| {
                        let _ = app.emit(EVENT_REPO_ACTIVITY_CHANGED, payload);
                    },
                );
            }
        },
    )
    .map_err(|e| format!("Failed to create local activity watcher: {e}"))?;

    // Branch changes
    let refs_heads = git_dir.join("refs").join("heads");
    if refs_heads.exists() {
        debouncer
            .watcher()
            .watch(&refs_heads, RecursiveMode::Recursive)
            .ok();
    }

    // Current-branch changes
    debouncer
        .watcher()
        .watch(&git_dir.join("HEAD"), RecursiveMode::NonRecursive)
        .ok();

    // Staging changes (working tree dirty state)
    debouncer
        .watcher()
        .watch(&git_dir.join("index"), RecursiveMode::NonRecursive)
        .ok();

    Ok(WatcherHandle {
        _debouncer: debouncer,
    })
}

/// Start (or replace) the lightweight watcher for a single repo. No-op when
/// the full watcher already owns this repo, since the full watcher's event
/// categorization covers git-internal state too.
pub fn start_local_activity_watcher_for(repo_path: &str, app: AppHandle) -> Result<(), String> {
    init_watchers();

    // Don't fight the full watcher if the repo is currently open.
    {
        let watchers = WATCHERS.lock().expect("WATCHERS mutex poisoned");
        if let Some(ref map) = *watchers {
            if map.contains_key(repo_path) {
                return Ok(());
            }
        }
    }

    let handle = build_local_activity_watcher(repo_path, app)?;
    let key = local_activity_key(repo_path);

    // Re-check registration and full-watcher presence under the lock: the
    // caller's first check may have been superseded by `unregister_repo` or
    // `start_watching` while `build_local_activity_watcher` was running.
    let mut watchers = WATCHERS.lock().expect("WATCHERS mutex poisoned");
    let Some(ref mut map) = *watchers else {
        return Ok(());
    };
    if map.contains_key(repo_path) {
        return Ok(());
    }
    if !review::review::central::is_registered(&PathBuf::from(repo_path)).unwrap_or(false) {
        return Ok(());
    }
    map.insert(key, handle);
    Ok(())
}

/// Stop the lightweight watcher for a single repo (if one is running).
/// Invalidates the cached activity so subsequent reads force a rebuild.
pub fn stop_local_activity_watcher(repo_path: &str) {
    let mut watchers = WATCHERS.lock().expect("WATCHERS mutex poisoned");
    if let Some(ref mut map) = *watchers {
        map.remove(&local_activity_key(repo_path));
    }
    review::service::activity_cache::invalidate(&PathBuf::from(repo_path));
}

/// Start lightweight watchers on all registered repos at startup. Each watcher
/// is per-repo so new/removed repos can manage their own lifecycle via
/// `start_local_activity_watcher_for` / `stop_local_activity_watcher`.
pub fn start_local_activity_watchers(app: AppHandle) -> Result<(), String> {
    init_watchers();

    let repos = review::review::central::list_registered_repos().map_err(|e| e.to_string())?;
    let mut started = 0usize;

    for repo_entry in repos {
        let git_dir = PathBuf::from(&repo_entry.path).join(".git");
        if !git_dir.exists() {
            continue;
        }
        match start_local_activity_watcher_for(&repo_entry.path, app.clone()) {
            Ok(()) => started += 1,
            Err(e) => eprintln!(
                "[watcher] Failed to start local activity watcher for {}: {e}",
                repo_entry.path
            ),
        }
    }

    eprintln!("[watcher] Started local activity watchers for {started} repos");
    Ok(())
}
