//! File system watcher for detecting repository changes.
//!
//! Watches the repository for working tree changes, git state changes,
//! and review state changes, then emits events to the frontend.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Debounce interval for file system events in milliseconds.
const WATCHER_DEBOUNCE_MS: u64 = 200;

/// Event names emitted to the frontend. Must match the strings in `tauri-client.ts`.
const EVENT_REVIEW_STATE_CHANGED: &str = "review-state-changed";
const EVENT_GIT_CHANGED: &str = "git-changed";
const EVENT_LOCAL_ACTIVITY_CHANGED: &str = "local-activity-changed";

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

/// Check if a path should be ignored (noise we don't care about)
fn should_ignore_path(path_str: &str) -> bool {
    // Ignore most .git internals - only care about specific meaningful changes
    if path_str.contains("/.git/") || path_str.contains("\\.git\\") {
        // Always ignore .lock files in .git (transient lock files)
        if std::path::Path::new(path_str)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("lock"))
        {
            return true;
        }

        // Only allow these specific .git paths that indicate meaningful state changes
        let meaningful_git_paths = [
            "/review/", // Our review state
            "\\review\\",
            "/refs/heads/", // Branch changes
            "\\refs\\heads\\",
            "/refs/remotes/", // Remote tracking branches
            "\\refs\\remotes\\",
            "/.git/HEAD", // Current branch change (must be exact end)
            "\\.git\\HEAD",
            "/.git/index", // Staging changes (must be exact end)
            "\\.git\\index",
        ];
        return !meaningful_git_paths.iter().any(|p| path_str.contains(p));
    }

    // Ignore common noisy directories
    let noisy_patterns = [
        "/node_modules/",
        "\\node_modules\\",
        "/.venv/",
        "\\.venv\\",
        "/venv/",
        "\\venv\\",
        "/__pycache__/",
        "\\__pycache__\\",
        "/target/", // Rust build output (all of it)
        "\\target\\",
        "/.next/",
        "\\.next\\",
        "/dist/",
        "\\dist\\",
        "/build/",
        "\\build\\",
        "/.cache/",
        "\\.cache\\",
        "/.cargo/",
        "\\.cargo\\",
        "/.turbo/",
        "\\.turbo\\",
        ".swp", // Vim swap files
        ".swo",
        "~", // Backup files
    ];

    noisy_patterns.iter().any(|p| path_str.contains(p))
}

/// Categorize what kind of change occurred
enum ChangeKind {
    ReviewState,
    /// A git-internal state change (index, HEAD, refs/heads) that affects branch/working-tree status.
    GitState,
    WorkingTree,
    Ignored,
}

/// Check if a path has a `.log` extension (case-insensitive).
fn is_log_file(path_str: &str) -> bool {
    std::path::Path::new(path_str)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))
}

/// Returns true if the path refers to a git-internal state file
/// (index, HEAD, refs/heads/) that affects branch and working-tree status.
/// Used by both the full watcher (to emit `local-activity-changed`) and
/// the lightweight local-activity watcher (to filter meaningful events).
fn is_git_state_path(path_str: &str) -> bool {
    path_str.contains("/.git/refs/heads/")
        || path_str.contains("\\.git\\refs\\heads\\")
        || path_str.ends_with("/.git/HEAD")
        || path_str.ends_with("\\.git\\HEAD")
        || path_str.ends_with("/.git/index")
        || path_str.ends_with("\\.git\\index")
}

fn categorize_change(path_str: &str) -> ChangeKind {
    if should_ignore_path(path_str) {
        return ChangeKind::Ignored;
    }

    // Review state files in central storage (~/.review/) or legacy (.git/review/)
    let is_central_review =
        path_str.contains("/.review/repos/") || path_str.contains("\\.review\\repos\\");
    let is_legacy_review =
        path_str.contains("/.git/review/") || path_str.contains("\\.git\\review\\");

    if is_central_review || is_legacy_review {
        // Ignore log files to prevent feedback loops with our own logging
        if is_log_file(path_str) {
            return ChangeKind::Ignored;
        }
        return ChangeKind::ReviewState;
    }

    if is_git_state_path(path_str) {
        return ChangeKind::GitState;
    }

    // Everything else is a working tree change (regular file edits)
    ChangeKind::WorkingTree
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
                        eprintln!("[watcher] Working tree changed for {repo_for_closure}");
                        let _ = app_clone.emit(EVENT_GIT_CHANGED, &repo_for_closure);
                    }

                    // The lightweight local-activity watcher is skipped for repos with
                    // the full watcher, so we emit local-activity-changed here to keep
                    // the sidebar's branch data up to date on commits/staging/switches.
                    if git_state_changed {
                        eprintln!("[watcher] Local activity changed for {repo_for_closure}");
                        let _ = app_clone.emit(EVENT_LOCAL_ACTIVITY_CHANGED, &repo_for_closure);
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
        map.remove(&format!("local-activity:{repo_path_str}"));
        map.insert(repo_path_str.clone(), handle);
    }

    eprintln!("[watcher] Started file watcher for {repo_path_str}");
    Ok(())
}

