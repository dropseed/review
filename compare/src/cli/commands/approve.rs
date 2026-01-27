use crate::cli::OutputFormat;
use crate::review::state::{HunkState, HunkStatus};
use crate::review::storage;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(
    repo_path: &str,
    hunk_id: &str,
    approve: bool,
    format: OutputFormat,
) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_string()
        })?;

    // Load review state
    let mut state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

    // Get or create hunk state
    let hunk_state = state
        .hunks
        .entry(hunk_id.to_string())
        .or_insert_with(|| HunkState {
            label: Vec::new(),
            reasoning: None,
            status: None,
        });

    let action = if approve { "approved" } else { "rejected" };
    let new_status = if approve {
        HunkStatus::Approved
    } else {
        HunkStatus::Rejected
    };

    // Check if already in this state
    let already = match hunk_state.status {
        Some(HunkStatus::Approved) if approve => true,
        Some(HunkStatus::Rejected) if !approve => true,
        _ => false,
    };

    if already {
        if format == OutputFormat::Json {
            println!(
                r#"{{"message": "Hunk already {}", "hunk_id": "{}"}}"#,
                action, hunk_id
            );
        } else {
            println!("Hunk '{}' is already {}", hunk_id, action);
        }
        return Ok(());
    }

    // Update status
    hunk_state.status = Some(new_status);

    // Save updated state
    storage::save_review_state(&path, &state).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        let output = serde_json::json!({
            "message": format!("Hunk {}", action),
            "hunk_id": hunk_id,
            "status": action,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
    } else {
        let icon = if approve { "✓".green() } else { "✗".red() };
        let action_colored = if approve {
            action.green()
        } else {
            action.red()
        };
        println!("{} Hunk '{}' {}", icon, hunk_id.cyan(), action_colored);
    }

    Ok(())
}
