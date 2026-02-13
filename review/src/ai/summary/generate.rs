use super::diagram_prompt::build_diagram_prompt;
use super::prompt::{build_summary_prompt, SummaryInput};
use crate::ai::{ensure_claude_available, run_claude_with_model, ClaudeError};
use std::path::Path;

/// Strip markdown code fences from a string. Handles both `` ```mermaid ``
/// and bare `` ``` `` wrappers that Claude sometimes adds despite instructions.
fn strip_markdown_fences(s: &str) -> &str {
    let s = s.trim();

    // Check for opening fence: ```mermaid or ```
    let after_fence = if let Some(rest) = s.strip_prefix("```mermaid") {
        rest
    } else if s.starts_with("```") && !s[3..].starts_with('`') {
        &s[3..]
    } else {
        return s;
    };

    // Skip the rest of the opening fence line
    let body = match after_fence.find('\n') {
        Some(pos) => &after_fence[pos + 1..],
        None => return after_fence.trim(),
    };

    // Strip closing fence
    match body.trim_end().strip_suffix("```") {
        Some(stripped) => stripped.trim(),
        None => body.trim(),
    }
}

/// Generate a summary for the given hunks using the Claude CLI.
///
/// Returns a markdown summary string.
pub fn generate_summary(
    hunks: &[SummaryInput],
    cwd: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<String, ClaudeError> {
    if hunks.is_empty() {
        return Ok(String::new());
    }

    ensure_claude_available(custom_command)?;

    let prompt = build_summary_prompt(hunks);
    let output = run_claude_with_model(&prompt, cwd, model, custom_command)?;

    Ok(output.trim().to_owned())
}

/// Generate a Mermaid dependency diagram for the given hunks using the Claude CLI.
///
/// Returns `Ok(None)` when the diagram is skipped (fewer than 2 files, or Claude
/// responded with "NONE").
pub fn generate_diagram(
    hunks: &[SummaryInput],
    cwd: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<Option<String>, ClaudeError> {
    let Some(prompt) = build_diagram_prompt(hunks) else {
        return Ok(None);
    };

    ensure_claude_available(custom_command)?;

    let output = run_claude_with_model(&prompt, cwd, model, custom_command)?;
    let trimmed = strip_markdown_fences(output.trim());

    if trimmed.eq_ignore_ascii_case("NONE") {
        return Ok(None);
    }

    Ok(Some(trimmed.to_owned()))
}
