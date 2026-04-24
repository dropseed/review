//! Shared filesystem-event categorization for the Tauri and Axum (web) watchers.
//!
//! Both surfaces receive raw paths from `notify-rs` and need the same rules
//! for deciding which paths to ignore, which count as git state, and how to
//! shape the `git-changed` payload.

use serde::Serialize;

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
    Ignored,
}

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

pub fn categorize_change(path_str: &str) -> ChangeKind {
    if should_ignore_path(path_str) {
        return ChangeKind::Ignored;
    }

    let is_central_review =
        path_str.contains("/.review/repos/") || path_str.contains("\\.review\\repos\\");
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
