use super::print_json;
use crate::cli::OutputFormat;
use crate::review::storage;
use crate::sources::traits::Comparison;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: &str, key: &str, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Check if the review exists before deleting
    let reviews = storage::list_saved_reviews(&path).map_err(|e| e.to_string())?;
    let exists = reviews.iter().any(|r| r.comparison.key == key);

    if !exists {
        if format == OutputFormat::Json {
            print_json(&serde_json::json!({"message": "Review not found", "key": key}));
        } else {
            println!("Review '{}' not found", key);
        }
        return Ok(());
    }

    // Construct a minimal Comparison for the delete call
    let (old, new) = if let Some((base, head)) = key.split_once("..") {
        (base.to_owned(), head.to_owned())
    } else {
        (String::new(), String::new())
    };

    let comparison = Comparison {
        old,
        new,
        working_tree: false,
        key: key.to_owned(),
        github_pr: None,
    };

    storage::delete_review(&path, &comparison).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        print_json(&serde_json::json!({
            "message": "Review deleted",
            "key": key,
        }));
    } else {
        println!("{} Deleted review '{}'", "✓".green(), key);
    }

    Ok(())
}
