//! File content & diff orchestration — the bulk of the service layer.
//!
//! Each function corresponds to a Tauri command, but takes `&Path` / `&str`
//! instead of owned Strings and returns `anyhow::Result` instead of
//! `Result<T, String>`.

use anyhow::{bail, Context};
use log::{debug, info};
use std::collections::HashSet;
use std::path::Path;
use std::time::Instant;

use crate::diff::parser::{
    compute_content_hash, create_binary_hunk, create_untracked_hunk, parse_diff,
    parse_multi_file_diff, DiffHunk,
};
use crate::sources::github::{GhCliProvider, GitHubPrRef, GitHubProvider};
use crate::sources::local_git::{LocalGitSource, SearchMatch};
use crate::sources::traits::{Comparison, DiffSource, FileEntry};

use super::util::{
    bytes_to_data_url, bytes_to_file_content, extract_file_diff, get_content_type,
    get_image_mime_type,
};
use super::ExpandedContextResult;
use super::FileContent;

/// List files with changes in the comparison.
pub fn list_files(
    repo_path: &Path,
    comparison: &Comparison,
    github_pr: Option<&GitHubPrRef>,
) -> anyhow::Result<Vec<FileEntry>> {
    let t0 = Instant::now();
    debug!(
        "[list_files] repo_path={}, comparison={comparison:?}",
        repo_path.display()
    );

    // PR routing: use gh CLI to get file list
    if let Some(pr) = github_pr {
        let provider = GhCliProvider::new(repo_path.to_path_buf());
        let files = provider
            .get_pull_request_files(pr.number)
            .context("Failed to list PR files")?;
        let result = crate::sources::github::pr_files_to_file_entries(files);
        info!(
            "[list_files] SUCCESS (PR #{}): {} entries in {:?}",
            pr.number,
            result.len(),
            t0.elapsed()
        );
        return Ok(result);
    }

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
    let result = source
        .list_files(comparison)
        .context("Failed to list files")?;
    info!(
        "[list_files] SUCCESS: {} entries in {:?}",
        result.len(),
        t0.elapsed()
    );
    Ok(result)
}

/// List all files in the repository (changed + unchanged, for file finder).
pub fn list_all_files(repo_path: &Path, comparison: &Comparison) -> anyhow::Result<Vec<FileEntry>> {
    let t0 = Instant::now();
    debug!(
        "[list_all_files] repo_path={}, comparison={comparison:?}",
        repo_path.display()
    );
    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
    let result = source
        .list_all_files(comparison)
        .context("Failed to list all files")?;
    info!(
        "[list_all_files] SUCCESS: {} entries in {:?}",
        result.len(),
        t0.elapsed()
    );
    Ok(result)
}

/// List all tracked files in the repository (no comparison needed, for browse mode).
pub fn list_repo_files(repo_path: &Path) -> anyhow::Result<Vec<FileEntry>> {
    let t0 = Instant::now();
    debug!("[list_repo_files] repo_path={}", repo_path.display());
    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
    let result = source
        .list_tracked_files()
        .context("Failed to list tracked files")?;
    info!(
        "[list_repo_files] SUCCESS: {} entries in {:?}",
        result.len(),
        t0.elapsed()
    );
    Ok(result)
}

/// List contents of a directory (for lazy-loading gitignored directories).
pub fn list_directory_contents(repo_path: &Path, dir_path: &str) -> anyhow::Result<Vec<FileEntry>> {
    debug!(
        "[list_directory_contents] repo_path={}, dir_path={dir_path}",
        repo_path.display()
    );
    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
    let result = source
        .list_directory_contents(dir_path)
        .context("Failed to list directory")?;
    info!(
        "[list_directory_contents] SUCCESS: {} entries in {dir_path}",
        result.len()
    );
    Ok(result)
}

