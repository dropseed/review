use crate::ai::{ensure_claude_available, run_claude_streaming, ClaudeError};
use log::info;
use std::path::Path;

/// Default model for commit message generation.
const DEFAULT_MODEL: &str = "sonnet";

/// Generate a commit message from the staged diff using Claude CLI with streaming.
///
/// Calls `on_text` with each text delta as it arrives so the caller can
/// display partial results in real time.  Returns the final complete message.
pub fn generate_commit_message_streaming(
    staged_diff: &str,
    recent_messages: &[String],
    cwd: &Path,
    on_text: &mut dyn FnMut(&str),
) -> Result<String, ClaudeError> {
    ensure_claude_available()?;

    let mut prompt = String::new();

    if !recent_messages.is_empty() {
        prompt.push_str("Here are recent commit messages from this repo for style reference:\n\n");
        for (i, msg) in recent_messages.iter().enumerate() {
            prompt.push_str(&format!("--- commit {} ---\n", i + 1));
            prompt.push_str(msg);
            prompt.push_str("\n\n");
        }
    }

    prompt.push_str("Here is the staged diff:\n\n");
    prompt.push_str(staged_diff);
    prompt.push_str("\n\n");
    prompt.push_str(
        "Write a commit message for this diff. \
         Match the style of the recent commits shown above. \
         Use a short subject line (under 72 characters). \
         For larger changes, add a blank line followed by a brief body. \
         Output ONLY the commit message with no extra commentary, \
         no markdown formatting, and no surrounding quotes.",
    );

    info!(
        "[generate_commit_message] prompt length: {} bytes",
        prompt.len()
    );

    let allowed_tools: &[&str] = &["none"];
    let output = run_claude_streaming(&prompt, cwd, DEFAULT_MODEL, allowed_tools, on_text)?;

    // Trim any leading/trailing whitespace the model may add
    Ok(output.trim().to_owned())
}
