use super::traits::{
    ChangeStatus, CommitEntry, Comparison, DiffSource, FileEntry, FileStatus, GitStatusSummary,
    StatusEntry,
};
use crate::diff::parser::parse_diff;
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use thiserror::Error;

/// Information about the git remote (org/repo and browse URL)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteInfo {
    /// Display name, e.g. "org/repo"
    pub name: String,
    /// URL to open in a browser, e.g. "https://github.com/org/repo"
    pub browse_url: String,
}

/// Lightweight diff statistics from `git diff --shortstat`
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiffShortStat {
    pub file_count: u32,
    pub additions: u32,
    pub deletions: u32,
}

/// A single search match from git grep
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    /// File path relative to repo root
    pub file_path: String,
    /// 1-indexed line number
    pub line_number: u32,
    /// 1-indexed column number where match starts
    pub column: u32,
    /// Full content of the matching line
    pub line_content: String,
}

#[derive(Error, Debug)]
pub enum LocalGitError {
    #[error("Git error: {0}")]
    Git(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not a git repository")]
    NotARepo,
}

#[derive(Debug)]
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

    /// Check if the comparison head is the current branch, meaning working
    /// tree changes (staged + unstaged + untracked) should be included in diffs.
    pub fn include_working_tree(&self, comparison: &Comparison) -> bool {
        match self.get_current_branch() {
            Ok(branch) => comparison.head == branch,
            Err(_) => false, // detached HEAD or error — committed diff only
        }
    }

    /// Get the current branch name
    pub fn get_current_branch(&self) -> Result<String, LocalGitError> {
        if let Ok(output) = self.run_git(&["rev-parse", "--abbrev-ref", "HEAD"]) {
            return Ok(output.trim().to_owned());
        }
        // Unborn branch: HEAD is symbolic ref but target has no commits
        let output = self.run_git(&["symbolic-ref", "--short", "HEAD"])?;
        Ok(output.trim().to_owned())
    }

    /// Get remote info (org/repo name and browse URL) from the origin remote
    pub fn get_remote_info(&self) -> Result<RemoteInfo, LocalGitError> {
        let url = self.run_git(&["remote", "get-url", "origin"])?;
        let url = url.trim();
        parse_remote_url(url)
    }

    /// The well-known SHA for git's empty tree object.
    /// This exists in every git repo and represents a tree with no files.
    const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

    /// Resolve a ref to a commit SHA hash, falling back to the empty tree
    /// if the ref doesn't exist (e.g., HEAD in an empty repo with no commits).
    pub fn resolve_ref_or_empty_tree(&self, git_ref: &str) -> String {
        match self.run_git(&["rev-parse", "--verify", git_ref]) {
            Ok(output) => output.trim().to_owned(),
            Err(_) => Self::EMPTY_TREE.to_owned(),
        }
    }

    /// Get the default branch name (main or master)
    pub fn get_default_branch(&self) -> Result<String, LocalGitError> {
        // Try to get from remote origin HEAD
        if let Ok(output) = self.run_git(&["symbolic-ref", "refs/remotes/origin/HEAD"]) {
            let trimmed = output.trim();
            if let Some(branch) = trimmed.strip_prefix("refs/remotes/origin/") {
                return Ok(branch.to_owned());
            }
        }
        // Fall back to checking if main or master exists
        if self.run_git(&["rev-parse", "--verify", "main"]).is_ok() {
            return Ok("main".to_owned());
        }
        if self.run_git(&["rev-parse", "--verify", "master"]).is_ok() {
            return Ok("master".to_owned());
        }
        // Empty repo: no refs exist yet, check what HEAD points to
        if let Ok(output) = self.run_git(&["symbolic-ref", "HEAD"]) {
            if let Some(branch) = output.trim().strip_prefix("refs/heads/") {
                if branch == "main" || branch == "master" {
                    return Ok(branch.to_owned());
                }
            }
        }
        // Last resort: use HEAD
        Ok("HEAD".to_owned())
    }

    /// Get lightweight diff statistics (file count, additions, deletions) via `--shortstat`.
    ///
    /// Mirrors the two modes used by `get_diff()`:
    /// - Committed: diff between old..new refs
    /// - Working tree: net diff from merge-base to working tree
    pub fn get_diff_shortstat(
        &self,
        comparison: &Comparison,
    ) -> Result<DiffShortStat, LocalGitError> {
        let output = if self.include_working_tree(comparison) {
            // Net diff: merge_base vs working tree (single diff captures everything)
            let resolved_head = self.resolve_ref_or_empty_tree("HEAD");
            let merge_base = match self.get_merge_base(&comparison.base, &resolved_head) {
                Ok(b) => b,
                Err(_) => self.resolve_ref_or_empty_tree(&comparison.base),
            };
            self.run_git(&["diff", "--shortstat", &merge_base])?
        } else {
            // Committed diff between base and head refs
            let merge_base = match self.get_merge_base(&comparison.base, &comparison.head) {
                Ok(b) => b,
                Err(_) => self.resolve_ref_or_empty_tree(&comparison.base),
            };
            let resolved_head = self.resolve_ref_or_empty_tree(&comparison.head);
            let range = format!("{merge_base}..{resolved_head}");
            self.run_git(&["diff", "--shortstat", &range])?
        };

        let (mut file_count, additions, deletions) = parse_shortstat(&output);

        // Untracked files aren't in git diff output but are part of the review
        if self.include_working_tree(comparison) {
            if let Ok(untracked) = self.get_untracked_files() {
                file_count += untracked.len() as u32;
            }
        }

        Ok(DiffShortStat {
            file_count,
            additions,
            deletions,
        })
    }

