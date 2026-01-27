//! File system watcher for detecting repository changes.
//!
//! Watches the repository for working tree changes, git state changes,
//! and review state changes, then emits events to the frontend.

use ignore::gitignore::{Gitignore, GitignoreBuilder};
use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::fs::OpenOptions;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Log a message to the app.log file (for debugging watcher events)
fn log_to_file(repo_path: &Path, message: &str) {
    let log_path = repo_path.join(".git/compare/app.log");
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(&log_path) {
        let timestamp = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.3fZ");
        let _ = writeln!(file, "[{}] [WATCHER] {}", timestamp, message);
    }
}

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
fn is_gitignored(gitignore: &Option<Arc<Gitignore>>, path: &Path, repo_path: &Path) -> bool {
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
        if path_str.ends_with(".lock") {
            return true;
        }

        // Only allow these specific .git paths that indicate meaningful state changes
        let meaningful_git_paths = [
            "/compare/", // Our review state
            "\\compare\\",
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
    WorkingTree,
    Ignored,
}

fn categorize_change(path_str: &str) -> ChangeKind {
    if should_ignore_path(path_str) {
        return ChangeKind::Ignored;
    }

    // Review state files (inside .git/compare/) - but not log files
    if path_str.contains("/.git/compare/") || path_str.contains("\\.git\\compare\\") {
        // Ignore log files to prevent feedback loops with our own logging
        if path_str.ends_with(".log") {
            return ChangeKind::Ignored;
        }
        return ChangeKind::ReviewState;
    }

    // Everything else is a working tree change (including git refs, HEAD, index)
    ChangeKind::WorkingTree
}

/// Start watching a repository for changes
///
/// Watches the entire repository recursively for:
/// - Working tree changes (file creates, edits, deletes)
/// - Git state changes (commits, branch switches, staging)
/// - Review state changes (.git/compare/)
pub fn start_watching(repo_path: &str, app: AppHandle) -> Result<(), String> {
    init_watchers();

    let repo_path_str = repo_path.to_string();
    let repo_path_buf = PathBuf::from(repo_path);
    let git_dir = repo_path_buf.join(".git");

    if !git_dir.exists() {
        return Err(format!("Not a git repository: {}", repo_path));
    }

    // Create compare directory if it doesn't exist (so we can watch it)
    let human_review_dir = git_dir.join("compare");
    if !human_review_dir.exists() {
        std::fs::create_dir_all(&human_review_dir).ok();
    }

    // Build gitignore matcher for this repo
    let gitignore = build_gitignore(&repo_path_buf).map(Arc::new);

    let app_clone = app.clone();
    let repo_for_closure = repo_path_str.clone();
    let repo_path_for_closure = repo_path_buf.clone();

    // Clone gitignore for the closure
    let gitignore_for_closure = gitignore.clone();

    // Create debounced watcher with 200ms debounce (slightly longer for working tree)
    let mut debouncer = new_debouncer(
        Duration::from_millis(200),
        move |result: Result<Vec<notify_debouncer_mini::DebouncedEvent>, notify::Error>| {
            match result {
                Ok(events) => {
                    let mut review_changed = false;
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
                        if !path_str.contains("/.git/") && !path_str.contains("\\.git\\") {
                            if is_gitignored(
                                &gitignore_for_closure,
                                &event.path,
                                &repo_path_for_closure,
                            ) {
                                log_to_file(
                                    &repo_path_for_closure,
                                    &format!("GITIGNORED: {}", path_str),
                                );
                                continue;
                            }
                        }

                        let category = categorize_change(&path_str);

                        // Only log non-ignored events to reduce noise
                        if !matches!(category, ChangeKind::Ignored) {
                            let category_str = match &category {
                                ChangeKind::ReviewState => "ReviewState",
                                ChangeKind::WorkingTree => "WorkingTree",
                                ChangeKind::Ignored => "Ignored",
                            };
                            log_to_file(
                                &repo_path_for_closure,
                                &format!("Event: {} -> {}", category_str, path_str),
                            );
                        }

                        match category {
                            ChangeKind::ReviewState => {
                                review_changed = true;
                            }
                            ChangeKind::WorkingTree => {
                                working_tree_changed = true;
                            }
                            ChangeKind::Ignored => {}
                        }
                    }

                    // Emit events to frontend
                    if review_changed {
                        eprintln!("[watcher] Review state changed for {}", repo_for_closure);
                        let _ = app_clone.emit("review-state-changed", &repo_for_closure);
                    }

                    if working_tree_changed {
                        eprintln!("[watcher] Working tree changed for {}", repo_for_closure);
                        let _ = app_clone.emit("git-changed", &repo_for_closure);
                    }
                }
                Err(e) => {
                    eprintln!("[watcher] Error: {:?}", e);
                }
            }
        },
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    // Watch the entire repository recursively
    debouncer
        .watcher()
        .watch(&repo_path_buf, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch repository: {}", e))?;

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
        map.insert(repo_path_str.clone(), handle);
    }

    eprintln!("[watcher] Started file watcher for {}", repo_path_str);
    Ok(())
}

/// Stop watching a repository
pub fn stop_watching(repo_path: &str) {
    eprintln!("[watcher] Stopping file watcher for {}", repo_path);
    let mut watchers = WATCHERS
        .lock()
        .expect("WATCHERS mutex poisoned - another thread panicked while holding lock");
    if let Some(ref mut map) = *watchers {
        if map.remove(repo_path).is_some() {
            eprintln!("[watcher] Stopped file watcher for {}", repo_path);
        }
    }
}
