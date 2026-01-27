use crate::cli::OutputFormat;
use crate::review::storage;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::DiffSource;
use crate::trust::matches_pattern;
use colored::Colorize;
use std::path::PathBuf;

pub fn run(repo_path: &str, format: OutputFormat) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison
    let comparison = storage::get_current_comparison(&path)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| {
            "No active comparison. Use 'compare <base>..<head>' to set one.".to_string()
        })?;

    // Load review state
    let state = storage::load_review_state(&path, &comparison).map_err(|e| e.to_string())?;

    // Get file count
    let source = LocalGitSource::new(path.clone()).map_err(|e| e.to_string())?;
    let files = source.list_files(&comparison).map_err(|e| e.to_string())?;
    let changed_files = files
        .iter()
        .filter(|f| !f.is_directory && f.status.is_some())
        .count();

    // Count hunk statistics
    let total_hunks = state.hunks.len();
    let approved = state
        .hunks
        .values()
        .filter(|h| matches!(h.status, Some(crate::review::state::HunkStatus::Approved)))
        .count();
    let rejected = state
        .hunks
        .values()
        .filter(|h| matches!(h.status, Some(crate::review::state::HunkStatus::Rejected)))
        .count();
    let trusted = state
        .hunks
        .values()
        .filter(|h| {
            h.status.is_none()
                && !h.label.is_empty()
                && h.label.iter().any(|label| {
                    state
                        .trust_list
                        .iter()
                        .any(|pattern| matches_pattern(label, pattern))
                })
        })
        .count();
    let pending = total_hunks - approved - rejected - trusted;
    let unclassified = state.hunks.values().filter(|h| h.label.is_empty()).count();

    if format == OutputFormat::Json {
        let output = serde_json::json!({
            "comparison": {
                "old": comparison.old,
                "new": comparison.new,
                "working_tree": comparison.working_tree,
                "staged_only": comparison.staged_only,
                "key": comparison.key,
            },
            "files": changed_files,
            "hunks": {
                "total": total_hunks,
                "approved": approved,
                "rejected": rejected,
                "trusted": trusted,
                "pending": pending,
                "unclassified": unclassified,
            },
            "trust_list": state.trust_list,
            "notes": state.notes,
            "updated_at": state.updated_at,
        });
        println!(
            "{}",
            serde_json::to_string_pretty(&output).expect("failed to serialize JSON output")
        );
        return Ok(());
    }

    // Text output
    println!("{}", "Compare Status".bold());
    println!();

    // Comparison info
    let compare_display = if comparison.working_tree && comparison.new == "HEAD" {
        format!("{}..{}", comparison.old, "Working Tree".cyan())
    } else if comparison.staged_only {
        format!("{}..{}", comparison.old, "Staged".cyan())
    } else {
        format!("{}..{}", comparison.old, comparison.new)
    };
    println!("  {} {}", "Comparison:".dimmed(), compare_display);
    println!("  {} {}", "Files:".dimmed(), changed_files);
    println!();

    // Hunk summary
    println!("{}", "Hunks".bold());
    let progress = if total_hunks > 0 {
        ((approved + trusted) as f64 / total_hunks as f64 * 100.0) as u32
    } else {
        100
    };
    println!(
        "  {} {}/{}",
        "Progress:".dimmed(),
        format!("{}%", progress).green(),
        total_hunks
    );

    if approved > 0 {
        println!(
            "  {} {}",
            "Approved:".dimmed(),
            approved.to_string().green()
        );
    }
    if trusted > 0 {
        println!("  {} {}", "Trusted:".dimmed(), trusted.to_string().cyan());
    }
    if rejected > 0 {
        println!("  {} {}", "Rejected:".dimmed(), rejected.to_string().red());
    }
    if pending > 0 {
        println!("  {} {}", "Pending:".dimmed(), pending.to_string().yellow());
    }
    if unclassified > 0 {
        println!(
            "  {} {} (run 'compare classify' to label)",
            "Unclassified:".dimmed(),
            unclassified.to_string().yellow()
        );
    }

    // Trust list
    if !state.trust_list.is_empty() {
        println!();
        println!("{}", "Trust List".bold());
        for pattern in &state.trust_list {
            println!("  {}", pattern.cyan());
        }
    }

    // Notes
    if !state.notes.is_empty() {
        println!();
        println!("{}", "Notes".bold());
        for line in state.notes.lines().take(5) {
            println!("  {}", line);
        }
        if state.notes.lines().count() > 5 {
            println!("  {}", "...".dimmed());
        }
    }

    Ok(())
}
