use crate::cli::OutputFormat;
use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::{DiffSource, FileStatus};
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: &str, show_all: bool, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_string()
        })?;

    // Get files
    let source = LocalGitSource::new(path.clone()).map_err(|e| e.to_string())?;
    let files = if show_all {
        source
            .list_all_files(&comparison)
            .map_err(|e| e.to_string())?
    } else {
        source.list_files(&comparison).map_err(|e| e.to_string())?
    };

    // Flatten file tree to list
    let mut file_list = Vec::new();
    flatten_files(&files, &mut file_list);

    if format == OutputFormat::Json {
        let output: Vec<_> = file_list
            .iter()
            .map(|(path, status)| {
                serde_json::json!({
                    "path": path,
                    "status": status.as_ref().map(|s| match s {
                        FileStatus::Added => "added",
                        FileStatus::Modified => "modified",
                        FileStatus::Deleted => "deleted",
                        FileStatus::Renamed => "renamed",
                        FileStatus::Untracked => "untracked",
                        FileStatus::Gitignored => "gitignored",
                    }),
                })
            })
            .collect();
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
        return Ok(());
    }

    // Text output
    for (file_path, status) in &file_list {
        let (prefix, color_fn): (&str, fn(&str) -> colored::ColoredString) = match status {
            Some(FileStatus::Added) => ("A", |s| s.green()),
            Some(FileStatus::Modified) => ("M", |s| s.yellow()),
            Some(FileStatus::Deleted) => ("D", |s| s.red()),
            Some(FileStatus::Renamed) => ("R", |s| s.cyan()),
            Some(FileStatus::Untracked) => ("?", |s| s.magenta()),
            Some(FileStatus::Gitignored) => ("!", |s| s.dimmed()),
            None => (" ", |s| s.normal()),
        };
        println!("{} {}", prefix, color_fn(file_path));
    }

    let changed = file_list.iter().filter(|(_, s)| s.is_some()).count();
    println!();
    println!("{} {} file(s) changed", "Total:".dimmed(), changed);

    Ok(())
}

fn flatten_files(
    entries: &[crate::sources::traits::FileEntry],
    output: &mut Vec<(String, Option<FileStatus>)>,
) {
    for entry in entries {
        if entry.is_directory {
            if let Some(ref children) = entry.children {
                flatten_files(children, output);
            }
        } else {
            output.push((entry.path.clone(), entry.status.clone()));
        }
    }
}
