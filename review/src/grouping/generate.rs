use super::prompt::{build_grouping_prompt, GroupingInput, ModifiedSymbolEntry};
use crate::classify::claude::{find_claude_executable, run_claude_with_model};
use crate::classify::ClassifyError;
use crate::review::state::HunkGroup;
use std::collections::HashSet;
use std::path::Path;

/// Generate hunk groupings for the given hunks using the Claude CLI.
///
/// Returns a list of `HunkGroup`s. Every input hunk ID is guaranteed to
/// appear in exactly one group — any IDs missing from Claude's response
/// are collected into a fallback "Other changes" group.
pub fn generate_grouping(
    hunks: &[GroupingInput],
    cwd: &Path,
    model: &str,
    custom_command: Option<&str>,
    modified_symbols: &[ModifiedSymbolEntry],
) -> Result<Vec<HunkGroup>, ClassifyError> {
    if hunks.is_empty() {
        return Ok(Vec::new());
    }

    // Verify Claude is available when not using a custom command
    if custom_command.is_none() {
        find_claude_executable().ok_or(ClassifyError::ClaudeNotFound)?;
    }

    let prompt = build_grouping_prompt(hunks, modified_symbols);
    let output = run_claude_with_model(&prompt, cwd, model, custom_command)?;

    // Strip markdown code fences if present
    let trimmed = output.trim();
    let json_str = if trimmed.starts_with("```") {
        let without_opening = trimmed
            .strip_prefix("```json")
            .or_else(|| trimmed.strip_prefix("```"))
            .unwrap_or(trimmed);
        without_opening
            .strip_suffix("```")
            .unwrap_or(without_opening)
            .trim()
    } else {
        trimmed
    };

    // Parse the JSON response
    let mut groups: Vec<HunkGroup> =
        serde_json::from_str(json_str).map_err(|e| {
            ClassifyError::ParseError(format!(
                "JSON parse error: {}. Raw output (first 500 chars): {}",
                e,
                &output[..output.len().min(500)]
            ))
        })?;

    // Collect all input hunk IDs
    let all_ids: HashSet<String> = hunks.iter().map(|h| h.id.clone()).collect();

    // Collect all IDs that appeared in the response
    let mut seen_ids: HashSet<String> = HashSet::new();
    for group in &groups {
        for id in &group.hunk_ids {
            seen_ids.insert(id.clone());
        }
    }

    // Find missing IDs and add them to a fallback group
    let missing: Vec<String> = all_ids.difference(&seen_ids).cloned().collect();
    if !missing.is_empty() {
        groups.push(HunkGroup {
            title: "Other changes".to_string(),
            description: "Changes not covered by the groups above.".to_string(),
            hunk_ids: missing,
        });
    }

    Ok(groups)
}
