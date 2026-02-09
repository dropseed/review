use super::print_json;
use crate::cli::OutputFormat;
use crate::review::storage;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: Option<&str>, all: bool, format: OutputFormat) -> Result<(), String> {
    if all || repo_path.is_none() {
        run_global(format)
    } else {
        run_repo(repo_path.unwrap(), format)
    }
}

fn run_global(format: OutputFormat) -> Result<(), String> {
    let reviews = storage::list_all_reviews_global().map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        print_json(&reviews);
        return Ok(());
    }

    if reviews.is_empty() {
        println!("No saved reviews");
        return Ok(());
    }

    // Group by repo name
    let mut grouped: Vec<(String, Vec<&storage::GlobalReviewSummary>)> = Vec::new();
    for review in &reviews {
        if let Some(group) = grouped
            .iter_mut()
            .find(|(name, _)| name == &review.repo_name)
        {
            group.1.push(review);
        } else {
            grouped.push((review.repo_name.clone(), vec![review]));
        }
    }

    let repo_count = grouped.len();

    for (repo_name, repo_reviews) in &grouped {
        println!("{}", repo_name.bold());
        for review in repo_reviews {
            print_review_line(&review.summary);
        }
        println!();
    }

    println!(
        "Total: {} review(s) across {} repo(s)",
        reviews.len(),
        repo_count
    );

    Ok(())
}

fn run_repo(repo_path: &str, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);
    let reviews = storage::list_saved_reviews(&path).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        print_json(&reviews);
        return Ok(());
    }

    if reviews.is_empty() {
        println!("No saved reviews");
        return Ok(());
    }

    for review in &reviews {
        print_review_line(review);
    }
    println!();
    println!("Total: {} review(s)", reviews.len());

    Ok(())
}

fn print_review_line(summary: &crate::review::state::ReviewSummary) {
    let key = &summary.comparison.key;
    let reviewed = summary.reviewed_hunks;
    let total = summary.total_hunks;
    let pct = if total > 0 {
        (reviewed as f64 / total as f64 * 100.0) as u32
    } else {
        100
    };

    let state_str = match summary.state.as_deref() {
        Some("approved") => "Approved".green().to_string(),
        Some("changes_requested") => "Changes Requested".red().to_string(),
        _ => "In Progress".yellow().to_string(),
    };

    // Extract just the date part from the ISO timestamp
    let date = if summary.updated_at.len() >= 10 {
        &summary.updated_at[..10]
    } else {
        &summary.updated_at
    };

    println!(
        "  {:<30} {}/{} ({:>3}%)  {}  {}",
        key, reviewed, total, pct, state_str, date
    );
}