/// Get file content and diff hunks.
pub fn get_file_content(
    repo_path: &Path,
    file_path: &str,
    comparison: &Comparison,
    github_pr: Option<&GitHubPrRef>,
) -> anyhow::Result<FileContent> {
    let t0 = Instant::now();
    debug!(
        "[get_file_content] repo_path={}, file_path={file_path}, comparison={comparison:?}",
        repo_path.display()
    );

    // PR routing: get diff from gh CLI and content from local git refs
    if let Some(pr) = github_pr {
        return get_file_content_for_pr(repo_path, file_path, pr);
    }

    let full_path = repo_path.join(file_path);
    let file_exists = full_path.exists();

    debug!(
        "[get_file_content] full_path={}, exists={}",
        full_path.display(),
        file_exists
    );

    // Validate the logical path doesn't escape the repo.
    if file_path.contains("..") || file_path.starts_with('/') || file_path.starts_with('\\') {
        bail!("Path traversal detected: file path escapes repository");
    }

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;

    if !file_exists {
        debug!("[get_file_content] handling file not on disk");
        let diff_output = source
            .get_diff(comparison, Some(file_path))
            .context("Failed to get diff")?;

        let hunks = if diff_output.is_empty() {
            vec![]
        } else {
            parse_diff(&diff_output, file_path)
        };

        let old_ref = &comparison.base;
        let old_content = match source.get_file_bytes(file_path, old_ref) {
            Ok(bytes) => String::from_utf8(bytes).ok(),
            Err(_) => None,
        };

        // For committed comparisons, the file may exist on the head ref even
        // though it's not on disk.
        let content = if !source.include_working_tree(comparison) {
            match source.get_file_bytes(file_path, &comparison.head) {
                Ok(bytes) => {
                    debug!(
                        "[get_file_content] got content from head ref {}: {} bytes",
                        comparison.head,
                        bytes.len()
                    );
                    String::from_utf8(bytes).unwrap_or_default()
                }
                Err(e) => {
                    debug!(
                        "[get_file_content] no content at head ref {}: {e}",
                        comparison.head
                    );
                    String::new()
                }
            }
        } else {
            String::new()
        };

        return Ok(FileContent {
            content,
            old_content,
            diff_patch: diff_output,
            hunks,
            content_type: "text".to_owned(),
            image_data_url: None,
            old_image_data_url: None,
        });
    }

    // Symlink directories: return the link target as content
    if full_path.is_dir() {
        let is_symlink = full_path
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink());

        if !is_symlink {
            bail!("Path is a directory: {file_path}");
        }

        let target = std::fs::read_link(&full_path)
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let content = format!("{target}\n");
        let content_hash = compute_content_hash(content.as_bytes());
        let hunks = vec![create_untracked_hunk(
            file_path,
            &content_hash,
            Some(&content),
        )];

        return Ok(FileContent {
            content,
            old_content: None,
            diff_patch: String::new(),
            hunks,
            content_type: "text".to_owned(),
            image_data_url: None,
            old_image_data_url: None,
        });
    }

    let content_type = get_content_type(file_path);
    let ext = file_path.rsplit('.').next().unwrap_or("");
    let mime_type = get_image_mime_type(ext);

    if content_type == "image" || content_type == "svg" {
        debug!("[get_file_content] handling as image/svg: {content_type}");

        let current_bytes = std::fs::read(&full_path)
            .with_context(|| format!("{}: failed to read", full_path.display()))?;

        let image_data_url = mime_type.map(|mt| bytes_to_data_url(&current_bytes, mt));

        let content = if content_type == "svg" {
            String::from_utf8_lossy(&current_bytes).to_string()
        } else {
            String::new()
        };

        let diff_output = source
            .get_diff(comparison, Some(file_path))
            .context("Failed to get diff")?;

        let old_image_data_url = if diff_output.is_empty() {
            None
        } else {
            let old_ref = if source.include_working_tree(comparison) {
                "HEAD".to_owned()
            } else {
                comparison.base.clone()
            };

            match source.get_file_bytes(file_path, &old_ref) {
                Ok(old_bytes) => {
                    debug!(
                        "[get_file_content] got old image bytes: {} bytes",
                        old_bytes.len()
                    );
                    mime_type.map(|mt| bytes_to_data_url(&old_bytes, mt))
                }
                Err(e) => {
                    debug!("[get_file_content] no old version available: {e}");
                    None
                }
            }
        };

        let hunks = if diff_output.is_empty() {
            let content_hash = compute_content_hash(&current_bytes);
            vec![create_untracked_hunk(file_path, &content_hash, None)]
        } else if content_type == "svg" {
            parse_diff(&diff_output, file_path)
        } else {
            vec![create_binary_hunk(file_path)]
        };

        info!("[get_file_content] SUCCESS (image)");
        return Ok(FileContent {
            content,
            old_content: None,
            diff_patch: diff_output,
            hunks,
            content_type,
            image_data_url,
            old_image_data_url,
        });
    }

    let content = std::fs::read_to_string(&full_path)
        .with_context(|| format!("{}: failed to read", full_path.display()))?;
    debug!(
        "[get_file_content] file content length: {} bytes",
        content.len()
    );

    let diff_output = source
        .get_diff(comparison, Some(file_path))
        .context("Failed to get diff")?;
    debug!(
        "[get_file_content] diff output length: {} bytes",
        diff_output.len()
    );

    let hunks = if diff_output.is_empty() {
        let is_tracked = source.is_file_tracked(file_path).unwrap_or(false);
        if is_tracked {
            debug!("[get_file_content] no diff, file is tracked (unchanged)");
            vec![]
        } else {
            debug!("[get_file_content] no diff, file is untracked (new)");
            let content_hash = compute_content_hash(content.as_bytes());
            vec![create_untracked_hunk(
                file_path,
                &content_hash,
                Some(&content),
            )]
        }
    } else {
        debug!("[get_file_content] parsing diff...");
        let parsed = parse_diff(&diff_output, file_path);
        debug!("[get_file_content] parsed {} hunks", parsed.len());
        parsed
    };

    let (old_content, final_content) = if diff_output.is_empty() {
        (None, content)
    } else if source.include_working_tree(comparison) {
        let old_ref = &comparison.base;
        let old = match source.get_file_bytes(file_path, old_ref) {
            Ok(bytes) => {
                debug!(
                    "[get_file_content] got old content from {old_ref}: {} bytes",
                    bytes.len()
                );
                String::from_utf8(bytes).ok()
            }
            Err(e) => {
                debug!("[get_file_content] no old version available from {old_ref}: {e}");
                None
            }
        };
        (old, content)
    } else {
        let old = match source.get_file_bytes(file_path, &comparison.base) {
            Ok(bytes) => {
                debug!(
                    "[get_file_content] got old content from {}: {} bytes",
                    comparison.base,
                    bytes.len()
                );
                String::from_utf8(bytes).ok()
            }
            Err(e) => {
                debug!(
                    "[get_file_content] no old version at {}: {}",
                    comparison.base, e
                );
                None
            }
        };
        let new = match source.get_file_bytes(file_path, &comparison.head) {
            Ok(bytes) => {
                debug!(
                    "[get_file_content] got new content from {}: {} bytes",
                    comparison.head,
                    bytes.len()
                );
                String::from_utf8(bytes).ok()
            }
            Err(e) => {
                debug!(
                    "[get_file_content] no new version at {}: {}",
                    comparison.head, e
                );
                None
            }
        };
        (old, new.unwrap_or_default())
    };

    let result = FileContent {
        content: final_content,
        old_content,
        diff_patch: diff_output,
        hunks,
        content_type,
        image_data_url: None,
        old_image_data_url: None,
    };
    let payload_estimate = result.content.len()
        + result.old_content.as_ref().map_or(0, |s| s.len())
        + result.diff_patch.len();
    info!(
        "[get_file_content] SUCCESS file={file_path} hunks={} payload≈{}KB in {:?}",
        result.hunks.len(),
        payload_estimate / 1024,
        t0.elapsed()
    );
    Ok(result)
}

