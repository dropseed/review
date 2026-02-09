use super::{extract_file_path, print_json, require_comparison, split_diff_by_file};
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
    let comparison = require_comparison(&path)?;

    let source = LocalGitSource::new(path.clone()).map_err(|e| e.to_string())?;
    let diff_output = source
        .get_diff(&comparison, file.as_deref())
        .map_err(|e| e.to_string())?;

    if diff_output.is_empty() {
        if format == OutputFormat::Json {
            print_json(&serde_json::json!({"message": "No changes"}));
        } else {
            println!("No changes");
        }
        return Ok(());
    }

    if format == OutputFormat::Json {
        return print_json_diff(&path, &comparison, &diff_output);
    }

    if labeled {
        print_labeled_diff(&path, &comparison, &diff_output)?;
    } else {
        print_colored_diff(&diff_output);
    }

    Ok(())
}

fn print_json_diff(
    path: &PathBuf,
    comparison: &crate::sources::traits::Comparison,
    diff_output: &str,
) -> Result<(), String> {
    let state = storage::load_review_state(path, comparison).map_err(|e| e.to_string())?;

    let all_hunks: Vec<_> = split_diff_by_file(diff_output)
        .iter()
        .flat_map(|file_diff| {
            let file_path = extract_file_path(file_diff).unwrap_or_default();
            parse_diff(file_diff, &file_path)
        })
        .map(|hunk| {
            let hunk_state = state.hunks.get(&hunk.id);
            let labels = hunk_state.map(|h| &h.label).cloned().unwrap_or_default();
            let is_trusted = labels.iter().any(|label| {
                state
                    .trust_list
                    .iter()
                    .any(|pattern| matches_pattern(label, pattern))
            });

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

            serde_json::json!({
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
            })
        })
        .collect();

    print_json(&serde_json::json!({
        "comparison": comparison,
        "hunks": all_hunks,
    }));

    Ok(())
}

fn print_labeled_diff(
    path: &PathBuf,
    comparison: &crate::sources::traits::Comparison,
    diff_output: &str,
) -> Result<(), String> {
    let state = storage::load_review_state(path, comparison).map_err(|e| e.to_string())?;

    for file_diff in split_diff_by_file(diff_output) {
        let file_path = extract_file_path(&file_diff).unwrap_or_default();
        let hunks = parse_diff(&file_diff, &file_path);

        println!("{}", format!("=== {file_path} ===").bold());

        for hunk in hunks {
            let hunk_state = state.hunks.get(&hunk.id);
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

            for line in &hunk.lines {
                match line.line_type {
                    LineType::Added => println!("{}", format!("+{}", line.content).green()),
                    LineType::Removed => println!("{}", format!("-{}", line.content).red()),
                    LineType::Context => println!(" {}", line.content),
                }
            }
            println!();
        }
    }

    Ok(())
}

fn print_colored_diff(diff_output: &str) {
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
