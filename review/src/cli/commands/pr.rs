use super::print_json;
use crate::cli::OutputFormat;
use crate::review::storage;
use crate::sources::github::{GhCliProvider, GitHubPrRef, GitHubProvider};
use crate::sources::traits::Comparison;
use colored::Colorize;
use std::path::{Path, PathBuf};

pub fn run(repo_path: &str, number: Option<u32>, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);
    let provider = GhCliProvider::new(path.clone());

    if !provider.is_available() {
        return Err(
            "GitHub CLI (gh) is not available or not authenticated. Install and run 'gh auth login'."
                .to_owned(),
        );
    }

    match number {
        None => list_prs(&provider, format),
        Some(n) => start_pr_review(&path, &provider, n, format),
    }
}

fn list_prs(provider: &GhCliProvider, format: OutputFormat) -> Result<(), String> {
    let prs = provider.list_pull_requests().map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        print_json(&prs);
        return Ok(());
    }

    if prs.is_empty() {
        println!("No open pull requests");
        return Ok(());
    }

    for pr in &prs {
        let draft = if pr.is_draft { " (draft)" } else { "" };
        println!(
            "  {}  {}{}  ({})  {} → {}",
            format!("#{}", pr.number).cyan(),
            pr.title,
            draft.dimmed(),
            pr.author.login.dimmed(),
            pr.head_ref_name,
            pr.base_ref_name,
        );
    }

    Ok(())
}

fn start_pr_review(
    repo_path: &Path,
    provider: &GhCliProvider,
    number: u32,
    format: OutputFormat,
) -> Result<(), String> {
    let prs = provider.list_pull_requests().map_err(|e| e.to_string())?;

    let pr = prs
        .iter()
        .find(|p| p.number == number)
        .ok_or_else(|| format!("Pull request #{number} not found (is it open?)"))?;

    let comparison = Comparison {
        old: pr.base_ref_name.clone(),
        new: pr.head_ref_name.clone(),
        working_tree: false,
        key: format!("pr-{}", number),
        github_pr: Some(GitHubPrRef {
            number,
            title: pr.title.clone(),
            head_ref_name: pr.head_ref_name.clone(),
            base_ref_name: pr.base_ref_name.clone(),
            body: Some(pr.body.clone()),
        }),
    };

    storage::set_current_comparison(repo_path, &comparison).map_err(|e| e.to_string())?;
    storage::ensure_review_exists(repo_path, &comparison).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        print_json(&serde_json::json!({
            "message": "PR review started",
            "number": number,
            "title": pr.title,
            "comparison": {
                "old": comparison.old,
                "new": comparison.new,
                "key": comparison.key,
            },
        }));
    } else {
        println!(
            "{} Started review for PR #{}: {}",
            "✓".green(),
            number,
            pr.title
        );
        println!("  {} → {}", pr.head_ref_name, pr.base_ref_name);
    }

    Ok(())
}
