use serde::{Deserialize, Serialize};

/// A comparison specification using the simplified VS Code model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comparison {
    pub old: String, // Base ref (e.g., "main")
    pub new: String, // Compare ref (e.g., "HEAD")
    #[serde(rename = "workingTree")]
    pub working_tree: bool, // Include uncommitted working tree changes
    pub key: String, // Unique key for storage, e.g., "main..HEAD+working-tree"
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
}