/// Get file content for a PR by extracting the file's diff from `gh pr diff`.
pub fn get_file_content_for_pr(
    repo_path: &Path,
    file_path: &str,
    pr: &GitHubPrRef,
) -> anyhow::Result<FileContent> {
    let provider = GhCliProvider::new(repo_path.to_path_buf());

    // Get the full PR diff and extract this file's portion
    let full_diff = provider
        .get_pull_request_diff(pr.number)
        .context("Failed to get PR diff")?;

    // Extract the diff section for this specific file
    let file_diff = extract_file_diff(&full_diff, file_path);

    let hunks = if file_diff.is_empty() {
        vec![]
    } else {
        parse_diff(&file_diff, file_path)
    };

    let content_type = get_content_type(file_path);

    // For images, just return minimal info with the diff
    if content_type == "image" {
        return Ok(FileContent {
            content: String::new(),
            old_content: None,
            diff_patch: file_diff,
            hunks,
            content_type,
            image_data_url: None,
            old_image_data_url: None,
        });
    }

    // Try to get old/new content from local git refs
    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;

    let old_content = source
        .get_file_bytes(file_path, &pr.base_ref_name)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok());

    // Try the head ref first; if not available locally, try fetching
    let new_content = source
        .get_file_bytes(file_path, &pr.head_ref_name)
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
        .or_else(|| {
            // Try fetching the PR head ref
            let fetch_ref = format!("pull/{}/head:refs/pr/{}", pr.number, pr.number);
            let _ = std::process::Command::new("git")
                .args(["fetch", "origin", &fetch_ref])
                .current_dir(repo_path)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status();

            let pr_ref = format!("refs/pr/{}", pr.number);
            source
                .get_file_bytes(file_path, &pr_ref)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
        });

    let content = new_content.unwrap_or_default();

    Ok(FileContent {
        content,
        old_content,
        diff_patch: file_diff,
        hunks,
        content_type,
        image_data_url: None,
        old_image_data_url: None,
    })
}

