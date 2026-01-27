use crate::cli::OutputFormat;
use crate::review::storage;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: &str, pattern: &str, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_string()
        })?;

    // Load review state
    let mut state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

    // Check if pattern is in trust list
    if !state.trust_list.contains(&pattern.to_string()) {
        if format == OutputFormat::Json {
            println!(
                r#"{{"message": "Pattern not in trust list", "pattern": "{}"}}"#,
                pattern
            );
        } else {
            println!("Pattern '{}' is not in the trust list", pattern);
        }
        return Ok(());
    }

    // Remove from trust list
    state.trust_list.retain(|p| p != pattern);

    // Save updated state
    storage::save_review_state(&path, &state).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        let output = serde_json::json!({
            "message": "Pattern removed from trust list",
            "pattern": pattern,
            "trust_list": state.trust_list,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
    } else {
        println!(
            "{} Removed '{}' from trust list",
            "✓".green(),
            pattern.cyan()
        );
    }

    Ok(())
}
