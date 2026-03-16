use super::prompt::{build_grouping_prompt, DiffContentMode, GroupingInput, ModifiedSymbolEntry};
use crate::ai::{
    ensure_claude_available, extract_json_str, parse_json, run_claude_streaming,
    run_claude_with_model, ClaudeError,
};
use crate::review::state::HunkGroup;
use log::{info, warn};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

/// A single event emitted during streaming grouping.
#[derive(Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum GroupingEvent {
    /// A partial title for the in-progress group.
    PartialTitle { title: String },
    /// A fully parsed group.
    Group(HunkGroup),
}

/// Maximum total bytes of diff content to inline in the prompt (~50K tokens).
/// When the total exceeds this, fall back to temp files + Read tool.
const INLINE_CONTENT_BUDGET_BYTES: usize = 200_000;

/// Compute total content size and log the inlining decision.
fn should_inline_content(hunks: &[GroupingInput], label: &str) -> bool {
    let total_bytes: usize = hunks.iter().map(|h| h.content.len()).sum();
    let use_inline = total_bytes <= INLINE_CONTENT_BUDGET_BYTES;
    info!(
        "[grouping{label}] {} hunks, {total_bytes} bytes total content → {}",
        hunks.len(),
        if use_inline {
            "inline"
        } else {
            "temp files + Read tool"
        }
    );
    use_inline
}

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

/// Append a fallback "Other changes" group for any hunk IDs in `all_ids`
/// that don't appear in any existing group.
fn append_missing_hunks(groups: &mut Vec<HunkGroup>, all_ids: &HashSet<String>) {
    let seen_ids: HashSet<String> = groups
        .iter()
        .flat_map(|g| g.hunk_ids.iter().cloned())
        .collect();

    let missing: Vec<String> = all_ids.difference(&seen_ids).cloned().collect();
    if !missing.is_empty() {
        groups.push(HunkGroup {
            title: "Other changes".to_owned(),
            description: String::new(),
            hunk_ids: missing,
            phase: None,
        });
    }
}

/// Default model for all AI operations.
const DEFAULT_MODEL: &str = "sonnet";

/// Generate hunk groupings for the given hunks using the Claude CLI.
///
/// Returns a list of `HunkGroup`s. Every input hunk ID is guaranteed to
/// appear in exactly one group — any IDs missing from Claude's response
/// are collected into a fallback "Other changes" group.
///
/// Hunk diff content is written to temp files and Claude is given the
/// `Read` tool so it can selectively inspect hunks as needed, keeping the
/// prompt within token limits for large reviews.
pub(crate) fn generate_grouping(
    hunks: &[GroupingInput],
    cwd: &Path,
    modified_symbols: &[ModifiedSymbolEntry],
) -> Result<Vec<HunkGroup>, ClaudeError> {
    if hunks.is_empty() {
        return Ok(Vec::new());
    }

    ensure_claude_available()?;

    let use_inline = should_inline_content(hunks, "");

    // Keep _temp_dir alive until after the Claude call (dropped at end of scope).
    let _temp_dir;
    let content_mode;
    let allowed_tools: &[&str];

    if use_inline {
        _temp_dir = None;
        content_mode = DiffContentMode::Inline;
        // Pass a dummy tool name to disable all real tools —
        // without any --allowedTools flag the CLI exposes the full default set.
        allowed_tools = &["none"];
    } else {
        let (dir, paths) = write_hunk_temp_files(hunks)?;
        _temp_dir = Some(dir);
        content_mode = DiffContentMode::TempFiles(paths);
        allowed_tools = &["Read"];
    }

    let prompt = build_grouping_prompt(hunks, modified_symbols, &content_mode);
    info!("[grouping] prompt length: {} bytes", prompt.len());

    let start = std::time::Instant::now();
    let output = run_claude_with_model(&prompt, cwd, DEFAULT_MODEL, allowed_tools)?;
    info!(
        "[grouping] Claude call took {:.1}s",
        start.elapsed().as_secs_f64()
    );

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

    let all_ids: HashSet<String> = hunks.iter().map(|h| h.id.clone()).collect();
    append_missing_hunks(&mut groups, &all_ids);

    Ok(groups)
}

/// Extract a complete `"title": "..."` value from a partial JSON buffer.
///
/// Handles escaped quotes within the title value by iterating char-by-char.
/// Returns `None` if no complete title value is found yet.
fn extract_partial_title(buf: &str) -> Option<String> {
    // Find `"title"` key followed by `:` and opening `"`
    let key = "\"title\"";
    let key_pos = buf.find(key)?;
    let after_key = &buf[key_pos + key.len()..];

    // Skip whitespace, colon, more whitespace, and opening quote
    let value_start = after_key
        .trim_start()
        .strip_prefix(':')?
        .trim_start()
        .strip_prefix('"')?;

    // Scan for closing quote, handling escaped characters
    let mut result = String::new();
    let mut chars = value_start.chars();
    loop {
        match chars.next() {
            None => return None, // Title not yet complete
            Some('\\') => {
                // Escaped character — take the next char literally
                match chars.next() {
                    None => return None,
                    Some(c) => {
                        result.push('\\');
                        result.push(c);
                    }
                }
            }
            Some('"') => {
                // Closing quote — title is complete
                return Some(result);
            }
            Some(c) => result.push(c),
        }
    }
}

