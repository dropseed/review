use notify::RecursiveMode;
use notify_debouncer_mini::{new_debouncer, DebouncedEventKind};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

// Global map of repo_path -> watcher handle (using thread for debouncer)
static WATCHERS: Mutex<Option<HashMap<String, WatcherHandle>>> = Mutex::new(None);

struct WatcherHandle {
    // Keep debouncer alive - dropping it stops watching
    _debouncer: notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>,
}

/// Initialize the global watchers map
fn init_watchers() {
    let mut watchers = WATCHERS.lock().unwrap();
    if watchers.is_none() {
        *watchers = Some(HashMap::new());
    }
}

/// Check if a path should be ignored (noise we don't care about)
fn should_ignore_path(path_str: &str) -> bool {
    // Ignore .git internals except the specific paths we care about
    if path_str.contains("/.git/") || path_str.contains("\\.git\\") {
        // Allow these specific .git paths
        let dominated_git_paths = [
            "compare", "/refs/", "\\refs\\", "/HEAD", "\\HEAD",
            "/index", // git index changes on staging
        ];
        return !dominated_git_paths.iter().any(|p| path_str.contains(p));
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
        "/target/debug/",
        "\\target\\debug\\",
        "/target/release/",
        "\\target\\release\\",
        "/.next/",
        "\\.next\\",
        "/dist/",
        "\\dist\\",
        "/build/",
        "\\build\\",
        "/.cache/",
        "\\.cache\\",
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

    // Review state files
    if path_str.contains("compare") {
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

    let app_clone = app.clone();
    let repo_for_closure = repo_path_str.clone();

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
                        eprintln!("[watcher] Event: {:?} -> {}", event.kind, path_str);

                        match categorize_change(&path_str) {
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

    let mut watchers = WATCHERS.lock().unwrap();
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
    let mut watchers = WATCHERS.lock().unwrap();
    if let Some(ref mut map) = *watchers {
        if map.remove(repo_path).is_some() {
            eprintln!("[watcher] Stopped file watcher for {}", repo_path);
        }
    }
}

/// Stop all watchers (for cleanup on app exit)
pub fn stop_all() {
    let mut watchers = WATCHERS.lock().unwrap();
    if let Some(ref mut map) = *watchers {
        let count = map.len();
        map.clear();
        log::info!("Stopped {} file watcher(s)", count);
    }
}