    /// List all local and remote branches, separated, plus stashes
    /// Branches are sorted by most recent commit date (newest first)
    pub fn list_branches(&self) -> Result<super::traits::BranchList, LocalGitError> {
        let mut local = Vec::new();
        let mut remote = Vec::new();
        let mut stashes = Vec::new();

        // Get local branches sorted by most recent commit date
        let local_output = self.run_git(&[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/heads/",
        ])?;
        for line in local_output.lines() {
            let branch = line.trim();
            if !branch.is_empty() {
                local.push(branch.to_owned());
            }
        }

        // Get remote branches sorted by most recent commit date (excluding HEAD)
        let remote_output = self.run_git(&[
            "for-each-ref",
            "--sort=-committerdate",
            "--format=%(refname:short)",
            "refs/remotes/",
        ])?;
        for line in remote_output.lines() {
            let branch = line.trim();
            if !branch.is_empty() && !branch.ends_with("/HEAD") {
                remote.push(branch.to_owned());
            }
        }

        // Get stashes
        if let Ok(stash_output) = self.run_git(&["stash", "list", "--format=%gd\t%s"]) {
            for line in stash_output.lines() {
                let line = line.trim();
                if line.is_empty() {
                    continue;
                }
                // Format is "stash@{0}\tmessage"
                let parts: Vec<&str> = line.splitn(2, '\t').collect();
                let stash_ref = parts[0].to_owned();
                let message = parts.get(1).unwrap_or(&"").to_string();
                stashes.push(super::traits::StashEntry { stash_ref, message });
            }
        }

        // Deduplicate (already sorted by commit date)
        local.dedup();
        remote.dedup();
        // Stashes are already in order (most recent first)

        Ok(super::traits::BranchList {
            local,
            remote,
            stashes,
        })
    }

    /// Get structured git status (staged, unstaged, untracked)
    pub fn get_status(&self) -> Result<GitStatusSummary, LocalGitError> {
        let current_branch = self.get_current_branch()?;

        // Get porcelain status (v1 format)
        let output = self.run_git(&["status", "--porcelain=v1"])?;

        let mut staged: Vec<StatusEntry> = Vec::new();
        let mut unstaged: Vec<StatusEntry> = Vec::new();
        let mut untracked: Vec<String> = Vec::new();

        for line in output.lines() {
            if line.len() < 3 {
                continue;
            }

            let index_status = line.chars().next().unwrap_or(' ');
            let worktree_status = line.chars().nth(1).unwrap_or(' ');
            let path = &line[3..];

            // Handle renames (format: "R  old -> new")
            let actual_path = if path.contains(" -> ") {
                path.split(" -> ").last().unwrap_or(path).to_owned()
            } else {
                path.to_owned()
            };

            // Untracked files
            if index_status == '?' && worktree_status == '?' {
                untracked.push(actual_path);
                continue;
            }

            // Staged changes (index status)
            if index_status != ' ' && index_status != '?' {
                let status = match index_status {
                    'A' => ChangeStatus::Added,
                    'D' => ChangeStatus::Deleted,
                    'R' => ChangeStatus::Renamed,
                    'C' => ChangeStatus::Copied,
                    _ => ChangeStatus::Modified,
                };
                staged.push(StatusEntry {
                    path: actual_path.clone(),
                    status,
                });
            }

            // Unstaged changes (worktree status)
            if worktree_status != ' ' && worktree_status != '?' {
                let status = match worktree_status {
                    'A' => ChangeStatus::Added,
                    'D' => ChangeStatus::Deleted,
                    'R' => ChangeStatus::Renamed,
                    'C' => ChangeStatus::Copied,
                    _ => ChangeStatus::Modified,
                };
                unstaged.push(StatusEntry {
                    path: actual_path,
                    status,
                });
            }
        }

        Ok(GitStatusSummary {
            current_branch,
            staged,
            unstaged,
            untracked,
        })
    }

    /// Get raw git status output for display
    pub fn get_status_raw(&self) -> Result<String, LocalGitError> {
        self.run_git(&["status"])
    }

    /// List recent commits from git log
    pub fn list_commits(
        &self,
        limit: usize,
        branch: Option<&str>,
    ) -> Result<Vec<CommitEntry>, LocalGitError> {
        let limit_str = format!("-{limit}");
        let format_str = "%H%n%h%n%s%n%an%n%aI";
        let ref_arg = branch.unwrap_or("HEAD");

        let output = self.run_git(&[
            "log",
            &limit_str,
            &format!("--format={format_str}"),
            ref_arg,
        ])?;

        let mut commits = Vec::new();
        let lines: Vec<&str> = output.lines().collect();

        // Each commit produces exactly 5 lines
        for chunk in lines.chunks(5) {
            if chunk.len() == 5 {
                commits.push(CommitEntry {
                    hash: chunk[0].to_owned(),
                    short_hash: chunk[1].to_owned(),
                    message: chunk[2].to_owned(),
                    author: chunk[3].to_owned(),
                    date: chunk[4].to_owned(),
                });
            }
        }

        Ok(commits)
    }

