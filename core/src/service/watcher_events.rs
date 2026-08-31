//! Shared filesystem-event categorization for the Tauri and Axum (web) watchers.
//!
//! Both surfaces receive raw paths from `notify-rs` and need the same rules
//! for deciding which paths to ignore, which count as git state, and how to
//! shape the `git-changed` payload.

use serde::Serialize;
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

/// Payload for the `git-changed` event. Carries the set of working-tree paths
/// that changed in the debounce window, so the frontend can refresh only those
/// files rather than doing a blanket reload.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitChangedPayload {
    pub repo_path: String,
    /// Repo-relative paths whose working-tree content changed. Empty when only
    /// git-internal state changed (branch switch, commit, stage/unstage).
    pub changed_paths: Vec<String>,
    /// True if `.git/HEAD`, `.git/refs/heads/`, or `.git/index` changed —
    /// signals that a full refresh is warranted (branch switch, commit, stage).
    pub git_state_changed: bool,
}

/// Payload for the `git-index-lock` event. Its own channel rather than a field
/// on [`GitChangedPayload`], because the two say opposite things: `git-changed`
/// means "re-read the repo", and this means "some process is writing it, don't".
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitIndexLockPayload {
    pub repo_path: String,
    /// Whether the lock is held *now* — the watcher stats the file after the
    /// debounce rather than inferring it from create/remove events, which
    /// arrive coalesced and out of order.
    pub locked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    ReviewState,
    /// A git-internal state change (index, HEAD, refs/heads) that affects
    /// branch and working-tree status.
    GitState,
    /// `.git/index.lock` appeared or vanished. Reported on its own channel and
    /// never folded into `git_state_changed`: the repo has not changed, some
    /// process is merely mid-write, and a diff refresh runs git — which would
    /// take the lock again and report itself.
    IndexLock,
    WorkingTree,
    /// The global workspace queue (`<central root>/workspaces.json`) changed.
    Workspaces,
    Ignored,
}

/// The file name of the global workspace queue, directly inside the central root.
const WORKSPACES_FILE: &str = "workspaces.json";

/// Check if a path has a `.log` extension (case-insensitive).
pub fn is_log_file(path_str: &str) -> bool {
    std::path::Path::new(path_str)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("log"))
}

/// Returns true if the path refers to a git-internal state file (index, HEAD,
/// refs/heads/) that affects branch and working-tree status.
pub fn is_git_state_path(path_str: &str) -> bool {
    path_str.contains("/.git/refs/heads/")
        || path_str.contains("\\.git\\refs\\heads\\")
        || path_str.ends_with("/.git/HEAD")
        || path_str.ends_with("\\.git\\HEAD")
        || path_str.ends_with("/.git/index")
        || path_str.ends_with("\\.git\\index")
}

/// Returns true for git's own `index.lock` — the one `.git` lock file we do
/// *not* ignore. It is held for exactly as long as some process is writing the
/// index (a commit, including its hooks; a checkout; a stash), which is what
/// makes it worth reporting. It is deliberately **not** a
/// [`is_git_state_path`]: nothing about the repo has changed yet, so a lock
/// event must never provoke a diff refresh — see [`ChangeKind::IndexLock`].
pub fn is_index_lock_path(path_str: &str) -> bool {
    path_str.ends_with("/.git/index.lock") || path_str.ends_with("\\.git\\index.lock")
}

/// Where `repo_path`'s `index.lock` would be. Worktree-aware, because a linked
/// worktree has its own index (and so its own lock) under
/// `<main>/.git/worktrees/<name>/`. The one answer, shared by the watchers that
/// stat it on an event and by `get_status`, which reports its initial state.
pub fn index_lock_path(repo_path: &Path) -> PathBuf {
    crate::home::resolve_git_dirs(repo_path)
        .0
        .join("index.lock")
}

/// Whether some git process currently holds `repo_path`'s index lock.
pub fn index_is_locked(repo_path: &Path) -> bool {
    std::fs::metadata(index_lock_path(repo_path)).is_ok()
}

