//! GitHub provider abstraction.
//!
//! Defines a trait for interacting with GitHub pull requests and a concrete
//! implementation backed by the `gh` CLI.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::process::Command;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Lightweight PR reference embedded in [`super::traits::Comparison`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubPrRef {
    pub number: u32,
    pub title: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

/// Full pull request returned by listing endpoints.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullRequest {
    pub number: u32,
    pub title: String,
    pub head_ref_name: String,
    pub base_ref_name: String,
    pub url: String,
    pub author: PrAuthor,
    pub state: String,
    #[serde(default)]
    pub is_draft: bool,
    pub updated_at: String,
    #[serde(default)]
    pub body: String,
}

/// Author of a pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrAuthor {
    pub login: String,
}

// ---------------------------------------------------------------------------
// Trait
// ---------------------------------------------------------------------------

/// Abstraction over GitHub operations so the `gh` CLI can be swapped for
/// direct API calls later.
pub trait GitHubProvider {
    type Error: std::error::Error;

    /// Returns `true` when the provider is installed and authenticated.
    fn is_available(&self) -> bool;

    /// List open pull requests for the repository.
    fn list_pull_requests(&self) -> Result<Vec<PullRequest>, Self::Error>;
}

// ---------------------------------------------------------------------------
// GhCliProvider
// ---------------------------------------------------------------------------

/// [`GitHubProvider`] backed by the `gh` CLI.
pub struct GhCliProvider {
    repo_path: PathBuf,
}

impl GhCliProvider {
    pub fn new(repo_path: PathBuf) -> Self {
        Self { repo_path }
    }
}

impl GitHubProvider for GhCliProvider {
    type Error = GhError;

    fn is_available(&self) -> bool {
        Command::new("gh")
            .args(["auth", "status"])
            .current_dir(&self.repo_path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false)
    }

    fn list_pull_requests(&self) -> Result<Vec<PullRequest>, GhError> {
        let output = Command::new("gh")
            .args([
                "pr",
                "list",
                "--json",
                "number,title,headRefName,baseRefName,url,author,state,isDraft,updatedAt,body",
            ])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GhError::Io(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GhError::Command(stderr.into_owned()));
        }

        let prs: Vec<PullRequest> =
            serde_json::from_slice(&output.stdout).map_err(|e| GhError::Parse(e.to_string()))?;
        Ok(prs)
    }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[derive(Debug)]
pub enum GhError {
    Io(String),
    Command(String),
    Parse(String),
}

impl std::fmt::Display for GhError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(msg) => write!(f, "gh I/O error: {msg}"),
            Self::Command(msg) => write!(f, "gh command error: {msg}"),
            Self::Parse(msg) => write!(f, "gh parse error: {msg}"),
        }
    }
}

impl std::error::Error for GhError {}

// ---------------------------------------------------------------------------
// PR status (for freshness checks)
// ---------------------------------------------------------------------------

/// Lightweight PR status for freshness checks.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrStatus {
    pub state: String,        // OPEN, MERGED, CLOSED
    pub head_ref_oid: String, // SHA of the PR head commit
}

impl GhCliProvider {
    /// Get the current status (state + head SHA) of a pull request.
    pub fn get_pr_status(&self, number: u32) -> Result<PrStatus, GhError> {
        let output = Command::new("gh")
            .args([
                "pr",
                "view",
                &number.to_string(),
                "--json",
                "state,headRefOid",
            ])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GhError::Io(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GhError::Command(stderr.into_owned()));
        }

        let status: PrStatus =
            serde_json::from_slice(&output.stdout).map_err(|e| GhError::Parse(e.to_string()))?;
        Ok(status)
    }
}
