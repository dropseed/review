use crate::classify::{check_claude_available, classify_hunks_batched, should_skip_ai, HunkInput};
use crate::cli::OutputFormat;
use crate::diff::parser::parse_diff;
use crate::review::state::HunkState;
use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::DiffSource;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(
    repo_path: &str,
    model: &str,
    concurrency: usize,
    batch_size: usize,
    format: OutputFormat,
) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Check if Claude is available
    if !check_claude_available() {
        return Err(
            "Claude CLI not found. Please install: npm install -g @anthropic-ai/claude-code"
                .to_owned(),
        );
    }

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_owned()
        })?;

    // Load review state
    let mut state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

    // Get the full diff
    let source = LocalGitSource::new(path.clone()).map_err(|e| e.to_string())?;
    let diff_output = source
        .get_diff(&comparison, None)
        .map_err(|e| e.to_string())?;

    if diff_output.is_empty() {
        if format == OutputFormat::Json {
            println!(r#"{{"message": "No changes to classify", "classified": 0}}"#);
        } else {
            println!("No changes to classify");
        }
        return Ok(());
    }

    // Parse all hunks and find unclassified ones
    let mut hunks_to_classify = Vec::new();
    let mut skipped_count = 0;

    for file_diff in split_diff_by_file(&diff_output) {
        let file_path = extract_file_path(&file_diff).unwrap_or_default();
        let hunks = parse_diff(&file_diff, &file_path);

        for hunk in hunks {
            // Check if already classified
            let existing = state.hunks.get(&hunk.id);
            if existing.is_some_and(|h| !h.label.is_empty()) {
                continue;
            }

            // Skip hunks that heuristics say won't match any AI label
            if should_skip_ai(&hunk).is_some() {
                skipped_count += 1;
                continue;
            }

            // Build hunk input for classification - use the content field
            hunks_to_classify.push(HunkInput {
                id: hunk.id.clone(),
                file_path: hunk.file_path.clone(),
                content: hunk.content.clone(),
            });
        }
    }

    if skipped_count > 0 && format == OutputFormat::Text {
        println!(
            "Skipped {} hunk(s) unlikely to match any label",
            skipped_count.to_string().dimmed()
        );
    }

    if hunks_to_classify.is_empty() {
        if format == OutputFormat::Json {
            println!(r#"{{"message": "All hunks already classified", "classified": 0}}"#);
        } else {
            println!("All hunks already classified");
        }
        return Ok(());
    }

    let total = hunks_to_classify.len();
    let show_progress = format == OutputFormat::Text;
    if show_progress {
        println!(
            "Classifying {} hunk(s) with Claude ({})...",
            total.to_string().cyan(),
            model
        );
    }

    // Run classification (blocking)
    let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
    let result = rt
        .block_on(async {
            classify_hunks_batched(
                hunks_to_classify,
                &path,
                model,
                batch_size,
                concurrency,
                None,
                move |completed_ids| {
                    if show_progress {
                        eprintln!("  Completed batch: {} hunks", completed_ids.len());
                    }
                },
            )
            .await
        })
        .map_err(|e| e.to_string())?;

    // Update review state with classifications
    let mut classified_count = 0;
    for (id, classification) in &result.classifications {
        let hunk_state = state.hunks.entry(id.clone()).or_insert_with(|| HunkState {
            label: Vec::new(),
            reasoning: None,
            status: None,
            classified_via: None,
        });

        hunk_state.label.clone_from(&classification.label);
        hunk_state.reasoning = Some(classification.reasoning.clone());
        classified_count += 1;
    }

    // Save updated state
    storage::save_review_state(&path, &state).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        let output = serde_json::json!({
            "message": "Classification complete",
            "classified": classified_count,
            "total": total,
            "classifications": result.classifications.iter().map(|(id, c)| {
                serde_json::json!({
                    "id": id,
                    "labels": c.label,
                    "reasoning": c.reasoning,
                })
            }).collect::<Vec<_>>(),
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
    } else {
        println!();
        println!(
            "{} Classified {}/{} hunks",
            "✓".green(),
            classified_count,
            total
        );

        // Show summary by label
        let mut label_counts: std::collections::HashMap<String, usize> =
            std::collections::HashMap::new();
        for classification in result.classifications.values() {
            for label in &classification.label {
                *label_counts.entry(label.clone()).or_insert(0) += 1;
            }
        }

        if !label_counts.is_empty() {
            println!();
            println!("{}", "Labels:".bold());
            let mut sorted: Vec<_> = label_counts.iter().collect();
            sorted.sort_by(|a, b| b.1.cmp(a.1));
            for (label, count) in sorted.iter().take(10) {
                println!("  {} {}", label.cyan(), format!("({count})").dimmed());
            }
            if sorted.len() > 10 {
                println!(
                    "  {}",
                    format!("... and {} more", sorted.len() - 10).dimmed()
                );
            }
        }
    }

    Ok(())
}

fn split_diff_by_file(diff: &str) -> Vec<String> {
    let mut files = Vec::new();
    let mut current = String::new();

    for line in diff.lines() {
        if line.starts_with("diff --git ") {
            if !current.is_empty() {
                files.push(current);
            }
            current = String::new();
        }
        current.push_str(line);
        current.push('\n');
    }

    if !current.is_empty() {
        files.push(current);
    }

    files
}

fn extract_file_path(file_diff: &str) -> Option<String> {
    for line in file_diff.lines() {
        if let Some(path) = line.strip_prefix("+++ b/") {
            return Some(path.to_owned());
        }
        if let Some(path) = line.strip_prefix("+++ a/") {
            return Some(path.to_owned());
        }
    }
    None
}
