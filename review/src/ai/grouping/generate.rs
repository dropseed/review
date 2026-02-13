use super::prompt::{build_grouping_prompt, GroupingInput, ModifiedSymbolEntry};
use crate::ai::{
    ensure_claude_available, extract_json_str, parse_json, run_claude_with_model, ClaudeError,
};
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
) -> Result<Vec<HunkGroup>, ClaudeError> {
    if hunks.is_empty() {
        return Ok(Vec::new());
    }

    ensure_claude_available(custom_command)?;

    let prompt = build_grouping_prompt(hunks, modified_symbols);
    let output = run_claude_with_model(&prompt, cwd, model, custom_command)?;

    let json_str = extract_json_str(&output)?;
    let mut groups: Vec<HunkGroup> = parse_json(json_str)?;

    // Collect all input hunk IDs
    let all_ids: HashSet<String> = hunks.iter().map(|h| h.id.clone()).collect();

    // Collect all IDs that appeared in the response
    let seen_ids: HashSet<String> = groups
        .iter()
        .flat_map(|g| g.hunk_ids.iter().cloned())
        .collect();

    // Find missing IDs and add them to a fallback group
    let missing: Vec<String> = all_ids.difference(&seen_ids).cloned().collect();
    if !missing.is_empty() {
        groups.push(HunkGroup {
            title: "Other changes".to_owned(),
            description: "Changes not covered by the groups above.".to_owned(),
            hunk_ids: missing,
            phase: None,
        });
    }

    Ok(groups)
}
