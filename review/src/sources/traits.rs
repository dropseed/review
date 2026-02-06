use serde::{Deserialize, Serialize};

/// A stash entry
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StashEntry {
    /// The stash ref (e.g., "stash@{0}")
    #[serde(rename = "ref")]
    pub stash_ref: String,
    /// The stash message/description
    pub message: String,
}

/// Branch list with local and remote branches separated
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BranchList {
    pub local: Vec<String>,
    pub remote: Vec<String>,
    pub stashes: Vec<StashEntry>,
}

/// Git status summary for the working tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatusSummary {
    #[serde(rename = "currentBranch")]
    pub current_branch: String,
    pub staged: Vec<StatusEntry>,
    pub unstaged: Vec<StatusEntry>,
    pub untracked: Vec<String>,
}

/// A single entry in the git status (staged or unstaged)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StatusEntry {
    pub path: String,
    pub status: ChangeStatus,
}

/// Type of change for a status entry
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Copied,
}

/// A comparison specification using the simplified VS Code model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comparison {
    pub old: String, // Base ref (e.g., "main")
    pub new: String, // Compare ref (e.g., "HEAD")
    #[serde(rename = "workingTree")]
    pub working_tree: bool, // Include uncommitted working tree changes (auto-detected)
    pub key: String, // Unique key for storage, e.g., "main..HEAD"
    #[serde(rename = "githubPr", default, skip_serializing_if = "Option::is_none")]
    pub github_pr: Option<super::github::GitHubPrRef>, // Optional GitHub PR reference
}

/// A file entry in the tree
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    #[serde(rename = "isDirectory")]
    pub is_directory: bool,
    pub children: Option<Vec<FileEntry>>,
    pub status: Option<FileStatus>,
    #[serde(rename = "isSymlink", default)]
    pub is_symlink: bool,
    #[serde(rename = "symlinkTarget", skip_serializing_if = "Option::is_none")]
    pub symlink_target: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Untracked,
    Gitignored,
}

/// A commit entry from git log
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitEntry {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub date: String,
}

/// Detailed commit information including changed files
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitDetail {
    pub hash: String,
    pub short_hash: String,
    pub message: String,
    pub author: String,
    pub author_email: String,
    pub date: String,
    pub files: Vec<CommitFileChange>,
    pub diff: String,
}

/// A file changed in a commit
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitFileChange {
    pub path: String,
    pub status: String,
    pub additions: u32,
    pub deletions: u32,
}

/// Trait for diff sources - abstracts over local git, GitHub API, etc.
pub trait DiffSource {
    type Error: std::error::Error;

    /// List all files in the repository, with change status for the comparison
    fn list_files(&self, comparison: &Comparison) -> Result<Vec<FileEntry>, Self::Error>;

    /// Get the diff output for a comparison
    fn get_diff(
        &self,
        comparison: &Comparison,
        file_path: Option<&str>,
    ) -> Result<String, Self::Error>;

    /// Get specific lines from a file at a given ref
    /// Used for expanding context around diff hunks
    fn get_file_lines(
        &self,
        file_path: &str,
        git_ref: &str,
        start_line: u32,
        end_line: u32,
    ) -> Result<Vec<String>, Self::Error>;
}