/// Returns true if `.git`-internal noise (lock files, pack files, logs) or
/// common build-output directories (`target/`, `node_modules/`, ...) should be
/// dropped before further categorization.
pub fn should_ignore_path(path_str: &str) -> bool {
    if path_str.contains("/.git/") || path_str.contains("\\.git\\") {
        if is_index_lock_path(path_str) {
            return false;
        }
        if std::path::Path::new(path_str)
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("lock"))
        {
            return true;
        }
        let meaningful_git_paths = [
            "/review/", // Our review state
            "\\review\\",
            "/refs/heads/", // Branch changes
            "\\refs\\heads\\",
            "/refs/remotes/", // Remote tracking branches
            "\\refs\\remotes\\",
            "/.git/HEAD", // Current branch change
            "\\.git\\HEAD",
            "/.git/index", // Staging changes
            "\\.git\\index",
        ];
        return !meaningful_git_paths.iter().any(|p| path_str.contains(p));
    }

    let noisy_patterns = [
        "/node_modules/",
        "\\node_modules\\",
        "/.venv/",
        "\\.venv\\",
        "/venv/",
        "\\venv\\",
        "/__pycache__/",
        "\\__pycache__\\",
        "/target/",
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
        ".swp",
        ".swo",
        "~",
    ];

    noisy_patterns.iter().any(|p| path_str.contains(p))
}

