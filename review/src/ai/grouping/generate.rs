use super::prompt::{build_grouping_prompt, GroupingInput, ModifiedSymbolEntry};
use crate::ai::{
    ensure_claude_available, extract_json_str, parse_json, run_claude_with_model, ClaudeError,
};
use crate::review::state::HunkGroup;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

/// Write each hunk's diff content to a temp file and return the mapping
/// of hunk ID to file path. The caller should keep the `TempDir` alive
/// until the Claude call completes (it is deleted on drop).
fn write_hunk_temp_files(
    hunks: &[GroupingInput],
) -> Result<(tempfile::TempDir, HashMap<String, PathBuf>), ClaudeError> {
    let temp_dir = tempfile::tempdir()
        .map_err(|e| ClaudeError::CommandFailed(format!("Failed to create temp directory: {e}")))?;

    let mut paths = HashMap::new();
    for (i, hunk) in hunks.iter().enumerate() {
        let file_path = temp_dir.path().join(format!("{i}.diff"));
        std::fs::write(&file_path, hunk.content.as_bytes())
            .map_err(|e| ClaudeError::CommandFailed(format!("Failed to write temp file: {e}")))?;
        paths.insert(hunk.id.clone(), file_path);
    }

    Ok((temp_dir, paths))
}

/// Generate hunk groupings for the given hunks using the Claude CLI.
///
/// Returns a list of `HunkGroup`s. Every input hunk ID is guaranteed to
/// appear in exactly one group — any IDs missing from Claude's response
/// are collected into a fallback "Other changes" group.
///
/// Hunk diff content is written to temp files and Claude is given the
/// `Read` tool so it can selectively inspect hunks as needed, keeping the
/// prompt within token limits for large reviews.
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

    // Write hunk content to temp files so the prompt stays small.
    // The TempDir is kept alive until after the Claude call.
    let (_temp_dir, hunk_file_paths) = write_hunk_temp_files(hunks)?;

    let prompt = build_grouping_prompt(hunks, modified_symbols, &hunk_file_paths);
    let output = run_claude_with_model(&prompt, cwd, model, custom_command, &["Read"])?;

    let json_str = extract_json_str(&output)?;
    // Claude sometimes returns objects without wrapping `[...]` brackets.
    // If the extracted JSON starts with `{`, wrap it in an array.
    let json_owned;
    let json_to_parse = if json_str.starts_with('{') {
        json_owned = format!("[{json_str}]");
        &json_owned
    } else {
        json_str
    };
    let mut groups: Vec<HunkGroup> = parse_json(json_to_parse)?;

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
