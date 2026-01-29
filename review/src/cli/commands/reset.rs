use crate::cli::OutputFormat;
use crate::review::state::ReviewState;
use crate::review::storage;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: &str, hard: bool, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_owned()
        })?;

    // Load current state to preserve some data
    let current_state =
        storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

    let hunks_cleared = current_state.hunks.len();
    let trust_cleared = if hard {
        current_state.trust_list.len()
    } else {
        0
    };

    // Create new state
    let mut new_state = ReviewState::new(comparison.clone());

    // Preserve trust list unless --hard
    if !hard {
        new_state.trust_list = current_state.trust_list;
    }

    // Save new state
    storage::save_review_state(&path, &new_state).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        let output = serde_json::json!({
            "message": if hard { "Review state fully reset" } else { "Review state reset (trust list preserved)" },
            "hunks_cleared": hunks_cleared,
            "trust_patterns_cleared": trust_cleared,
            "hard": hard,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
    } else {
        println!("{} Review state reset", "✓".green());
        println!("  {hunks_cleared} hunk label(s) cleared");
        if hard {
            println!("  {trust_cleared} trust pattern(s) cleared");
        } else {
            println!(
                "  {} Trust list preserved (use --hard to also clear)",
                "→".dimmed()
            );
        }
    }

    Ok(())
}
