use super::prompt::{build_summary_prompt, SummaryInput};
use crate::ai::{ensure_claude_available, run_claude_with_model, ClaudeError};
use serde::Serialize;
use std::path::Path;

/// Result of summary generation, containing both a short title and the full summary.
#[derive(Debug, Serialize)]
pub struct SummaryResult {
    pub title: String,
    pub summary: String,
}

/// Generate a summary for the given hunks using the Claude CLI.
///
/// Returns a `SummaryResult` with a short title and the full summary.
pub fn generate_summary(
    hunks: &[SummaryInput],
    cwd: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<SummaryResult, ClaudeError> {
    if hunks.is_empty() {
        return Ok(SummaryResult {
            title: String::new(),
            summary: String::new(),
        });
    }

    ensure_claude_available(custom_command)?;

    let prompt = build_summary_prompt(hunks);
    let output = run_claude_with_model(&prompt, cwd, model, custom_command, &[])?;

    Ok(parse_summary_output(output.trim()))
}

/// Parse the Claude output into a title and summary.
///
/// Expects the first non-empty line to be the title, followed by a blank line,
/// then the bullet-point summary. Falls back gracefully if no blank line separator.
fn parse_summary_output(output: &str) -> SummaryResult {
    // Find the first non-empty line (the title)
    let mut lines = output.lines();
    let title_line = lines
        .by_ref()
        .find(|line| !line.trim().is_empty())
        .unwrap_or("")
        .trim();

    // Check if the next line is blank (separator between title and summary)
    let rest: Vec<&str> = lines.collect();
    if let Some(first_rest) = rest.first() {
        if first_rest.trim().is_empty() {
            // Found blank separator — rest after it is the summary
            let summary = rest[1..].join("\n").trim().to_owned();
            return SummaryResult {
                title: title_line.to_owned(),
                summary,
            };
        }
    }

    // No blank line separator — treat entire output as summary with empty title
    SummaryResult {
        title: String::new(),
        summary: output.to_owned(),
    }
}