/// Categorize a changed path.
///
/// `central_root` is `~/.spur` (or `$SPUR_HOME`). Files sitting *directly*
/// in it are the app's own global state and belong to no repository, so they
/// are classified here rather than falling through to [`ChangeKind::WorkingTree`]
/// — which would push an absolute, non-repo path into a `git-changed` payload
/// and trigger a full diff refetch for whatever repo happened to be open. Only
/// `workspaces.json` is actionable; its `workspaces.json.tmp` (created and renamed on every
/// save), `index.json`, `settings.json`, `viewer_prs.json`, and `daemon.*` are
/// noise. Deeper paths (`repos/**`, `cache/**`) still take the arms below.
pub fn categorize_change(path_str: &str, central_root: &Path) -> ChangeKind {
    let path = Path::new(path_str);
    if path.parent() == Some(central_root) {
        return if path.file_name() == Some(OsStr::new(WORKSPACES_FILE)) {
            ChangeKind::Workspaces
        } else {
            ChangeKind::Ignored
        };
    }

    if should_ignore_path(path_str) {
        return ChangeKind::Ignored;
    }

    // Match against the actual central root, not a literal ".spur": under a
    // custom `$SPUR_HOME` the directory can be named anything, and a literal
    // match would misfile review-state writes as working-tree changes.
    let is_central_review = path
        .strip_prefix(central_root)
        .map(|rest| rest.starts_with("repos"))
        .unwrap_or(false)
        || path_str.contains("/.review/repos/")
        || path_str.contains("\\.review\\repos\\");
    let is_legacy_review =
        path_str.contains("/.git/review/") || path_str.contains("\\.git\\review\\");

    if is_central_review || is_legacy_review {
        if is_log_file(path_str) {
            return ChangeKind::Ignored;
        }
        return ChangeKind::ReviewState;
    }

    if is_index_lock_path(path_str) {
        return ChangeKind::IndexLock;
    }

    if is_git_state_path(path_str) {
        return ChangeKind::GitState;
    }

    ChangeKind::WorkingTree
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = "/home/u/.spur";

    fn categorize(path: &str) -> ChangeKind {
        categorize_change(path, Path::new(ROOT))
    }

    #[test]
    fn the_work_queue_is_its_own_kind() {
        assert_eq!(
            categorize("/home/u/.spur/workspaces.json"),
            ChangeKind::Workspaces
        );
    }

    #[test]
    fn other_central_root_files_are_ignored_not_working_tree() {
        // The queue's own atomic write creates and renames this on every save,
        // so treating it as a working-tree edit made the queue self-trigger a
        // spurious `git-changed` for whatever repo was open.
        for name in [
            "workspaces.json.tmp",
            "viewer_prs.json",
            "index.json",
            "settings.json",
            "daemon.sock",
            "daemon.pid",
        ] {
            let path = format!("{ROOT}/{name}");
            assert_eq!(
                categorize(&path),
                ChangeKind::Ignored,
                "{name} must not reach the working-tree arm"
            );
        }
    }

    #[test]
    fn a_custom_review_home_still_classifies_review_state() {
        // `$SPUR_HOME` need not be named ".spur" — the repos/ check has to
        // come from the central root, not a literal.
        let root = Path::new("/tmp/spur-dev-home");
        assert_eq!(
            categorize_change("/tmp/spur-dev-home/repos/abc/reviews/main.json", root),
            ChangeKind::ReviewState
        );
        assert_eq!(
            categorize_change("/tmp/spur-dev-home/workspaces.json", root),
            ChangeKind::Workspaces
        );
        assert_eq!(
            categorize_change("/tmp/spur-dev-home/index.json", root),
            ChangeKind::Ignored
        );
    }

    #[test]
    fn paths_deeper_than_the_root_still_categorize_normally() {
        assert_eq!(
            categorize("/home/u/.spur/repos/abc123/reviews/main.json"),
            ChangeKind::ReviewState
        );
        assert_eq!(
            categorize("/home/u/code/app/src/main.rs"),
            ChangeKind::WorkingTree
        );
        assert_eq!(
            categorize("/home/u/code/app/.git/HEAD"),
            ChangeKind::GitState
        );
    }

    #[test]
    fn the_index_lock_is_the_one_git_lock_we_watch() {
        // It is held for the whole of an index write (a commit's hooks
        // included), which is how work started in a terminal becomes visible
        // before it lands.
        assert_eq!(
            categorize("/home/u/code/app/.git/index.lock"),
            ChangeKind::IndexLock
        );
        // Every other `.git` lock is still noise.
        for name in ["config.lock", "HEAD.lock", "shallow.lock"] {
            let path = format!("/home/u/code/app/.git/{name}");
            assert_eq!(categorize(&path), ChangeKind::Ignored, "{name}");
        }
        assert_eq!(
            categorize("/home/u/code/app/.git/refs/heads/main.lock"),
            ChangeKind::Ignored
        );
    }

    #[test]
    fn the_index_lock_is_not_git_state() {
        // The whole point of the separate kind: a lock must not reach
        // `git_state_changed`, which is what triggers a full diff refresh —
        // and a refresh runs git, which would take the lock again.
        assert!(!is_git_state_path("/home/u/code/app/.git/index.lock"));
        assert!(is_git_state_path("/home/u/code/app/.git/index"));
    }

    #[test]
    #[cfg(unix)]
    fn a_symlinked_review_home_still_finds_its_own_work_queue() {
        // The event path comes back from the OS resolved, so the root it is
        // compared against has to be resolved too — see
        // `home::canonical_central_root`, which is what the watchers pass.
        let real = tempfile::TempDir::new().unwrap();
        let link_dir = tempfile::TempDir::new().unwrap();
        let link = link_dir.path().join("review-home");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();

        let resolved = real.path().canonicalize().unwrap();
        let event = resolved.join(WORKSPACES_FILE);
        let event_str = event.to_string_lossy();

        assert_eq!(
            categorize_change(&event_str, &link),
            ChangeKind::WorkingTree,
            "the un-resolved root is what the bug looked like"
        );
        assert_eq!(
            categorize_change(&event_str, &resolved),
            ChangeKind::Workspaces
        );
    }

    #[test]
    fn a_work_json_outside_the_central_root_is_just_a_file() {
        // Only the one in the central root is the queue.
        assert_eq!(
            categorize("/home/u/code/app/workspaces.json"),
            ChangeKind::WorkingTree
        );
    }
}
