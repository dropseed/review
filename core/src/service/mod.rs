//! Service layer — shared business logic for Tauri desktop and Axum web server.
//!
//! This module extracts the core orchestration logic from the desktop commands
//! into reusable functions that return `anyhow::Result`. Both the Tauri IPC
//! layer and the Axum HTTP handlers call into this module.

pub mod activity;
pub mod commit;
pub mod files;
pub mod freshness;
pub mod symbols;
pub mod util;
pub mod vscode;

use crate::diff::parser::{DiffHunk, MovePair};
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

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectMovePairsResponse {
    pub pairs: Vec<MovePair>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoLocalActivity {
    pub repo_path: String,
    pub repo_name: String,
    pub default_branch: String,
    pub branches: Vec<crate::sources::local_git::LocalBranchInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewFreshnessInput {
    pub repo_path: String,
    pub comparison: crate::sources::traits::Comparison,
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
    pub diff_stats: Option<crate::sources::local_git::DiffShortStat>,
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
