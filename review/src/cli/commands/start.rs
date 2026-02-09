use super::print_json;
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

    let comparison = match spec {
        None => crate::cli::get_or_detect_comparison(&path)?,
        Some(spec) => parse_comparison_spec(&path, &spec, working_tree)?,
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

fn parse_comparison_spec(
    repo_path: &Path,
    spec: &str,
    working_tree: bool,
) -> Result<Comparison, String> {
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
