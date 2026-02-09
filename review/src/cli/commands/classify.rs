use super::{extract_file_path, print_json, require_comparison, split_diff_by_file};
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

    if !check_claude_available() {
        return Err(
            "Claude CLI not found. Please install: npm install -g @anthropic-ai/claude-code"
                .to_owned(),
        );
    }

    let comparison = require_comparison(&path)?;
    let mut state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

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
            let existing = state.hunks.get(&hunk.id);
            if existing.is_some_and(|h| !h.label.is_empty()) {
                continue;
            }

            if should_skip_ai(&hunk).is_some() {
                skipped_count += 1;
                continue;
            }

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

    storage::save_review_state(&path, &state).map_err(|e| e.to_string())?;

    if format == OutputFormat::Json {
        print_json(&serde_json::json!({
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
        }));
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
