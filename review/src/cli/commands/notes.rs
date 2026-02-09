use super::{print_json, require_comparison};
use crate::cli::OutputFormat;
use crate::review::storage;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(
    repo_path: &str,
    text: Option<String>,
    append: bool,
    format: OutputFormat,
) -> Result<(), String> {
    let path = PathBuf::from(repo_path);
    let comparison = require_comparison(&path)?;
    let mut state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

    match text {
        None => {
            if format == OutputFormat::Json {
                print_json(&serde_json::json!({ "notes": state.notes }));
            } else if state.notes.is_empty() {
                println!("No notes");
            } else {
                println!("{}", state.notes);
            }
        }
        Some(new_text) => {
            if append && !state.notes.is_empty() {
                state.notes.push('\n');
                state.notes.push_str(&new_text);
            } else {
                state.notes = new_text;
            }

            state.prepare_for_save();
            storage::save_review_state(&path, &state).map_err(|e| e.to_string())?;

            let message = if append {
                "Notes appended"
            } else {
                "Notes set"
            };
            if format == OutputFormat::Json {
                print_json(&serde_json::json!({
                    "message": message,
                    "notes": state.notes,
                }));
            } else {
                println!("{} {}", "✓".green(), message);
            }
        }
    }

    Ok(())
}