    /// Get detailed information about a specific commit
    pub fn get_commit_detail(
        &self,
        hash: &str,
    ) -> Result<super::traits::CommitDetail, LocalGitError> {
        // Get commit metadata
        let format_str = "%H%n%h%n%B%n--COMPARE-SEP--%n%an%n%ae%n%aI";
        let output = self.run_git(&[
            "show",
            "--no-patch",
            &format!("--format={format_str}"),
            hash,
        ])?;

        // Parse the output - split on --COMPARE-SEP-- to separate message from metadata
        let parts: Vec<&str> = output.splitn(2, "--COMPARE-SEP--\n").collect();
        if parts.len() < 2 {
            return Err(LocalGitError::Git(format!("Failed to parse commit {hash}")));
        }

        let message_section: Vec<&str> = parts[0].lines().collect();
        if message_section.len() < 3 {
            return Err(LocalGitError::Git(format!(
                "Failed to parse commit metadata for {hash}"
            )));
        }

        let full_hash = message_section[0].to_owned();
        let short_hash = message_section[1].to_owned();
        // Message is everything from line 2 to the end of this section, trimmed
        let message = message_section[2..].join("\n").trim().to_owned();

        let meta_lines: Vec<&str> = parts[1].lines().collect();
        let author = meta_lines.first().unwrap_or(&"").trim().to_owned();
        let author_email = meta_lines.get(1).unwrap_or(&"").trim().to_owned();
        let date = meta_lines.get(2).unwrap_or(&"").trim().to_owned();

        // Get changed files with stats
        let diff_output =
            self.run_git(&["diff-tree", "--no-commit-id", "-r", "--numstat", hash])?;

        // Also get name-status for file status (A/M/D/R)
        let status_output =
            self.run_git(&["diff-tree", "--no-commit-id", "-r", "--name-status", hash])?;

        // Build a map of path -> status
        let mut status_map: HashMap<String, String> = HashMap::new();
        for line in status_output.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                let status = match parts[0].chars().next() {
                    Some('A') => "added",
                    Some('D') => "deleted",
                    Some('R') => "renamed",
                    Some('C') => "copied",
                    _ => "modified",
                };
                // For renames, use the new path
                let path = if parts[0].starts_with('R') && parts.len() >= 3 {
                    parts[2]
                } else {
                    parts[1]
                };
                status_map.insert(path.to_owned(), status.to_owned());
            }
        }

        // Parse numstat output
        let mut files = Vec::new();
        for line in diff_output.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 3 {
                let additions = parts[0].parse::<u32>().unwrap_or(0);
                let deletions = parts[1].parse::<u32>().unwrap_or(0);
                let path = parts[2].to_owned();
                let status = status_map
                    .get(&path)
                    .cloned()
                    .unwrap_or_else(|| "modified".to_owned());
                files.push(super::traits::CommitFileChange {
                    path,
                    status,
                    additions,
                    deletions,
                });
            }
        }

        // Get the full diff patch for the commit
        let diff_patch = self.run_git(&[
            "diff-tree",
            "-p",
            "--src-prefix=a/",
            "--dst-prefix=b/",
            hash,
        ])?;

        Ok(super::traits::CommitDetail {
            hash: full_hash,
            short_hash,
            message,
            author,
            author_email,
            date,
            files,
            diff: diff_patch,
        })
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

    fn run_git_bytes(&self, args: &[&str]) -> Result<Vec<u8>, LocalGitError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .output()?;

        if output.status.success() {
            Ok(output.stdout)
        } else {
            Err(LocalGitError::Git(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ))
        }
    }

    /// Get file content as bytes at the specified ref
    pub fn get_file_bytes(&self, file_path: &str, git_ref: &str) -> Result<Vec<u8>, LocalGitError> {
        let ref_spec = format!("{git_ref}:{file_path}");
        self.run_git_bytes(&["show", &ref_spec])
    }

    /// Get all tracked files from git (fast, uses index)
    pub fn get_tracked_files(&self) -> Result<Vec<String>, LocalGitError> {
        let output = self.run_git(&["ls-files"])?;
        Ok(output.lines().map(std::borrow::ToOwned::to_owned).collect())
    }

    /// Get the merge-base between two refs
    fn get_merge_base(&self, ref1: &str, ref2: &str) -> Result<String, LocalGitError> {
        let output = self.run_git(&["merge-base", ref1, ref2])?;
        Ok(output.trim().to_owned())
    }

    fn get_changed_files(
        &self,
        comparison: &Comparison,
    ) -> Result<(HashMap<String, FileStatus>, HashMap<String, String>), LocalGitError> {
        let mut changes = HashMap::new();
        let mut rename_map = HashMap::new();

        if self.include_working_tree(comparison) {
            // Net change status: merge_base vs working tree (single diff captures everything)
            let resolved_head = self.resolve_ref_or_empty_tree("HEAD");
            let merge_base = match self.get_merge_base(&comparison.base, &resolved_head) {
                Ok(b) => b,
                Err(_) => self.resolve_ref_or_empty_tree(&comparison.base),
            };
            let output = self.run_git(&["diff", "--name-status", &merge_base])?;
            self.parse_name_status(&output, &mut changes, &mut rename_map);
        } else {
            // Committed diff between base and head refs
            let merge_base = match self.get_merge_base(&comparison.base, &comparison.head) {
                Ok(b) => b,
                Err(_) => self.resolve_ref_or_empty_tree(&comparison.base),
            };
            let resolved_head = self.resolve_ref_or_empty_tree(&comparison.head);
            let range = format!("{merge_base}..{resolved_head}");
            let output = self.run_git(&["diff", "--name-status", &range])?;
            self.parse_name_status(&output, &mut changes, &mut rename_map);
        }

        Ok((changes, rename_map))
    }

    #[expect(
        clippy::unused_self,
        reason = "method on LocalGitSource for consistency"
    )]
    fn parse_name_status(
        &self,
        output: &str,
        changes: &mut HashMap<String, FileStatus>,
        rename_map: &mut HashMap<String, String>,
    ) {
        for line in output.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() >= 2 {
                let status = match parts[0].chars().next() {
                    Some('A') => FileStatus::Added,
                    Some('D') => FileStatus::Deleted,
                    Some('R') => FileStatus::Renamed,
                    _ => FileStatus::Modified,
                };
                // For renames, parts[1] is old name, parts[2] is the new name
                let path = if parts[0].starts_with('R') && parts.len() >= 3 {
                    rename_map.insert(parts[2].to_owned(), parts[1].to_owned());
                    parts[2]
                } else {
                    parts[1]
                };
                changes.insert(path.to_owned(), status);
            }
        }
    }

    /// Get untracked files (not in git index, not ignored)
    fn get_untracked_files(&self) -> Result<Vec<String>, LocalGitError> {
        let output = self.run_git(&["ls-files", "--others", "--exclude-standard"])?;
        Ok(output.lines().map(std::borrow::ToOwned::to_owned).collect())
    }

    /// Check if a file is tracked by git (in the index)
    pub fn is_file_tracked(&self, file_path: &str) -> Result<bool, LocalGitError> {
        let output = self.run_git(&["ls-files", file_path])?;
        Ok(!output.trim().is_empty())
    }

    /// Get all files including gitignored (for browsing, not review)
    /// Uses git ls-files with different flags to get everything
    pub fn list_all_files(&self, comparison: &Comparison) -> Result<Vec<FileEntry>, LocalGitError> {
        // Get changed files with their status
        let (mut file_status, rename_map) = self.get_changed_files(comparison)?;

        // Add untracked files
        if self.include_working_tree(comparison) {
            if let Ok(untracked) = self.get_untracked_files() {
                for path in untracked {
                    file_status.entry(path).or_insert(FileStatus::Untracked);
                }
            }
        }

        // Get tracked files
        let tracked = self.run_git(&["ls-files"])?;
        let mut all_files: HashSet<String> = HashSet::new();
        for line in tracked.lines() {
            all_files.insert(line.to_owned());
        }

        // Ensure all changed/untracked files are included in the tree
        for path in file_status.keys() {
            all_files.insert(path.clone());
        }

        // Get gitignored entries using --directory to collapse entire ignored
        // directories into a single entry (avoids listing 100K+ files in node_modules, etc.)
        let mut gitignored_dirs: HashSet<String> = HashSet::new();
        if let Ok(ignored) = self.run_git(&[
            "ls-files",
            "--others",
            "--ignored",
            "--exclude-standard",
            "--directory",
        ]) {
            for line in ignored.lines() {
                if let Some(dir_path) = line.strip_suffix('/') {
                    // Directory entry — add as a gitignored directory
                    gitignored_dirs.insert(dir_path.to_owned());
                } else {
                    // Individual file
                    all_files.insert(line.to_owned());
                    file_status
                        .entry(line.to_owned())
                        .or_insert(FileStatus::Gitignored);
                }
            }
        }

        Ok(build_file_tree(
            all_files,
            &file_status,
            &gitignored_dirs,
            Some(&self.repo_path),
            &rename_map,
        ))
    }

    /// List contents of a directory (used for lazy-loading gitignored directories).
    ///
    /// Returns a flat list of FileEntry items for the immediate children of the
    /// specified directory. Subdirectories are returned as collapsed entries.
    /// Broken symlinks are hidden (VS Code behavior).
    pub fn list_directory_contents(&self, dir_path: &str) -> Result<Vec<FileEntry>, LocalGitError> {
        use std::fs;

        let full_path = self.repo_path.join(dir_path);
        if !full_path.is_dir() {
            return Err(LocalGitError::Git(format!("Not a directory: {dir_path}")));
        }

        let mut entries = Vec::new();

        let read_dir = fs::read_dir(&full_path)
            .map_err(|e| LocalGitError::Git(format!("Failed to read directory {dir_path}: {e}")))?;

        for entry in read_dir {
            let entry = entry
                .map_err(|e| LocalGitError::Git(format!("Failed to read directory entry: {e}")))?;

            let file_name = entry.file_name().to_string_lossy().to_string();

            // Skip hidden files/directories (starting with .)
            if file_name.starts_with('.') {
                continue;
            }

            let entry_path = entry.path();

            // Use symlink_metadata to detect symlinks (doesn't follow the link)
            let metadata = match fs::symlink_metadata(&entry_path) {
                Ok(m) => m,
                Err(_) => continue, // Skip entries we can't stat
            };

            let is_symlink = metadata.file_type().is_symlink();
            let mut symlink_target = None;
            let is_directory;

            if is_symlink {
                // Get the symlink target path
                symlink_target = fs::read_link(&entry_path)
                    .ok()
                    .map(|p| p.to_string_lossy().to_string());

                // Check if target exists (follow the link)
                match fs::metadata(&entry_path) {
                    Ok(target_meta) => {
                        // Symlink target exists - use its type
                        is_directory = target_meta.is_dir();
                    }
                    Err(_) => {
                        // Broken symlink - skip it (VS Code behavior)
                        continue;
                    }
                }
            } else {
                is_directory = metadata.is_dir();
            }

            let relative_path = if dir_path.is_empty() {
                file_name.clone()
            } else {
                format!("{dir_path}/{file_name}")
            };

            entries.push(FileEntry {
                name: file_name,
                path: relative_path,
                is_directory,
                children: if is_directory { Some(vec![]) } else { None },
                status: Some(FileStatus::Gitignored),
                is_symlink,
                symlink_target,
                renamed_from: None,
            });
        }

        // Sort: directories first, then alphabetically (case-insensitive)
        entries.sort_by(|a, b| {
            b.is_directory
                .cmp(&a.is_directory)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });

        Ok(entries)
    }

    /// Stage a single file (git add -- <path>)
    pub fn stage_file(&self, path: &str) -> Result<(), LocalGitError> {
        self.run_git(&["add", "--", path])?;
        Ok(())
    }

    /// Unstage a single file (git restore --staged -- <path>)
    pub fn unstage_file(&self, path: &str) -> Result<(), LocalGitError> {
        self.run_git(&["restore", "--staged", "--", path])?;
        Ok(())
    }

    /// Stage all changes (git add -A)
    pub fn stage_all(&self) -> Result<(), LocalGitError> {
        self.run_git(&["add", "-A"])?;
        Ok(())
    }

    /// Unstage all staged changes (git restore --staged .)
    pub fn unstage_all(&self) -> Result<(), LocalGitError> {
        self.run_git(&["restore", "--staged", "."])?;
        Ok(())
    }

    /// Run a git command with data piped to stdin.
    fn run_git_with_stdin(&self, args: &[&str], input: &[u8]) -> Result<String, LocalGitError> {
        let mut child = Command::new("git")
            .args(args)
            .current_dir(&self.repo_path)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()?;

        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(input)?;
        }

        let output = child.wait_with_output()?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(LocalGitError::Git(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ))
        }
    }

    /// Get the raw diff for a single file.
    ///
    /// When `cached` is true, returns the staged diff (`git diff --cached`).
    /// When false, returns the unstaged diff (`git diff`).
    pub fn get_raw_file_diff(
        &self,
        file_path: &str,
        cached: bool,
    ) -> Result<String, LocalGitError> {
        let mut args = vec![
            "diff",
            "--histogram",
            "--no-renames",
            "--src-prefix=a/",
            "--dst-prefix=b/",
        ];
        if cached {
            args.push("--cached");
        }
        args.push("--");
        args.push(file_path);
        self.run_git(&args)
    }

    /// Stage specific hunks in a file by their content hashes.
    ///
    /// Gets the unstaged diff, builds a selective patch containing only
    /// the specified hunks, then applies it to the index via `git apply --cached`.
    pub fn stage_hunks(
        &self,
        file_path: &str,
        content_hashes: &[String],
    ) -> Result<(), LocalGitError> {
        let raw_diff = self.get_raw_file_diff(file_path, false)?;
        if raw_diff.is_empty() {
            return Err(LocalGitError::Git(
                "No unstaged changes for this file".to_owned(),
            ));
        }

        let patch = build_selective_patch(&raw_diff, file_path, content_hashes)?;
        self.run_git_with_stdin(&["apply", "--cached", "--allow-empty"], patch.as_bytes())?;
        Ok(())
    }

    /// Unstage specific hunks in a file by their content hashes.
    ///
    /// Gets the staged diff, builds a selective patch containing only
    /// the specified hunks, then reverse-applies it from the index.
    pub fn unstage_hunks(
        &self,
        file_path: &str,
        content_hashes: &[String],
    ) -> Result<(), LocalGitError> {
        let raw_diff = self.get_raw_file_diff(file_path, true)?;
        if raw_diff.is_empty() {
            return Err(LocalGitError::Git(
                "No staged changes for this file".to_owned(),
            ));
        }

        let patch = build_selective_patch(&raw_diff, file_path, content_hashes)?;
        self.run_git_with_stdin(
            &["apply", "--cached", "--reverse", "--allow-empty"],
            patch.as_bytes(),
        )?;
        Ok(())
    }

    /// Search file contents using git grep
    ///
    /// Returns matches from tracked files in the repository.
    /// Uses git grep for performance (parallel, respects .gitignore).
    pub fn search_contents(
        &self,
        query: &str,
        case_sensitive: bool,
        max_results: usize,
    ) -> Result<Vec<SearchMatch>, LocalGitError> {
        if query.is_empty() {
            return Ok(Vec::new());
        }

        let mut args = vec!["grep", "-n", "--column", "--no-color"];

        if !case_sensitive {
            args.push("-i");
        }

        // Use fixed strings (literal) to avoid regex interpretation issues
        args.push("-F");
        args.push("--");
        args.push(query);

        // Run git grep - note: returns exit code 1 if no matches, which is not an error
        let output = Command::new("git")
            .args(&args)
            .current_dir(&self.repo_path)
            .output()?;

        // Exit code 1 means no matches found - return empty vec
        if !output.status.success() && output.status.code() != Some(1) {
            return Err(LocalGitError::Git(
                String::from_utf8_lossy(&output.stderr).to_string(),
            ));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut matches = Vec::new();

        for line in stdout.lines() {
            if matches.len() >= max_results {
                break;
            }

            // Parse git grep output: filepath:line:column:content
            // Use splitn to handle colons in the content
            let parts: Vec<&str> = line.splitn(4, ':').collect();
            if parts.len() >= 4 {
                let file_path = parts[0].to_owned();
                let line_number = parts[1].parse::<u32>().unwrap_or(0);
                let column = parts[2].parse::<u32>().unwrap_or(0);
                let line_content = parts[3].to_owned();

                if line_number > 0 && column > 0 {
                    matches.push(SearchMatch {
                        file_path,
                        line_number,
                        column,
                        line_content,
                    });
                }
            }
        }

        Ok(matches)
    }
}

