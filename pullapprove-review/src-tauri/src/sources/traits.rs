use serde::{Deserialize, Serialize};

/// A comparison specification using the simplified VS Code model
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Comparison {
    pub old: String,        // Base ref (e.g., "main")
    pub new: String,        // Compare ref (e.g., "HEAD")
    #[serde(rename = "workingTree")]
    pub working_tree: bool, // Include uncommitted working tree changes
    pub key: String,        // Unique key for storage, e.g., "main..HEAD+working-tree"
}

impl Comparison {
    pub fn new(old: &str, new: &str, working_tree: bool) -> Self {
        let key = if working_tree {
            format!("{}..{}+working-tree", old, new)
        } else {
            format!("{}..{}", old, new)
        };
        Self {
            old: old.to_string(),
            new: new.to_string(),
            working_tree,
            key,
        }
    }

    pub fn from_key(key: &str) -> Self {
        // Parse key like "main..HEAD+working-tree" or "main..HEAD"
        let working_tree = key.ends_with("+working-tree");
        let key_without_wt = key.strip_suffix("+working-tree").unwrap_or(key);

        let parts: Vec<&str> = key_without_wt.split("..").collect();
        let old = parts.first().unwrap_or(&"HEAD").to_string();
        let new = parts.get(1).unwrap_or(&"HEAD").to_string();

        Self {
            old,
            new,
            working_tree,
            key: key.to_string(),
        }
    }

    /// Create a default comparison (main..HEAD with working tree)
    pub fn default() -> Self {
        Self::new("main", "HEAD", true)
    }
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

    /// Get file content at a specific ref
    fn get_file_content(&self, ref_name: &str, file_path: &str) -> Result<String, Self::Error>;
}
