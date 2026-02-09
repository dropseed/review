use super::print_json;
use crate::cli::OutputFormat;
use crate::review::storage;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(
    repo_path: &str,
    spec: Option<String>,
    working_tree: bool,
    format: OutputFormat,
) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    let comparison = match spec {
        None => crate::cli::get_or_detect_comparison(&path)?,
        Some(spec) => crate::cli::parse_comparison_spec(&path, &spec, working_tree)?,
    };

    storage::set_current_comparison(&path, &comparison).map_err(|e| e.to_string())?;
    storage::ensure_review_exists(&path, &comparison).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        print_json(&serde_json::json!({
            "old": comparison.old,
            "new": comparison.new,
            "working_tree": comparison.working_tree,
            "key": comparison.key,
        }));
    } else {
        println!(
            "{} Set comparison: {}..{}",
            "✓".green(),
            comparison.old,
            comparison.new
        );
    }

    Ok(())
}
