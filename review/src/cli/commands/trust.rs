use crate::cli::OutputFormat;
use crate::review::storage;
use crate::trust::patterns::get_trust_taxonomy_with_custom;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: &str, pattern: &str, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_owned()
        })?;

    // Load review state
    let mut state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

    // Validate pattern format (should be category:pattern or category:*)
    if !pattern.contains(':') {
        return Err(format!(
            "Invalid pattern format '{pattern}'. Expected 'category:label' or 'category:*'"
        ));
    }

    // Check if pattern matches taxonomy (warning only)
    let taxonomy = get_trust_taxonomy_with_custom(&path);
    let (category, _label) = pattern.split_once(':').unwrap();
    let valid_category = taxonomy.iter().any(|c| c.name == category);

    if !valid_category && format == OutputFormat::Text {
        eprintln!(
            "{} Category '{}' not found in taxonomy (pattern will still be added)",
            "Warning:".yellow(),
            category
        );
    }

    // Check if already in trust list
    if state.trust_list.contains(&pattern.to_owned()) {
        if format == OutputFormat::Json {
            println!(r#"{{"message": "Pattern already trusted", "pattern": "{pattern}"}}"#);
        } else {
            println!("Pattern '{}' is already in the trust list", pattern.cyan());
        }
        return Ok(());
    }

    // Add to trust list
    state.trust_list.push(pattern.to_owned());

    // Count how many hunks this will trust
    let newly_trusted = state
        .hunks
        .values()
        .filter(|h| {
            h.status.is_none()
                && h.label
                    .iter()
                    .any(|l| crate::trust::matches_pattern(l, pattern))
        })
        .count();

    // Save updated state
    storage::save_review_state(&path, &state).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        let output = serde_json::json!({
            "message": "Pattern added to trust list",
            "pattern": pattern,
            "hunks_trusted": newly_trusted,
            "trust_list": state.trust_list,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
    } else {
        println!("{} Added '{}' to trust list", "✓".green(), pattern.cyan());
        if newly_trusted > 0 {
            println!(
                "  {} hunk(s) now auto-approved",
                newly_trusted.to_string().green()
            );
        }
    }

    Ok(())
}
