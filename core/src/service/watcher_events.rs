//! Shared filesystem-event categorization for the Tauri and Axum (web) watchers.
//!
//! Both surfaces receive raw paths from `notify-rs` and need the same rules
//! for deciding which paths to ignore, which count as git state, and how to
//! shape the `git-changed` payload.

use serde::Serialize;
use std::ffi::OsStr;
use std::path::Path;

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChangeKind {
    ReviewState,
    /// A git-internal state change (index, HEAD, refs/heads) that affects
    /// branch and working-tree status.
    GitState,
    WorkingTree,
    /// The global work queue (`<central root>/work.json`) changed.
    WorkQueue,
    Ignored,
}

/// The file name of the global work queue, directly inside the central root.
const WORK_QUEUE_FILE: &str = "work.json";

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

/// Returns true if `.git`-internal noise (lock files, pack files, logs) or
/// common build-output directories (`target/`, `node_modules/`, ...) should be
/// dropped before further categorization.
pub fn should_ignore_path(path_str: &str) -> bool {
    if path_str.contains("/.git/") || path_str.contains("\\.git\\") {
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
/// `central_root` is `~/.review` (or `$REVIEW_HOME`). Files sitting *directly*
/// in it are the app's own global state and belong to no repository, so they
/// are classified here rather than falling through to [`ChangeKind::WorkingTree`]
/// — which would push an absolute, non-repo path into a `git-changed` payload
/// and trigger a full diff refetch for whatever repo happened to be open. Only
/// `work.json` is actionable; its `work.json.tmp` (created and renamed on every
/// save), `index.json`, `settings.json`, `viewer_prs.json`, and `daemon.*` are
/// noise. Deeper paths (`repos/**`, `cache/**`) still take the arms below.
pub fn categorize_change(path_str: &str, central_root: &Path) -> ChangeKind {
    let path = Path::new(path_str);
    if path.parent() == Some(central_root) {
        return if path.file_name() == Some(OsStr::new(WORK_QUEUE_FILE)) {
            ChangeKind::WorkQueue
        } else {
            ChangeKind::Ignored
        };
    }

    if should_ignore_path(path_str) {
        return ChangeKind::Ignored;
    }

    // Match against the actual central root, not a literal ".review": under a
    // custom `$REVIEW_HOME` the directory can be named anything, and a literal
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

    if is_git_state_path(path_str) {
        return ChangeKind::GitState;
    }

    ChangeKind::WorkingTree
}

#[cfg(test)]
mod tests {
    use super::*;

    const ROOT: &str = "/home/u/.review";

    fn categorize(path: &str) -> ChangeKind {
        categorize_change(path, Path::new(ROOT))
    }

    #[test]
    fn the_work_queue_is_its_own_kind() {
        assert_eq!(
            categorize("/home/u/.review/work.json"),
            ChangeKind::WorkQueue
        );
    }

    #[test]
    fn other_central_root_files_are_ignored_not_working_tree() {
        // The queue's own atomic write creates and renames this on every save,
        // so treating it as a working-tree edit made the queue self-trigger a
        // spurious `git-changed` for whatever repo was open.
        for name in [
            "work.json.tmp",
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
        // `$REVIEW_HOME` need not be named ".review" — the repos/ check has to
        // come from the central root, not a literal.
        let root = Path::new("/tmp/review-dev-home");
        assert_eq!(
            categorize_change("/tmp/review-dev-home/repos/abc/reviews/main.json", root),
            ChangeKind::ReviewState
        );
        assert_eq!(
            categorize_change("/tmp/review-dev-home/work.json", root),
            ChangeKind::WorkQueue
        );
        assert_eq!(
            categorize_change("/tmp/review-dev-home/index.json", root),
            ChangeKind::Ignored
        );
    }

    #[test]
    fn paths_deeper_than_the_root_still_categorize_normally() {
        assert_eq!(
            categorize("/home/u/.review/repos/abc123/reviews/main.json"),
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
    #[cfg(unix)]
    fn a_symlinked_review_home_still_finds_its_own_work_queue() {
        // The event path comes back from the OS resolved, so the root it is
        // compared against has to be resolved too — see
        // `central::canonical_central_root`, which is what the watchers pass.
        let real = tempfile::TempDir::new().unwrap();
        let link_dir = tempfile::TempDir::new().unwrap();
        let link = link_dir.path().join("review-home");
        std::os::unix::fs::symlink(real.path(), &link).unwrap();

        let resolved = real.path().canonicalize().unwrap();
        let event = resolved.join(WORK_QUEUE_FILE);
        let event_str = event.to_string_lossy();

        assert_eq!(
            categorize_change(&event_str, &link),
            ChangeKind::WorkingTree,
            "the un-resolved root is what the bug looked like"
        );
        assert_eq!(
            categorize_change(&event_str, &resolved),
            ChangeKind::WorkQueue
        );
    }

    #[test]
    fn a_work_json_outside_the_central_root_is_just_a_file() {
        // Only the one in the central root is the queue.
        assert_eq!(
            categorize("/home/u/code/app/work.json"),
            ChangeKind::WorkingTree
        );
    }
}
