use super::traits::{Comparison, DiffSource, FileEntry, FileStatus};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::process::Command;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum LocalGitError {
    #[error("Git error: {0}")]
    Git(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not a git repository")]
    NotARepo,
}

pub struct LocalGitSource {
    repo_path: PathBuf,
}

impl LocalGitSource {
    pub fn new(repo_path: PathBuf) -> Result<Self, LocalGitError> {
        if !repo_path.join(".git").exists() {
            return Err(LocalGitError::NotARepo);
        }
        Ok(Self { repo_path })
    }

    /// Get the current branch name
    pub fn get_current_branch(&self) -> Result<String, LocalGitError> {
        let output = self.run_git(&["rev-parse", "--abbrev-ref", "HEAD"])?;
        Ok(output.trim().to_string())
    }

    /// Get the default branch name (main or master)
    pub fn get_default_branch(&self) -> Result<String, LocalGitError> {
        // Try to get from remote origin HEAD
        if let Ok(output) = self.run_git(&["symbolic-ref", "refs/remotes/origin/HEAD"]) {
            let trimmed = output.trim();
            if let Some(branch) = trimmed.strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_string());
            }
        }
        // Fall back to checking if main or master exists
        if self.run_git(&["rev-parse", "--verify", "main"]).is_ok() {
            return Ok("main".to_string());
        }
        if self.run_git(&["rev-parse", "--verify", "master"]).is_ok() {
            return Ok("master".to_string());
        }
        // Last resort: use HEAD
        Ok("HEAD".to_string())
    }

    /// List all local and remote branches
    pub fn list_branches(&self) -> Result<Vec<String>, LocalGitError> {
        let mut branches = Vec::new();

        // Get local branches
        let local_output = self.run_git(&["branch", "--format=%(refname:short)"])?;
        for line in local_output.lines() {
            let branch = line.trim();
            if !branch.is_empty() {
                branches.push(branch.to_string());
            }
        }

        // Get remote branches (excluding HEAD)
        let remote_output =
            self.run_git(&["branch", "-r", "--format=%(refname:short)"])?;
        for line in remote_output.lines() {
            let branch = line.trim();
            if !branch.is_empty() && !branch.ends_with("/HEAD") {
                branches.push(branch.to_string());
            }
        }

        // Sort and deduplicate
        branches.sort();
        branches.dedup();

        Ok(branches)
    }

    fn run_git(&self, args: &[&str]) -> Result<String, LocalGitError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .output()?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(LocalGitError::Git(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ))
        }
    }

    /// Get all tracked files from git (fast, uses index)
    fn get_tracked_files(&self) -> Result<Vec<String>, LocalGitError> {
        let output = self.run_git(&["ls-files"])?;
        Ok(output.lines().map(|s| s.to_string()).collect())
    }

    /// Get the merge-base between two refs
    fn get_merge_base(&self, ref1: &str, ref2: &str) -> Result<String, LocalGitError> {
        let output = self.run_git(&["merge-base", ref1, ref2])?;
        Ok(output.trim().to_string())
    }

    fn get_changed_files(
        &self,
        comparison: &Comparison,
    ) -> Result<HashMap<String, FileStatus>, LocalGitError> {
        let mut changes = HashMap::new();

        // Get committed changes between old and new refs
        // Use merge-base to handle divergent branches properly
        let base = match self.get_merge_base(&comparison.old, &comparison.new) {
            Ok(base) => base,
            Err(_) => comparison.old.clone(), // Fall back to direct comparison
        };

        // Get committed changes
        if comparison.old != comparison.new || !comparison.working_tree {
            let range = format!("{}..{}", base, comparison.new);
            let output = self.run_git(&["diff", "--name-status", &range])?;
            self.parse_name_status(&output, &mut changes);
        }

        // If working_tree is true, also include uncommitted changes
        if comparison.working_tree {
            // Get unstaged changes (working tree vs index)
            let unstaged_output = self.run_git(&["diff", "--name-status"])?;
            self.parse_name_status(&unstaged_output, &mut changes);

            // Get staged changes (index vs HEAD)
            let staged_output = self.run_git(&["diff", "--name-status", "--cached"])?;
            self.parse_name_status(&staged_output, &mut changes);
        }

        Ok(changes)
    }

    fn parse_name_status(&self, output: &str, changes: &mut HashMap<String, FileStatus>) {
        for line in output.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                let status = match parts[0].chars().next() {
                    Some('A') => FileStatus::Added,
                    Some('M') => FileStatus::Modified,
                    Some('D') => FileStatus::Deleted,
                    Some('R') => FileStatus::Renamed,
                    _ => FileStatus::Modified,
                };
                // For renames, parts[2] is the new name
                let path = if parts[0].starts_with('R') && parts.len() >= 3 {
                    parts[2]
                } else {
                    parts[1]
                };
                changes.insert(path.to_string(), status);
            }
        }
    }

    /// Get untracked files (not in git index, not ignored)
    fn get_untracked_files(&self) -> Result<Vec<String>, LocalGitError> {
        let output = self.run_git(&["ls-files", "--others", "--exclude-standard"])?;
        Ok(output.lines().map(|s| s.to_string()).collect())
    }

    /// Get all files including gitignored (for browsing, not review)
    /// Uses git ls-files with different flags to get everything
    pub fn list_all_files(
        &self,
        comparison: &Comparison,
    ) -> Result<Vec<FileEntry>, LocalGitError> {
        // Get changed files with their status
        let mut file_status = self.get_changed_files(comparison)?;

        // Add untracked files
        if comparison.working_tree {
            if let Ok(untracked) = self.get_untracked_files() {
                for path in untracked {
                    file_status.entry(path).or_insert(FileStatus::Untracked);
                }
            }
        }

        // Get ALL files: tracked + untracked + ignored
        // --others: untracked files
        // --ignored: include ignored files
        // --exclude-standard is NOT used here so we get everything
        let tracked = self.run_git(&["ls-files"])?;
        let untracked_all = self.run_git(&["ls-files", "--others"])?;

        let mut all_files: HashSet<String> = HashSet::new();
        for line in tracked.lines() {
            all_files.insert(line.to_string());
        }
        for line in untracked_all.lines() {
            all_files.insert(line.to_string());
            // Mark as gitignored if not already marked as untracked
            if !file_status.contains_key(line) {
                file_status.insert(line.to_string(), FileStatus::Gitignored);
            }
        }

        // Build tree from file paths
        let mut entries: HashMap<String, FileEntry> = HashMap::new();

        // Collect all directories
        let mut all_dirs: HashSet<String> = HashSet::new();
        for path in &all_files {
            let mut current = PathBuf::from(path);
            while let Some(parent) = current.parent() {
                let parent_str = parent.to_string_lossy().to_string();
                if parent_str.is_empty() {
                    break;
                }
                all_dirs.insert(parent_str);
                current = parent.to_path_buf();
            }
        }

        // Create directory entries
        for dir_path in &all_dirs {
            let name = PathBuf::from(dir_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            entries.insert(
                dir_path.clone(),
                FileEntry {
                    name,
                    path: dir_path.clone(),
                    is_directory: true,
                    children: Some(vec![]),
                    status: None,
                },
            );
        }

        // Create file entries
        for file_path in &all_files {
            let name = PathBuf::from(file_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let status = file_status.get(file_path).cloned();

            entries.insert(
                file_path.clone(),
                FileEntry {
                    name,
                    path: file_path.clone(),
                    is_directory: false,
                    children: None,
                    status,
                },
            );
        }

        // Build tree structure
        let mut paths: Vec<String> = entries.keys().cloned().collect();
        paths.sort_by(|a, b| {
            let a_depth = a.matches('/').count();
            let b_depth = b.matches('/').count();
            b_depth.cmp(&a_depth).then_with(|| a.cmp(b))
        });

        for path in &paths {
            if let Some(parent_path) = PathBuf::from(path).parent() {
                let parent_str = parent_path.to_string_lossy().to_string();
                if !parent_str.is_empty() {
                    if let Some(child) = entries.get(path).cloned() {
                        if let Some(parent) = entries.get_mut(&parent_str) {
                            if let Some(ref mut children) = parent.children {
                                children.push(child);
                            }
                        }
                    }
                }
            }
        }

        // Collect root entries
        let mut root_entries: Vec<FileEntry> = entries
            .iter()
            .filter(|(path, _)| !path.contains('/'))
            .map(|(_, entry)| entry.clone())
            .collect();

        // Sort entries
        fn sort_entries(entries: &mut [FileEntry]) {
            entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            });
            for entry in entries.iter_mut() {
                if let Some(ref mut children) = entry.children {
                    sort_entries(children);
                }
            }
        }

        sort_entries(&mut root_entries);

        Ok(root_entries)
    }
}