/// Batch-load all hunks for multiple files in a single call.
pub fn get_all_hunks(
    repo_path: &Path,
    comparison: &Comparison,
    file_paths: &[String],
) -> anyhow::Result<Vec<DiffHunk>> {
    let t0 = Instant::now();
    debug!(
        "[get_all_hunks] repo_path={}, {} files",
        repo_path.display(),
        file_paths.len()
    );

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;

    // Single git diff call for all files at once
    let diff_start = Instant::now();
    let full_diff = source
        .get_diff(comparison, None)
        .context("Failed to get diff")?;
    debug!(
        "[get_all_hunks] git diff: {}KB in {:?}",
        full_diff.len() / 1024,
        diff_start.elapsed()
    );

    // Try hunk cache before parsing
    let diff_hash = crate::diff::cache::compute_hash(&full_diff);
    let mut all_hunks =
        if let Ok(Some(cached)) = crate::diff::cache::load(repo_path, comparison, &diff_hash) {
            debug!("[get_all_hunks] hunk cache HIT");
            cached
        } else {
            let parse_start = Instant::now();
            let parsed = parse_multi_file_diff(&full_diff);
            debug!(
                "[get_all_hunks] parsed {} hunks in {:?}",
                parsed.len(),
                parse_start.elapsed()
            );
            // Save to cache (best-effort)
            let _ = crate::diff::cache::save(repo_path, comparison, &diff_hash, &parsed);
            parsed
        };
    drop(full_diff);

    // Build a set of file paths that got hunks from the diff
    let files_with_hunks: HashSet<String> = all_hunks.iter().map(|h| h.file_path.clone()).collect();

    // For requested files that have no diff hunks, check if they're
    // untracked (new) and create untracked hunks for them
    for fp in file_paths {
        if !files_with_hunks.contains(fp.as_str()) {
            let is_tracked = source.is_file_tracked(fp).unwrap_or(false);
            if !is_tracked {
                let full_path = repo_path.join(fp);
                let (content_hash, text_content) = std::fs::read(&full_path)
                    .map(|bytes| {
                        let hash = compute_content_hash(&bytes);
                        let text = String::from_utf8(bytes).ok();
                        (hash, text)
                    })
                    .unwrap_or_else(|_| ("00000000".to_owned(), None));
                all_hunks.push(create_untracked_hunk(
                    fp,
                    &content_hash,
                    text_content.as_deref(),
                ));
            }
        }
    }

    // Filter to only include hunks for the requested files
    let requested: HashSet<&str> = file_paths.iter().map(|s| s.as_str()).collect();
    all_hunks.retain(|h| requested.contains(h.file_path.as_str()));

    info!(
        "[get_all_hunks] SUCCESS: {} hunks from {} files in {:?}",
        all_hunks.len(),
        file_paths.len(),
        t0.elapsed()
    );
    Ok(all_hunks)
}

/// Get file content for working tree diff (staged or unstaged).
pub fn get_working_tree_file_content(
    repo_path: &Path,
    file_path: &str,
    cached: bool,
) -> anyhow::Result<FileContent> {
    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
    let raw_diff = source
        .get_raw_file_diff(file_path, cached)
        .context("Failed to get raw file diff")?;

    let hunks = if raw_diff.is_empty() {
        vec![]
    } else {
        parse_diff(&raw_diff, file_path)
    };

    let old_content = if cached {
        // Staged diff: old side is HEAD
        source
            .get_file_bytes(file_path, "HEAD")
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
    } else {
        // Unstaged diff: old side is the index, falling back to HEAD
        source
            .get_file_bytes(file_path, ":0")
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .or_else(|| {
                source
                    .get_file_bytes(file_path, "HEAD")
                    .ok()
                    .and_then(|b| String::from_utf8(b).ok())
            })
    };

    let content = if cached {
        // Staged diff: new side is the index
        source
            .get_file_bytes(file_path, ":0")
            .ok()
            .and_then(|b| String::from_utf8(b).ok())
            .unwrap_or_default()
    } else {
        // Unstaged diff: new side is the working tree
        let full_path = repo_path.join(file_path);
        std::fs::read_to_string(&full_path).unwrap_or_default()
    };

    let content_type = get_content_type(file_path);

    Ok(FileContent {
        content,
        old_content,
        diff_patch: raw_diff,
        hunks,
        content_type,
        image_data_url: None,
        old_image_data_url: None,
    })
}

