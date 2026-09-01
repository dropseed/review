//! Service layer — shared business logic for Tauri desktop and Axum web server.
//!
//! This module extracts the core orchestration logic from the desktop commands
//! into reusable functions that return `anyhow::Result`. Both the Tauri IPC
//! layer and the Axum HTTP handlers call into this module.

pub mod activity;
pub mod activity_cache;
pub mod commit;
pub mod files;
pub mod freshness;
pub mod power;
pub mod pr;
pub mod review_io;
pub mod shipped;
pub mod symbols;
pub mod targets;
pub mod usage;
pub mod util;
pub mod viewer_prs;
pub mod vscode;
pub mod watcher_events;
pub mod worktrees;

use crate::diff::parser::DiffHunk;
use crate::symbols::Symbol;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// --- Shared types ---

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub content: String,
    pub old_content: Option<String>,
    pub diff_patch: String,
    pub hunks: Vec<DiffHunk>,
    pub content_type: String,
    pub image_data_url: Option<String>,
    pub old_image_data_url: Option<String>,
}

/// One requested path's place in the comparison, as of now.
///
/// `status: None` means the comparison no longer touches this file — the edit
/// that triggered the delta put it back the way the base has it.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDeltaEntry {
    pub path: String,
    pub status: Option<crate::sources::traits::FileStatus>,
    pub renamed_from: Option<String>,
    /// Whether the file is on disk in the comparison's working tree. A path
    /// that is neither changed nor present is one the caller should forget
    /// entirely rather than merely mark unchanged.
    pub exists: bool,
}

/// The recomputed slice of a comparison covering a named set of paths.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilesDelta {
    pub files: Vec<FileDeltaEntry>,
    pub hunks: Vec<DiffHunk>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpandedContextResult {
    pub lines: Vec<String>,
    pub start_line: u32,
    pub end_line: u32,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CommitStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitOutputLine {
    pub text: String,
    pub stream: CommitStream,
    pub seq: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitResult {
    pub success: bool,
    pub commit_hash: Option<String>,
    pub summary: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoLocalActivity {
    pub repo_path: String,
    pub repo_name: String,
    pub default_branch: String,
    pub branches: Vec<crate::sources::local_git::LocalBranchInfo>,
    #[serde(default)]
    pub recent_remote_branches: Vec<crate::sources::local_git::RecentRemoteBranch>,
}

/// Emitted by the file watcher when a repo's activity changes. The payload is
/// the freshly recomputed activity so the frontend can apply it as a delta to
/// one sidebar entry without refetching.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoActivityChangedPayload {
    pub repo_path: String,
    pub activity: RepoLocalActivity,
}

/// Event name for `RepoActivityChangedPayload`. Shared across the Tauri and
/// Axum watcher paths; the TypeScript clients mirror this string.
pub const EVENT_REPO_ACTIVITY_CHANGED: &str = "repo-activity-changed";

/// Event name signalling that the global workspace queue (`~/.spur/workspaces.json`)
/// changed. Carries no payload — the client re-reads the list. Shared across
/// the Tauri and Axum watcher paths; the TypeScript clients mirror this string.
pub const EVENT_WORKSPACES_CHANGED: &str = "workspaces-changed";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFreshnessInput {
    pub repo_path: String,
    /// Review identity — the freshness result is keyed by `{repo_path}:{ref}`.
    /// The backend resolves it (honoring `base_override`) into the comparison it
    /// diffs, so callers pass identity, not a pre-resolved comparison.
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub base_override: Option<String>,
    pub github_pr: Option<crate::sources::github::GitHubPrRef>,
    pub cached_old_sha: Option<String>,
    pub cached_new_sha: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFreshnessResult {
    pub key: String,
    pub is_active: bool,
    pub old_sha: Option<String>,
    pub new_sha: Option<String>,
    /// Refs from the comparison that no longer exist (e.g. deleted branch).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub missing_refs: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoFileSymbols {
    pub file_path: String,
    pub symbols: Vec<Symbol>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VscodeThemeDetection {
    pub name: String,
    pub theme_type: String,
    pub colors: HashMap<String, String>,
    /// Raw tokenColors array from the VS Code theme JSON (for Shiki)
    pub token_colors: Vec<serde_json::Value>,
}