/// Symlink info for a file path
struct SymlinkInfo {
    is_symlink: bool,
    target: Option<String>,
    /// If symlink, whether the target is a directory
    target_is_dir: bool,
}

/// Build a file tree from file paths and statuses.
/// Shared helper used by both `list_files()` and `list_all_files()`.
/// When repo_path is provided, symlinks are detected and broken symlinks are filtered out.
#[expect(
    clippy::needless_pass_by_value,
    reason = "takes ownership for consistency with callers that build and pass the set"
)]
fn build_file_tree(
    all_files: HashSet<String>,
    file_status: &HashMap<String, FileStatus>,
    gitignored_dirs: &HashSet<String>,
    repo_path: Option<&std::path::Path>,
    rename_map: &HashMap<String, String>,
) -> Vec<FileEntry> {
    use std::fs;

    let mut entries: HashMap<String, FileEntry> = HashMap::new();

    // Pre-compute symlink info for all files if repo_path is provided
    let symlink_info: HashMap<String, SymlinkInfo> = if let Some(repo) = repo_path {
        all_files
            .iter()
            .map(|path| {
                let full_path = repo.join(path);
                let info = match fs::symlink_metadata(&full_path) {
                    Ok(metadata) => {
                        let is_symlink = metadata.file_type().is_symlink();
                        if is_symlink {
                            let target_is_dir = fs::metadata(&full_path)
                                .map(|m| m.is_dir())
                                .unwrap_or(false);
                            let target = fs::read_link(&full_path)
                                .ok()
                                .map(|p| p.to_string_lossy().to_string());
                            SymlinkInfo {
                                is_symlink: true,
                                target,
                                target_is_dir,
                            }
                        } else {
                            SymlinkInfo {
                                is_symlink: false,
                                target: None,
                                target_is_dir: false,
                            }
                        }
                    }
                    Err(_) => {
                        // File doesn't exist on disk (e.g., deleted file) — treat as regular file
                        SymlinkInfo {
                            is_symlink: false,
                            target: None,
                            target_is_dir: false,
                        }
                    }
                };
                (path.clone(), info)
            })
            .collect()
    } else {
        // No repo path - no symlink detection
        all_files
            .iter()
            .map(|path| {
                (
                    path.clone(),
                    SymlinkInfo {
                        is_symlink: false,
                        target: None,
                        target_is_dir: false,
                    },
                )
            })
            .collect()
    };

    // Filter all_files to only include files that passed symlink check
    let valid_files: HashSet<String> = symlink_info.keys().cloned().collect();

    // Collect all directories (from file paths + gitignored directories)
    let mut all_dirs: HashSet<String> = HashSet::new();
    for path in &valid_files {
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
    // Add gitignored directories and their parent directories
    for dir_path in gitignored_dirs {
        all_dirs.insert(dir_path.clone());
        let mut current = PathBuf::from(dir_path);
        while let Some(parent) = current.parent() {
            let parent_str = parent.to_string_lossy().to_string();
            if parent_str.is_empty() {
                break;
            }
            all_dirs.insert(parent_str);
            current = parent.to_path_buf();
        }
    }

    // Pre-compute symlink info for directories if repo_path is provided
    let dir_symlink_info: HashMap<String, SymlinkInfo> = if let Some(repo) = repo_path {
        all_dirs
            .iter()
            .filter_map(|path| {
                let full_path = repo.join(path);
                let metadata = fs::symlink_metadata(&full_path).ok()?;
                let is_symlink = metadata.file_type().is_symlink();

                if is_symlink {
                    // Check if target exists
                    if fs::metadata(&full_path).is_err() {
                        // Broken symlink - return None to filter it out
                        return None;
                    }
                    let target = fs::read_link(&full_path)
                        .ok()
                        .map(|p| p.to_string_lossy().to_string());
                    Some((
                        path.clone(),
                        SymlinkInfo {
                            is_symlink: true,
                            target,
                            target_is_dir: true, // Directories are always directories
                        },
                    ))
                } else {
                    Some((
                        path.clone(),
                        SymlinkInfo {
                            is_symlink: false,
                            target: None,
                            target_is_dir: false,
                        },
                    ))
                }
            })
            .collect()
    } else {
        all_dirs
            .iter()
            .map(|path| {
                (
                    path.clone(),
                    SymlinkInfo {
                        is_symlink: false,
                        target: None,
                        target_is_dir: false,
                    },
                )
            })
            .collect()
    };

    // Filter directories to only include those that passed symlink check
    let valid_dirs: HashSet<String> = dir_symlink_info.keys().cloned().collect();

    // Create directory entries
    for dir_path in &valid_dirs {
        let name = PathBuf::from(dir_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = if gitignored_dirs.contains(dir_path) {
            Some(FileStatus::Gitignored)
        } else {
            None
        };

        let symlink = dir_symlink_info.get(dir_path);

        entries.insert(
            dir_path.clone(),
            FileEntry {
                name,
                path: dir_path.clone(),
                is_directory: true,
                children: Some(vec![]),
                status,
                is_symlink: symlink.is_some_and(|s| s.is_symlink),
                symlink_target: symlink.and_then(|s| s.target.clone()),
                renamed_from: None,
            },
        );
    }

    // Create file entries
    for file_path in &valid_files {
        let name = PathBuf::from(file_path)
            .file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let status = file_status.get(file_path).cloned();
        let symlink = symlink_info.get(file_path);

        // If symlink points to a directory, treat it as a directory
        let is_dir_symlink = symlink.is_some_and(|s| s.is_symlink && s.target_is_dir);

        entries.insert(
            file_path.clone(),
            FileEntry {
                name,
                path: file_path.clone(),
                is_directory: is_dir_symlink,
                children: if is_dir_symlink { Some(vec![]) } else { None },
                status,
                is_symlink: symlink.is_some_and(|s| s.is_symlink),
                symlink_target: symlink.and_then(|s| s.target.clone()),
                renamed_from: rename_map.get(file_path).cloned(),
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

    root_entries
}

impl DiffSource for LocalGitSource {
    type Error = LocalGitError;

    fn get_file_lines(
        &self,
        file_path: &str,
        git_ref: &str,
        start_line: u32,
        end_line: u32,
    ) -> Result<Vec<String>, Self::Error> {
        // Get file content at the specified ref
        let ref_spec = format!("{git_ref}:{file_path}");
        let output = self.run_git(&["show", &ref_spec])?;

        // Extract the requested lines (1-indexed)
        let lines: Vec<String> = output
            .lines()
            .skip((start_line.saturating_sub(1)) as usize)
            .take((end_line.saturating_sub(start_line) + 1) as usize)
            .map(std::borrow::ToOwned::to_owned)
            .collect();

        Ok(lines)
    }

    fn list_files(&self, comparison: &Comparison) -> Result<Vec<FileEntry>, Self::Error> {
        // Get changed files with their status
        let (mut file_status, rename_map) = self.get_changed_files(comparison)?;

        // Add untracked files (these are important for review)
        if self.include_working_tree(comparison) {
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

        Ok(build_file_tree(
            all_files,
            &file_status,
            &HashSet::new(),
            Some(&self.repo_path),
            &rename_map,
        ))
    }

    fn get_diff(
        &self,
        comparison: &Comparison,
        file_path: Option<&str>,
    ) -> Result<String, Self::Error> {
        let mut all_diffs = String::new();

        if self.include_working_tree(comparison) {
            // Net diff: merge_base vs working tree (single diff avoids phantom hunks
            // when working tree changes revert committed changes)
            let resolved_head = self.resolve_ref_or_empty_tree("HEAD");
            let merge_base = match self.get_merge_base(&comparison.base, &resolved_head) {
                Ok(b) => b,
                Err(_) => self.resolve_ref_or_empty_tree(&comparison.base),
            };
            let mut args = vec![
                "diff",
                "--histogram",
                "--no-renames",
                "--src-prefix=a/",
                "--dst-prefix=b/",
                &merge_base,
            ];
            if let Some(path) = file_path {
                args.push("--");
                args.push(path);
            }
            if let Ok(output) = self.run_git(&args) {
                all_diffs.push_str(&output);
            }
        } else {
            // Committed diff between base and head refs
            let merge_base = match self.get_merge_base(&comparison.base, &comparison.head) {
                Ok(b) => b,
                Err(_) => self.resolve_ref_or_empty_tree(&comparison.base),
            };
            let resolved_head = self.resolve_ref_or_empty_tree(&comparison.head);
            let range = format!("{merge_base}..{resolved_head}");
            let mut args = vec![
                "diff",
                "--histogram",
                "--no-renames",
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

        Ok(all_diffs)
    }
}

/// Parse a git remote URL into a `RemoteInfo` with org/repo name and browse URL.
///
/// Supported formats:
/// - `https://github.com/org/repo.git`
/// - `https://github.com/org/repo`
/// - `git@github.com:org/repo.git`
/// - `ssh://git@github.com/org/repo.git`
fn parse_remote_url(url: &str) -> Result<RemoteInfo, LocalGitError> {
    // SSH shorthand: git@host:org/repo.git
    if let Some(rest) = url.strip_prefix("git@") {
        if let Some((host, path)) = rest.split_once(':') {
            let path = path.strip_suffix(".git").unwrap_or(path);
            return Ok(RemoteInfo {
                name: path.to_owned(),
                browse_url: format!("https://{host}/{path}"),
            });
        }
    }

    // HTTPS or SSH URL: https://host/org/repo.git or ssh://git@host/org/repo.git
    let without_scheme = url
        .strip_prefix("https://")
        .or_else(|| url.strip_prefix("http://"))
        .or_else(|| url.strip_prefix("ssh://"));

    if let Some(without_scheme) = without_scheme {
        // Strip optional user@ prefix (e.g. git@)
        let without_user = without_scheme
            .split_once('@')
            .map_or(without_scheme, |(_user, rest)| rest);

        // Split into host and path
        if let Some((host, path)) = without_user.split_once('/') {
            let path = path.strip_suffix(".git").unwrap_or(path);
            // Ensure we have at least org/repo (two path segments)
            if path.contains('/') {
                return Ok(RemoteInfo {
                    name: path.to_owned(),
                    browse_url: format!("https://{host}/{path}"),
                });
            }
        }
    }

    Err(LocalGitError::Git(format!(
        "Could not parse remote URL: {url}"
    )))
}

/// Parse `git diff --shortstat` output into (files_changed, insertions, deletions).
///
/// Typical output: ` 3 files changed, 10 insertions(+), 5 deletions(-)\n`
/// Some parts may be absent (e.g., no insertions or no deletions).
fn parse_shortstat(output: &str) -> (u32, u32, u32) {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return (0, 0, 0);
    }

    let mut files: u32 = 0;
    let mut insertions: u32 = 0;
    let mut deletions: u32 = 0;

    // Split on commas: ["3 files changed", " 10 insertions(+)", " 5 deletions(-)"]
    for part in trimmed.split(',') {
        let part = part.trim();
        if part.contains("file") {
            if let Some(n) = part.split_whitespace().next() {
                files = n.parse().unwrap_or(0);
            }
        } else if part.contains("insertion") {
            if let Some(n) = part.split_whitespace().next() {
                insertions = n.parse().unwrap_or(0);
            }
        } else if part.contains("deletion") {
            if let Some(n) = part.split_whitespace().next() {
                deletions = n.parse().unwrap_or(0);
            }
        }
    }

    (files, insertions, deletions)
}

/// Split a single-file diff into a header and individual hunk sections.
///
/// Each hunk section starts with the `@@` line and includes all lines up to
/// (but not including) the next `@@` line or the end of the diff.
fn split_diff_into_sections(raw_diff: &str) -> (String, Vec<String>) {
    let mut header = String::new();
    let mut sections: Vec<String> = Vec::new();
    let mut current_section = String::new();
    let mut in_header = true;

    for line in raw_diff.lines() {
        if line.starts_with("@@") {
            if in_header {
                in_header = false;
            } else {
                // Push previous section
                sections.push(current_section);
                current_section = String::new();
            }
            current_section.push_str(line);
            current_section.push('\n');
        } else if in_header {
            header.push_str(line);
            header.push('\n');
        } else {
            current_section.push_str(line);
            current_section.push('\n');
        }
    }

    // Push last section if any
    if !current_section.is_empty() {
        sections.push(current_section);
    }

    (header, sections)
}

/// Build a selective patch containing only hunks that match the given content hashes.
///
/// Uses the existing `parse_diff()` parser to compute content hashes for each
/// hunk, then pairs them by order with the raw diff sections.
fn build_selective_patch(
    raw_diff: &str,
    file_path: &str,
    content_hashes: &[String],
) -> Result<String, LocalGitError> {
    let hash_set: HashSet<&str> = content_hashes.iter().map(|s| s.as_str()).collect();

    // Parse the diff to get content hashes per hunk
    let parsed_hunks = parse_diff(raw_diff, file_path);

    // Split the raw diff into header + raw sections
    let (header, raw_sections) = split_diff_into_sections(raw_diff);

    if parsed_hunks.len() != raw_sections.len() {
        return Err(LocalGitError::Git(format!(
            "Hunk count mismatch: parser found {} hunks but raw diff has {} sections",
            parsed_hunks.len(),
            raw_sections.len()
        )));
    }

    // Reassemble: header + sections whose content_hash matches
    let mut patch = header;
    let initial_len = patch.len();

    for (parsed, raw_section) in parsed_hunks.iter().zip(&raw_sections) {
        if hash_set.contains(parsed.content_hash.as_str()) {
            patch.push_str(raw_section);
        }
    }

    if patch.len() == initial_len {
        return Err(LocalGitError::Git(
            "No hunks matched the provided content hashes".to_owned(),
        ));
    }

    Ok(patch)
}
