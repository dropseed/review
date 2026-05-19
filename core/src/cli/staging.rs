//! `review changes`, `review stage`, `review unstage` — git-index operations.
//!
//! These commands work on the working tree and the git index directly. They
//! do not read or write review state, so they need no saved review.

use std::collections::BTreeMap;
use std::path::PathBuf;

use clap::Args;
use serde::Serialize;

use crate::classify::classify_hunks_static;
use crate::diff::parser::{parse_diff, parse_multi_file_diff, DiffHunk};
use crate::sources::local_git::LocalGitSource;

use super::common::{
    classified_labels, hunk_line_stats, parse_hunk_target, print_json, render_hunk_diff, HunkTarget,
};
use super::get_repo_path;

#[derive(Debug, Args)]
pub struct ChangesArgs {
    /// Repository path (defaults to the current directory)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Include the diff text of each hunk
    #[arg(long)]
    pub diff: bool,
    /// Show only staged hunks
    #[arg(long)]
    pub staged: bool,
    /// Show only unstaged hunks
    #[arg(long)]
    pub unstaged: bool,
    /// Filter to a file-path glob (e.g. "src/*.rs")
    #[arg(long)]
    pub file: Option<String>,
}

#[derive(Debug, Args)]
pub struct StageArgs {
    /// Repository path (defaults to the current directory)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// Hunk IDs (`file:hash`) or file paths
    #[arg(required = true)]
    pub targets: Vec<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// One working-tree change: a hunk, or a whole untracked file.
#[derive(Debug, Serialize)]
struct ChangeRow {
    id: String,
    file: String,
    staged: bool,
    untracked: bool,
    additions: usize,
    deletions: usize,
    labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diff: Option<String>,
}

#[derive(Debug, Serialize)]
struct ChangesJson {
    repo: String,
    hunks: Vec<ChangeRow>,
}

#[derive(Debug, Serialize)]
struct StageResultJson {
    action: String,
    done: Vec<String>,
    failed: Vec<String>,
}

/// `review changes` — list uncommitted working-tree changes as hunks.
pub fn run_changes(args: ChangesArgs) -> Result<(), String> {
    let repo_path = get_repo_path(&args.repo)?;
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;
    let status = source.get_status().map_err(|e| e.to_string())?;

    // `--staged` / `--unstaged` narrow the view; neither (or both) shows all.
    let only_staged = args.staged && !args.unstaged;
    let only_unstaged = args.unstaged && !args.staged;
    let want_staged = !only_unstaged;
    let want_unstaged = !only_staged;

    // Parallel vectors: each hunk and whether it is staged.
    let mut hunks: Vec<DiffHunk> = Vec::new();
    let mut staged_flags: Vec<bool> = Vec::new();

    // One `git diff` per side instead of one per file — scales cleanly to
    // large change sets.
    if want_unstaged {
        let diff = source.get_unstaged_diff().unwrap_or_default();
        for hunk in parse_multi_file_diff(&diff) {
            hunks.push(hunk);
            staged_flags.push(false);
        }
    }
    if want_staged {
        let diff = source.get_staged_diff().unwrap_or_default();
        for hunk in parse_multi_file_diff(&diff) {
            hunks.push(hunk);
            staged_flags.push(true);
        }
    }

    let classification = classify_hunks_static(&hunks);

    let file_filter = match &args.file {
        Some(glob) => {
            Some(glob::Pattern::new(glob).map_err(|e| format!("Invalid --file pattern: {e}"))?)
        }
        None => None,
    };

    let mut rows: Vec<ChangeRow> = Vec::new();
    for (hunk, staged) in hunks.iter().zip(&staged_flags) {
        if let Some(pattern) = &file_filter {
            if !pattern.matches(&hunk.file_path) {
                continue;
            }
        }
        let (additions, deletions) = hunk_line_stats(hunk);
        let labels = classified_labels(&classification, &hunk.id);
        rows.push(ChangeRow {
            id: hunk.id.clone(),
            file: hunk.file_path.clone(),
            staged: *staged,
            untracked: false,
            additions,
            deletions,
            labels,
            diff: if args.diff {
                Some(render_hunk_diff(hunk))
            } else {
                None
            },
        });
    }
    if want_unstaged {
        for path in &status.untracked {
            if let Some(pattern) = &file_filter {
                if !pattern.matches(path) {
                    continue;
                }
            }
            rows.push(ChangeRow {
                id: path.clone(),
                file: path.clone(),
                staged: false,
                untracked: true,
                additions: 0,
                deletions: 0,
                labels: Vec::new(),
                diff: None,
            });
        }
    }

    rows.sort_by(|a, b| a.file.cmp(&b.file).then(a.staged.cmp(&b.staged)));

    if args.json {
        print_json(&ChangesJson {
            repo: repo_path,
            hunks: rows,
        });
    } else {
        print_changes_human(&rows);
    }
    Ok(())
}

fn print_changes_human(rows: &[ChangeRow]) {
    if rows.is_empty() {
        println!("No uncommitted changes.");
        return;
    }

    let staged = rows.iter().filter(|r| r.staged).count();
    let unstaged = rows.iter().filter(|r| !r.staged && !r.untracked).count();
    let untracked = rows.iter().filter(|r| r.untracked).count();
    println!("working tree — {staged} staged, {unstaged} unstaged, {untracked} untracked\n");

    let mut current_file = "";
    for row in rows {
        if row.file.as_str() != current_file {
            println!("{}", row.file);
            current_file = row.file.as_str();
        }
        if row.untracked {
            println!("  untracked  (whole file)");
        } else {
            let state = if row.staged { "staged  " } else { "unstaged" };
            let labels = if row.labels.is_empty() {
                String::new()
            } else {
                format!("  {}", row.labels.join(","))
            };
            println!(
                "  {}  {}  +{} -{}{}",
                state, row.id, row.additions, row.deletions, labels
            );
        }
        if let Some(diff) = &row.diff {
            for line in diff.lines() {
                println!("      {line}");
            }
        }
    }
    println!("\nStage:   review stage <hunk-id|file>...");
    println!("Unstage: review unstage <hunk-id|file>...");
}

/// `review stage` / `review unstage` — apply hunks (or whole files) to or
/// from the git index. `unstage` reverses the direction.
pub fn run_stage(args: StageArgs, unstage: bool) -> Result<(), String> {
    let repo_path = get_repo_path(&args.repo)?;
    let source = LocalGitSource::new(PathBuf::from(&repo_path)).map_err(|e| e.to_string())?;

    let mut hunks_by_file: BTreeMap<String, Vec<String>> = BTreeMap::new();
    let mut whole_files: Vec<String> = Vec::new();
    for target in &args.targets {
        match parse_hunk_target(target) {
            HunkTarget::Hunk { file, hash } => hunks_by_file.entry(file).or_default().push(hash),
            HunkTarget::File { path } => whole_files.push(path),
        }
    }

    let side = if unstage { "staged" } else { "unstaged" };
    let mut done: Vec<String> = Vec::new();
    let mut failed: Vec<String> = Vec::new();

    for (file, hashes) in &hunks_by_file {
        // Fetch the working-tree diff once: it validates the requested hashes
        // and is passed straight through to apply them. `stage` reads the
        // unstaged diff; `unstage` reads the staged (`--cached`) diff.
        let raw_diff = source.get_raw_file_diff(file, unstage).unwrap_or_default();
        let available: Vec<String> = parse_diff(&raw_diff, file)
            .into_iter()
            .map(|h| h.content_hash)
            .collect();
        let mut present: Vec<String> = Vec::new();
        for hash in hashes {
            if available.iter().any(|a| a == hash) {
                present.push(hash.clone());
            } else {
                failed.push(format!("{file}:{hash} — no matching {side} hunk"));
            }
        }
        if present.is_empty() {
            continue;
        }
        let result = if unstage {
            source.unstage_hunks_with_diff(file, &raw_diff, &present)
        } else {
            source.stage_hunks_with_diff(file, &raw_diff, &present)
        };
        match result {
            Ok(()) => {
                for hash in &present {
                    done.push(format!("{file}:{hash}"));
                }
            }
            Err(e) => {
                let msg = e.to_string();
                for hash in &present {
                    failed.push(format!("{file}:{hash} — {}", msg.trim()));
                }
            }
        }
    }

    for file in &whole_files {
        let result = if unstage {
            source.unstage_file(file)
        } else {
            source.stage_file(file)
        };
        match result {
            Ok(()) => done.push(file.clone()),
            Err(e) => failed.push(format!("{file} — {}", e.to_string().trim())),
        }
    }

    let action = if unstage { "unstage" } else { "stage" };
    if args.json {
        print_json(&StageResultJson {
            action: action.to_owned(),
            done: done.clone(),
            failed: failed.clone(),
        });
    } else {
        let past = if unstage { "Unstaged" } else { "Staged" };
        if !done.is_empty() {
            println!("{past} {} item(s):", done.len());
            for item in &done {
                println!("  {item}");
            }
        }
        if !failed.is_empty() {
            eprintln!("\n{} item(s) could not be {action}d:", failed.len());
            for item in &failed {
                eprintln!("  {item}");
            }
        }
        if done.is_empty() && failed.is_empty() {
            println!("Nothing to {action}.");
        }
    }

    // Non-zero exit only when nothing succeeded and something failed.
    if done.is_empty() && !failed.is_empty() {
        return Err(format!("Failed to {action} {} item(s).", failed.len()));
    }
    Ok(())
}