/// Generate hunk groupings with streaming: emits `GroupingEvent`s via the
/// `on_event` callback as groups and partial titles arrive from the model.
///
/// Uses `--output-format stream-json` so tokens are flushed immediately,
/// enabling progressive display. Temp-file mode falls back to non-streaming.
///
/// Returns the final complete list of groups (with missing-hunk fallback).
pub fn generate_grouping_streaming(
    hunks: &[GroupingInput],
    cwd: &Path,
    modified_symbols: &[ModifiedSymbolEntry],
    on_event: &mut dyn FnMut(GroupingEvent),
    cancel: Option<&Arc<AtomicBool>>,
) -> Result<Vec<HunkGroup>, ClaudeError> {
    if hunks.is_empty() {
        return Ok(Vec::new());
    }

    ensure_claude_available()?;

    let use_inline = should_inline_content(hunks, ":streaming");

    // Temp-file mode uses the Read tool which breaks the JSON stream,
    // so fall back to non-streaming in that case.
    if !use_inline {
        return generate_grouping(hunks, cwd, modified_symbols);
    }

    let content_mode = DiffContentMode::Inline;
    let allowed_tools: &[&str] = &["none"];

    let prompt = build_grouping_prompt(hunks, modified_symbols, &content_mode);
    info!("[grouping:streaming] prompt length: {} bytes", prompt.len());

    // Incremental JSON object parser state
    let mut groups: Vec<HunkGroup> = Vec::new();
    let mut buf = String::new();
    let mut brace_depth: i32 = 0;
    let mut in_string = false;
    let mut escape_next = false;
    let mut title_emitted = false;

    let start = std::time::Instant::now();
    let _output = run_claude_streaming(
        &prompt,
        cwd,
        DEFAULT_MODEL,
        allowed_tools,
        &mut |text: &str| {
            for ch in text.chars() {
                if escape_next {
                    escape_next = false;
                    if brace_depth > 0 {
                        buf.push(ch);
                    }
                    continue;
                }

                if ch == '\\' && in_string {
                    escape_next = true;
                    if brace_depth > 0 {
                        buf.push(ch);
                    }
                    continue;
                }

                if ch == '"' && brace_depth > 0 {
                    buf.push(ch);
                    // When closing a string, check if we just completed the title value
                    if in_string && !title_emitted {
                        if let Some(title) = extract_partial_title(&buf) {
                            if !title.is_empty() {
                                on_event(GroupingEvent::PartialTitle { title });
                                title_emitted = true;
                            }
                        }
                    }
                    in_string = !in_string;
                    continue;
                }

                if in_string {
                    if brace_depth > 0 {
                        buf.push(ch);
                    }
                    continue;
                }

                // Outside a string
                if ch == '{' {
                    brace_depth += 1;
                    buf.push(ch);
                } else if ch == '}' {
                    if brace_depth > 0 {
                        brace_depth -= 1;
                        buf.push(ch);
                        if brace_depth == 0 {
                            // Complete JSON object — try to parse
                            if let Ok(group) = serde_json::from_str::<HunkGroup>(&buf) {
                                groups.push(group.clone());
                                on_event(GroupingEvent::Group(group));
                            } else {
                                warn!(
                                    "[grouping:streaming] failed to parse object: {}",
                                    &buf[..buf.len().min(200)]
                                );
                            }
                            buf.clear();
                            title_emitted = false;
                        }
                    }
                } else if brace_depth > 0 {
                    buf.push(ch);
                }
                // Characters outside braces (array brackets, commas, whitespace, markdown fences) are ignored
            }
        },
        cancel,
    )?;

    info!(
        "[grouping:streaming] Claude call took {:.1}s, {} groups streamed",
        start.elapsed().as_secs_f64(),
        groups.len()
    );

    let all_ids: HashSet<String> = hunks.iter().map(|h| h.id.clone()).collect();
    append_missing_hunks(&mut groups, &all_ids);

    Ok(groups)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_partial_title_complete() {
        let buf = r#"{"title": "Refactor auth module", "description": "..."}"#;
        assert_eq!(
            extract_partial_title(buf),
            Some("Refactor auth module".to_string())
        );
    }

    #[test]
    fn extract_partial_title_incomplete() {
        let buf = r#"{"title": "Refactor auth mod"#;
        assert_eq!(extract_partial_title(buf), None);
    }

    #[test]
    fn extract_partial_title_escaped_quotes() {
        let buf = r#"{"title": "Handle \"edge\" cases", "hunk_ids": []}"#;
        assert_eq!(
            extract_partial_title(buf),
            Some(r#"Handle \"edge\" cases"#.to_string())
        );
    }

    #[test]
    fn extract_partial_title_no_title_key() {
        let buf = r#"{"description": "some text"}"#;
        assert_eq!(extract_partial_title(buf), None);
    }

    #[test]
    fn extract_partial_title_empty_title() {
        let buf = r#"{"title": "", "hunk_ids": []}"#;
        assert_eq!(extract_partial_title(buf), Some("".to_string()));
    }

    #[test]
    fn extract_partial_title_whitespace_around_colon() {
        let buf = r#"{"title"  :  "Spaced out"}"#;
        assert_eq!(extract_partial_title(buf), Some("Spaced out".to_string()));
    }
}
