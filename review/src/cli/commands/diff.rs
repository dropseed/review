use crate::cli::OutputFormat;
use crate::diff::parser::{parse_diff, LineType};
use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::DiffSource;
use crate::trust::matches_pattern;
use colored::Colorize;
use std::path::PathBuf;

#[expect(
    clippy::needless_pass_by_value,
    reason = "file parameter passed from clap's owned String"
)]
pub fn run(
    repo_path: &str,
    labeled: bool,
    file: Option<String>,
    format: OutputFormat,
) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_owned()
        })?;

    // Get the diff
    let source = LocalGitSource::new(path.clone()).map_err(|e| e.to_string())?;
    let diff_output = source
        .get_diff(&comparison, file.as_deref())
        .map_err(|e| e.to_string())?;

    if diff_output.is_empty() {
        if format == OutputFormat::Json {
            println!(r#"{{"message": "No changes"}}"#);
        } else {
            println!("No changes");
        }
        return Ok(());
    }

    if format == OutputFormat::Json {
        // Parse hunks and include labels from review state
        let state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

        let mut all_hunks = Vec::new();
        // Split diff by file and parse
        for file_diff in split_diff_by_file(&diff_output) {
            let file_path = extract_file_path(&file_diff).unwrap_or_default();
            let hunks = parse_diff(&file_diff, &file_path);

            for hunk in hunks {
                let hunk_state = state.hunks.get(&hunk.id);
                let labels = hunk_state.map(|h| &h.label).cloned().unwrap_or_default();
                let is_trusted = labels.iter().any(|label| {
                    state
                        .trust_list
                        .iter()
                        .any(|pattern| matches_pattern(label, pattern))
                });

                // Convert lines to simple strings for JSON
                let line_strings: Vec<String> = hunk
                    .lines
                    .iter()
                    .map(|l| {
                        let prefix = match l.line_type {
                            LineType::Added => "+",
                            LineType::Removed => "-",
                            LineType::Context => " ",
                        };
                        format!("{}{}", prefix, l.content)
                    })
                    .collect();

                all_hunks.push(serde_json::json!({
                    "id": hunk.id,
                    "file_path": hunk.file_path,
                    "old_start": hunk.old_start,
                    "old_count": hunk.old_count,
                    "new_start": hunk.new_start,
                    "new_count": hunk.new_count,
                    "labels": labels,
                    "is_trusted": is_trusted,
                    "status": hunk_state.and_then(|h| h.status.as_ref()).map(|s| match s {
                        crate::review::state::HunkStatus::Approved => "approved",
                        crate::review::state::HunkStatus::Rejected => "rejected",
                    }),
                    "lines": line_strings,
                }));
            }
        }

        let output = serde_json::json!({
            "comparison": comparison,
            "hunks": all_hunks,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
        return Ok(());
    }

    // Text output
    if labeled {
        // Load review state for labels
        let state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

        // Print diff with labels
        for file_diff in split_diff_by_file(&diff_output) {
            let file_path = extract_file_path(&file_diff).unwrap_or_default();
            let hunks = parse_diff(&file_diff, &file_path);

            // Print file header
            println!("{}", format!("=== {file_path} ===").bold());

            for hunk in hunks {
                let hunk_state = state.hunks.get(&hunk.id);

                // Print hunk header with labels
                let header = format!(
                    "@@ -{},{} +{},{} @@",
                    hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count
                );

                if let Some(hs) = hunk_state {
                    let labels = hs.label.join(", ");
                    let is_trusted = hs.label.iter().any(|label| {
                        state
                            .trust_list
                            .iter()
                            .any(|pattern| matches_pattern(label, pattern))
                    });

                    let status_str = match hs.status {
                        Some(crate::review::state::HunkStatus::Approved) => " ✓".green(),
                        Some(crate::review::state::HunkStatus::Rejected) => " ✗".red(),
                        None if is_trusted => " ~".cyan(),
                        None => "".normal(),
                    };

                    if labels.is_empty() {
                        println!("{}{}", header.blue(), status_str);
                    } else {
                        println!("{} [{}]{}", header.blue(), labels.cyan(), status_str);
                    }
                } else {
                    println!("{}", header.blue());
                }

                // Print hunk content
                for line in &hunk.lines {
                    match line.line_type {
                        LineType::Added => {
                            println!("{}", format!("+{}", line.content).green());
                        }
                        LineType::Removed => {
                            println!("{}", format!("-{}", line.content).red());
                        }
                        LineType::Context => {
                            println!(" {}", line.content);
                        }
                    }
                }
                println!();
            }
        }
    } else {
        // Plain diff output with colors
        for line in diff_output.lines() {
            if line.starts_with('+') && !line.starts_with("+++") {
                println!("{}", line.green());
            } else if line.starts_with('-') && !line.starts_with("---") {
                println!("{}", line.red());
            } else if line.starts_with("@@") {
                println!("{}", line.blue());
            } else if line.starts_with("diff --git") || line.starts_with("index ") {
                println!("{}", line.dimmed());
            } else {
                println!("{line}");
            }
        }
    }

    Ok(())
}

fn split_diff_by_file(diff: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut current = String::new();

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            if !current.is_empty() {
                files.push(current);
            }
            current = String::new();
        }
        current.push_str(line);
        current.push('\n');
    }

    if !current.is_empty() {
        files.push(current);
    }

    files
}

fn extract_file_path(file_diff: &str) -> Option<String> {
    for line in file_diff.lines() {
        if let Some(path) = line.strip_prefix("+++ b/") {
            return Some(path.to_owned());
        }
        if let Some(path) = line.strip_prefix("+++ a/") {
            return Some(path.to_owned());
        }
    }
    None
}