impl DiffSource for LocalGitSource {
    type Error = LocalGitError;

    fn list_files(&self, comparison: &Comparison) -> Result<Vec<FileEntry>, Self::Error> {
        // Get changed files with their status
        let mut file_status = self.get_changed_files(comparison)?;

        // Add untracked files (these are important for review)
        if comparison.working_tree {
            if let Ok(untracked) = self.get_untracked_files() {
                for path in untracked {
                    file_status.entry(path).or_insert(FileStatus::Untracked);
                }
            }
        }

        // Get all tracked files for the tree structure
        let tracked_files = self.get_tracked_files()?;

        // Build file set: tracked files + any files with status changes
        let mut all_files: HashSet<String> = tracked_files.into_iter().collect();
        for path in file_status.keys() {
            all_files.insert(path.clone());
        }

        // Build tree from file paths (no filesystem walking!)
        let mut entries: HashMap<String, FileEntry> = HashMap::new();

        // First, collect all directories we need
        let mut all_dirs: HashSet<String> = HashSet::new();
        for path in &all_files {
            let mut current = PathBuf::from(path);
            while let Some(parent) = current.parent() {
                let parent_str = parent.to_string_lossy().to_string();
                if parent_str.is_empty() {
                    break;
                }
                all_dirs.insert(parent_str);
                current = parent.to_path_buf();
            }
        }

        // Create directory entries
        for dir_path in &all_dirs {
            let name = PathBuf::from(dir_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            entries.insert(
                dir_path.clone(),
                FileEntry {
                    name,
                    path: dir_path.clone(),
                    is_directory: true,
                    children: Some(vec![]),
                    status: None,
                },
            );
        }

        // Create file entries
        for file_path in &all_files {
            let name = PathBuf::from(file_path)
                .file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            let status = file_status.get(file_path).cloned();

            entries.insert(
                file_path.clone(),
                FileEntry {
                    name,
                    path: file_path.clone(),
                    is_directory: false,
                    children: None,
                    status,
                },
            );
        }

        // Build tree structure efficiently
        // Sort paths by depth (deepest first) so we process children before parents
        let mut paths: Vec<String> = entries.keys().cloned().collect();
        paths.sort_by(|a, b| {
            let a_depth = a.matches('/').count();
            let b_depth = b.matches('/').count();
            b_depth.cmp(&a_depth).then_with(|| a.cmp(b))
        });

        // Add children to parents
        for path in &paths {
            if let Some(parent_path) = PathBuf::from(path).parent() {
                let parent_str = parent_path.to_string_lossy().to_string();
                if !parent_str.is_empty() {
                    // Take the child entry out temporarily
                    if let Some(child) = entries.get(path).cloned() {
                        if let Some(parent) = entries.get_mut(&parent_str) {
                            if let Some(ref mut children) = parent.children {
                                children.push(child);
                            }
                        }
                    }
                }
            }
        }

        // Collect root entries
        let mut root_entries: Vec<FileEntry> = entries
            .iter()
            .filter(|(path, _)| !path.contains('/'))
            .map(|(_, entry)| entry.clone())
            .collect();

        // Sort entries: directories first, then alphabetically
        fn sort_entries(entries: &mut [FileEntry]) {
            entries.sort_by(|a, b| match (a.is_directory, b.is_directory) {
                (true, false) => std::cmp::Ordering::Less,
                (false, true) => std::cmp::Ordering::Greater,
                _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
            });
            for entry in entries.iter_mut() {
                if let Some(ref mut children) = entry.children {
                    sort_entries(children);
                }
            }
        }

        sort_entries(&mut root_entries);

        Ok(root_entries)
    }

    fn get_diff(
        &self,
        comparison: &Comparison,
        file_path: Option<&str>,
    ) -> Result<String, Self::Error> {
        let mut all_diffs = String::new();

        // Get committed diff between old and new refs
        if comparison.old != comparison.new || !comparison.working_tree {
            // Get merge-base for proper 3-way diff on divergent branches
            let base = match self.get_merge_base(&comparison.old, &comparison.new) {
                Ok(base) => base,
                Err(_) => comparison.old.clone(),
            };

            let range = format!("{}..{}", base, comparison.new);
            let mut args = vec![
                "diff",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                &range,
            ];

            if let Some(path) = file_path {
                args.push("--");
                args.push(path);
            }

            if let Ok(output) = self.run_git(&args) {
                all_diffs.push_str(&output);
            }
        }

        // If working_tree is true, also get uncommitted changes
        if comparison.working_tree {
            // Get combined staged + unstaged changes (HEAD vs working tree)
            let mut args = vec!["diff", "--src-prefix=a/", "--dst-prefix=b/", "HEAD"];

            if let Some(path) = file_path {
                args.push("--");
                args.push(path);
            }

            if let Ok(output) = self.run_git(&args) {
                if !output.is_empty() {
                    if !all_diffs.is_empty() {
                        all_diffs.push('\n');
                    }
                    all_diffs.push_str(&output);
                }
            }
        }

        Ok(all_diffs)
    }

    fn get_file_content(&self, ref_name: &str, file_path: &str) -> Result<String, Self::Error> {
        self.run_git(&["show", &format!("{}:{}", ref_name, file_path)])
    }
}
