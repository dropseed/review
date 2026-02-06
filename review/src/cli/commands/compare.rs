use crate::cli::OutputFormat;
use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;
use colored::Colorize;
use std::path::{Path, PathBuf};

pub fn run(
    repo_path: &str,
    spec: Option<String>,
    working_tree: bool,
    format: OutputFormat,
) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    match spec {
        None => {
            // Show current comparison
            let comparison = storage::get_current_comparison(&path).map_err(|e| e.to_string())?;

            match comparison {
                Some(c) => {
                    if format == OutputFormat::Json {
                        let output = serde_json::json!({
                            "old": c.old,
                            "new": c.new,
                            "working_tree": c.working_tree,
                            "key": c.key,
                        });
                        println!(
                            "{}",
                            serde_json::to_string_pretty(&output)
                                .expect("failed to serialize JSON output")
                        );
                    } else {
                        let compare_display = format!("{}..{}", c.old, c.new);
                        println!("{compare_display}");
                    }
                }
                None => {
                    if format == OutputFormat::Json {
                        println!(r#"{{"message": "No active comparison"}}"#);
                    } else {
                        println!("No active comparison");
                        println!();
                        println!("Set one with: compare compare <base>..<head>");
                        println!("  Examples:");
                        println!("    compare compare main..HEAD -w");
                        println!("    compare compare main..feature-branch");
                    }
                }
            }
        }
        Some(spec) => {
            // Parse and set comparison
            let comparison = parse_comparison_spec(&path, &spec, working_tree)?;

            storage::set_current_comparison(&path, &comparison).map_err(|e| e.to_string())?;

            if format == OutputFormat::Json {
                let output = serde_json::json!({
                    "message": "Comparison set",
                    "old": comparison.old,
                    "new": comparison.new,
                    "working_tree": comparison.working_tree,
                    "key": comparison.key,
                });
                println!("{}", serde_json::to_string_pretty(&output).unwrap());
            } else {
                let compare_display = format!("{}..{}", comparison.old, comparison.new);
                println!("{} Set comparison: {}", "✓".green(), compare_display);
            }
        }
    }

    Ok(())
}

fn parse_comparison_spec(
    repo_path: &Path,
    spec: &str,
    working_tree: bool,
) -> Result<Comparison, String> {
    // Parse base..head format
    let (base, head) = if spec.contains("..") {
        let parts: Vec<&str> = spec.splitn(2, "..").collect();
        (parts[0].to_owned(), parts[1].to_owned())
    } else {
        // Single ref means compare against it with working tree
        let source = LocalGitSource::new(repo_path.to_path_buf()).map_err(|e| e.to_string())?;
        let default_branch = source
            .get_default_branch()
            .unwrap_or_else(|_| "main".to_owned());

        if working_tree {
            (spec.to_owned(), "HEAD".to_owned())
        } else {
            (default_branch, spec.to_owned())
        }
    };

    let key = format!("{base}..{head}");

    Ok(Comparison {
        old: base,
        new: head,
        working_tree,
        key,
        github_pr: None,
    })
}
