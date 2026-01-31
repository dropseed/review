use super::prompt::{build_narrative_prompt, NarrativeInput};
use crate::classify::claude::{find_claude_executable, run_claude_with_model};
use crate::classify::ClassifyError;
use std::path::Path;

/// Generate a narrative walkthrough for the given hunks using the Claude CLI.
///
/// Returns the raw markdown string produced by Claude.
pub fn generate_narrative(
    hunks: &[NarrativeInput],
    cwd: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<String, ClassifyError> {
    if hunks.is_empty() {
        return Ok(String::new());
    }

    // Verify Claude is available when not using a custom command
    if custom_command.is_none() {
        find_claude_executable().ok_or(ClassifyError::ClaudeNotFound)?;
    }

    let prompt = build_narrative_prompt(hunks);
    let output = run_claude_with_model(&prompt, cwd, model, custom_command)?;

    // The output is raw markdown — just trim whitespace
    Ok(output.trim().to_owned())
}
