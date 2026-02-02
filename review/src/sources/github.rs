//! GitHub provider abstraction.
//!
//! Defines a trait for interacting with GitHub pull requests and a concrete
//! implementation backed by the `gh` CLI.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use super::traits::{FileEntry, FileStatus};

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

/// A file changed in a pull request.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PrFile {
    pub path: String,
    pub additions: u32,
    pub deletions: u32,
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

    /// Get the unified diff for a pull request.
    fn get_pull_request_diff(&self, number: u32) -> Result<String, Self::Error>;

    /// Get the list of files changed in a pull request.
    fn get_pull_request_files(&self, number: u32) -> Result<Vec<PrFile>, Self::Error>;
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

    fn get_pull_request_diff(&self, number: u32) -> Result<String, GhError> {
        let output = Command::new("gh")
            .args(["pr", "diff", &number.to_string()])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GhError::Io(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GhError::Command(stderr.into_owned()));
        }

        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    fn get_pull_request_files(&self, number: u32) -> Result<Vec<PrFile>, GhError> {
        let output = Command::new("gh")
            .args(["pr", "view", &number.to_string(), "--json", "files"])
            .current_dir(&self.repo_path)
            .output()
            .map_err(|e| GhError::Io(e.to_string()))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(GhError::Command(stderr.into_owned()));
        }

        #[derive(Deserialize)]
        struct FilesWrapper {
            files: Vec<PrFile>,
        }

        let wrapper: FilesWrapper =
            serde_json::from_slice(&output.stdout).map_err(|e| GhError::Parse(e.to_string()))?;
        Ok(wrapper.files)
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
// Helpers
// ---------------------------------------------------------------------------

/// Convert a flat list of [`PrFile`]s into a hierarchical [`FileEntry`] tree.
pub fn pr_files_to_file_entries(files: Vec<PrFile>) -> Vec<FileEntry> {
    // Collect unique directory paths and build intermediate nodes.
    let mut dir_children: HashMap<String, Vec<FileEntry>> = HashMap::new();

    for file in &files {
        let parts: Vec<&str> = file.path.split('/').collect();
        // Ensure all ancestor directories exist in the map.
        for i in 0..parts.len().saturating_sub(1) {
            let dir_path = parts[..=i].join("/");
            dir_children.entry(dir_path).or_default();
        }
    }

    // Build leaf file entries.
    for file in &files {
        let status = if file.deletions > 0 && file.additions > 0 {
            Some(FileStatus::Modified)
        } else if file.deletions > 0 {
            Some(FileStatus::Deleted)
        } else {
            Some(FileStatus::Added)
        };

        let name = Path::new(&file.path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        let entry = FileEntry {
            name,
            path: file.path.clone(),
            is_directory: false,
            children: None,
            status,
        };

        if let Some(parent) = Path::new(&file.path).parent() {
            let parent_str = parent.to_string_lossy().into_owned();
            if parent_str.is_empty() {
                dir_children.entry(String::new()).or_default().push(entry);
            } else {
                dir_children.entry(parent_str).or_default().push(entry);
            }
        } else {
            dir_children.entry(String::new()).or_default().push(entry);
        }
    }

    // Build directory entries bottom-up (longest paths first).
    let mut sorted_dirs: Vec<String> = dir_children.keys().cloned().collect();
    sorted_dirs.sort_by(|a, b| b.len().cmp(&a.len()));

    let mut built: HashMap<String, FileEntry> = HashMap::new();

    for dir_path in &sorted_dirs {
        if dir_path.is_empty() {
            continue;
        }

        let mut children = dir_children.remove(dir_path).unwrap_or_default();

        // Attach any already-built sub-directories.
        let prefix = format!("{dir_path}/");
        let sub_dir_keys: Vec<String> = built
            .keys()
            .filter(|k| k.starts_with(&prefix) && !k[prefix.len()..].contains('/'))
            .cloned()
            .collect();
        for key in sub_dir_keys {
            if let Some(sub) = built.remove(&key) {
                children.push(sub);
            }
        }

        children.sort_by(|a, b| {
            b.is_directory
                .cmp(&a.is_directory)
                .then(a.name.cmp(&b.name))
        });

        let name = Path::new(dir_path)
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();

        built.insert(
            dir_path.clone(),
            FileEntry {
                name,
                path: dir_path.clone(),
                is_directory: true,
                children: Some(children),
                status: None,
            },
        );
    }

    // Collect root-level entries.
    let mut root = dir_children.remove("").unwrap_or_default();

    // Attach top-level directories.
    let top_level_keys: Vec<String> = built.keys().filter(|k| !k.contains('/')).cloned().collect();
    for key in top_level_keys {
        if let Some(entry) = built.remove(&key) {
            root.push(entry);
        }
    }

    root.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then(a.name.cmp(&b.name))
    });

    root
}