/// Stop watching a repository
pub fn stop_watching(repo_path: &str) {
    eprintln!("[watcher] Stopping file watcher for {repo_path}");
    let mut watchers = WATCHERS
        .lock()
        .expect("WATCHERS mutex poisoned - another thread panicked while holding lock");
    if let Some(ref mut map) = *watchers {
        if map.remove(repo_path).is_some() {
            eprintln!("[watcher] Stopped file watcher for {repo_path}");
        }
    }
}

/// Start lightweight watchers on all registered repos to detect branch/ref changes.
/// Watches `.git/refs/heads/` and `.git/HEAD` for each repo.
/// Emits `"local-activity-changed"` event when branch state changes.
pub fn start_local_activity_watchers(app: AppHandle) -> Result<(), String> {
    init_watchers();

    let repos = review::review::central::list_registered_repos().map_err(|e| e.to_string())?;

    // 1. Lock once to determine which repos need watchers, then drop lock
    let repos_to_watch: Vec<_> = {
        let watchers = WATCHERS.lock().expect("WATCHERS mutex poisoned");
        repos
            .iter()
            .filter(|repo_entry| {
                let repo_path = PathBuf::from(&repo_entry.path);
                let git_dir = repo_path.join(".git");
                if !git_dir.exists() {
                    return false;
                }
                // Skip repos already watched by the full watcher
                if let Some(ref map) = *watchers {
                    if map.contains_key(&repo_entry.path) {
                        return false;
                    }
                }
                true
            })
            .collect()
    };

    // 2. Create all debouncers without holding the lock
    let mut new_handles: Vec<(String, WatcherHandle)> = Vec::new();

    for repo_entry in &repos_to_watch {
        let repo_path = PathBuf::from(&repo_entry.path);
        let git_dir = repo_path.join(".git");

        let app_clone = app.clone();
        let repo_path_str = repo_entry.path.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(500),
            move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
                if let Ok(events) = result {
                    let any_meaningful = events
                        .iter()
                        .any(|e| is_git_state_path(&e.path.to_string_lossy()));
                    if any_meaningful {
                        eprintln!("[watcher] Local activity changed for {repo_path_str}");
                        let _ = app_clone.emit(EVENT_LOCAL_ACTIVITY_CHANGED, &repo_path_str);
                    }
                }
            },
        )
        .map_err(|e| format!("Failed to create local activity watcher: {e}"))?;

        // Watch .git/refs/heads/ for branch changes
        let refs_heads = git_dir.join("refs").join("heads");
        if refs_heads.exists() {
            debouncer
                .watcher()
                .watch(&refs_heads, RecursiveMode::Recursive)
                .ok();
        }

        // Watch .git/HEAD for branch switches
        debouncer
            .watcher()
            .watch(&git_dir.join("HEAD"), RecursiveMode::NonRecursive)
            .ok();

        // Watch .git/index for staging changes (working tree dirty state)
        debouncer
            .watcher()
            .watch(&git_dir.join("index"), RecursiveMode::NonRecursive)
            .ok();

        let key = format!("local-activity:{}", repo_entry.path);
        new_handles.push((
            key,
            WatcherHandle {
                _debouncer: debouncer,
            },
        ));
    }

    // 3. Lock once to insert all handles
    {
        let mut watchers = WATCHERS.lock().expect("WATCHERS mutex poisoned");
        if let Some(ref mut map) = *watchers {
            for (key, handle) in new_handles {
                map.insert(key, handle);
            }
        }
    }

    eprintln!(
        "[watcher] Started local activity watchers for {} repos",
        repos_to_watch.len()
    );
    Ok(())
}