/// Get expanded context around a range of lines.
pub fn get_expanded_context(
    repo_path: &Path,
    file_path: &str,
    comparison: &Comparison,
    start_line: u32,
    end_line: u32,
    github_pr: Option<&GitHubPrRef>,
) -> anyhow::Result<ExpandedContextResult> {
    debug!(
        "[get_expanded_context] file={file_path}, lines {start_line}-{end_line}, comparison={comparison:?}"
    );

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;

    // For PRs, use the head ref name (best-effort)
    let git_ref = if let Some(pr) = github_pr {
        pr.head_ref_name.clone()
    } else if source.include_working_tree(comparison) {
        "HEAD".to_owned()
    } else {
        comparison.head.clone()
    };

    let lines = source
        .get_file_lines(file_path, &git_ref, start_line, end_line)
        .context("Failed to get file lines")?;

    info!("[get_expanded_context] SUCCESS: {} lines", lines.len());

    Ok(ExpandedContextResult {
        lines,
        start_line,
        end_line,
    })
}

/// Read a raw file from disk (no git needed, for standalone file viewing).
pub fn read_raw_file(path: &Path) -> anyhow::Result<FileContent> {
    let t0 = Instant::now();
    let path_str = path.to_string_lossy();

    if !path.exists() {
        bail!("File not found: {path_str}");
    }
    if !path.is_file() {
        bail!("Not a file: {path_str}");
    }

    let bytes = std::fs::read(path).context("Failed to read file")?;
    let result = bytes_to_file_content(bytes, &path_str)?;
    info!("[read_raw_file] path={path_str} in {:?}", t0.elapsed());
    Ok(result)
}

/// Get raw file content at HEAD from a git repo (no diff, browse mode).
pub fn get_file_raw_content(repo_path: &Path, file_path: &str) -> anyhow::Result<FileContent> {
    let t0 = Instant::now();
    debug!(
        "[get_file_raw_content] repo_path={}, file_path={file_path}",
        repo_path.display()
    );

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;

    let bytes = source
        .get_file_bytes(file_path, "HEAD")
        .context("Failed to get file at HEAD")?;

    let result = bytes_to_file_content(bytes, file_path)?;
    info!(
        "[get_file_raw_content] SUCCESS file={file_path} in {:?}",
        t0.elapsed()
    );
    Ok(result)
}

/// List files in a plain directory (no git needed, for Layer 0 browsing).
pub fn list_directory_plain(dir_path: &Path) -> anyhow::Result<Vec<FileEntry>> {
    let t0 = Instant::now();
    let dir_str = dir_path.to_string_lossy();

    if !dir_path.is_dir() {
        bail!("Not a directory: {dir_str}");
    }

    let mut entries: Vec<FileEntry> = Vec::new();
    let read_dir = std::fs::read_dir(dir_path).context("Failed to read directory")?;

    for entry in read_dir {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_name = entry.file_name().to_string_lossy().to_string();
        // Skip hidden files
        if file_name.starts_with('.') {
            continue;
        }
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let metadata = entry.metadata().ok();
        let entry_path = file_name.clone();

        entries.push(FileEntry {
            name: file_name,
            path: entry_path,
            is_directory: file_type.is_dir(),
            children: if file_type.is_dir() {
                Some(vec![])
            } else {
                None
            },
            status: None,
            is_symlink: file_type.is_symlink(),
            symlink_target: None,
            renamed_from: None,
            size: metadata.as_ref().map(|m| m.len()),
            modified_at: metadata
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs()),
        });
    }

    // Sort: directories first, then by name
    entries.sort_by(|a, b| {
        b.is_directory
            .cmp(&a.is_directory)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    info!(
        "[list_directory_plain] {} entries in {:?}",
        entries.len(),
        t0.elapsed()
    );
    Ok(entries)
}

/// Search file contents using git grep.
pub fn search_file_contents(
    repo_path: &Path,
    query: &str,
    case_sensitive: bool,
    max_results: usize,
) -> anyhow::Result<Vec<SearchMatch>> {
    let t0 = Instant::now();
    debug!(
        "[search_file_contents] repo_path={}, query={query}, case_sensitive={case_sensitive}, max_results={max_results}",
        repo_path.display()
    );

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;

    let results = source
        .search_contents(query, case_sensitive, max_results)
        .context("Failed to search")?;

    info!(
        "[search_file_contents] SUCCESS: {} matches in {:?}",
        results.len(),
        t0.elapsed()
    );
    Ok(results)
}
