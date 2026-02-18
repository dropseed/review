pub mod grouping;
pub mod summary;

use std::io::Write;
use std::path::Path;
use std::process::{Command, Stdio};
use thiserror::Error;

// ---------------------------------------------------------------------------
// Shared AI response parsing helpers
// ---------------------------------------------------------------------------

/// Extract the JSON substring from Claude's output, handling markdown fences
/// and other surrounding text.
pub(crate) fn extract_json_str(output: &str) -> Result<&str, ClaudeError> {
    let trimmed = output.trim();

    if let Some(start) = trimmed.find("```json") {
        let after_marker = &trimmed[start + 7..];
        if let Some(end) = after_marker.find("```") {
            return Ok(after_marker[..end].trim());
        }
        return Ok(after_marker.trim());
    }

    if let Some(start) = trimmed.find("```") {
        let after_marker = &trimmed[start + 3..];
        let after_newline = after_marker
            .find('\n')
            .map_or(after_marker, |i| &after_marker[i + 1..]);
        if let Some(end) = after_newline.find("```") {
            return Ok(after_newline[..end].trim());
        }
        return Ok(after_newline.trim());
    }

    if trimmed.starts_with('{') || trimmed.starts_with('[') {
        return Ok(trimmed);
    }

    if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            return Ok(&trimmed[start..=end]);
        }
        return Err(ClaudeError::ParseError(
            "Could not find complete JSON object".to_owned(),
        ));
    }

    // Also try array-style JSON
    if let Some(start) = trimmed.find('[') {
        if let Some(end) = trimmed.rfind(']') {
            return Ok(&trimmed[start..=end]);
        }
        return Err(ClaudeError::ParseError(
            "Could not find complete JSON array".to_owned(),
        ));
    }

    Err(ClaudeError::ParseError(format!(
        "No JSON found in output: {}",
        &trimmed[..trimmed.len().min(200)]
    )))
}

/// Parse a JSON string into a value, wrapping parse errors with context.
pub(crate) fn parse_json<T: serde::de::DeserializeOwned>(json_str: &str) -> Result<T, ClaudeError> {
    serde_json::from_str(json_str).map_err(|e| {
        ClaudeError::ParseError(format!(
            "JSON parse error: {}. Input: {}",
            e,
            &json_str[..json_str.len().min(500)]
        ))
    })
}

#[derive(Error, Debug)]
pub enum ClaudeError {
    #[error("Claude CLI not found. Install from https://claude.ai/code")]
    ClaudeNotFound,
    #[error("Claude command failed: {0}")]
    CommandFailed(String),
    #[error("Failed to parse Claude response: {0}")]
    ParseError(String),
    #[error("Empty response from Claude")]
    EmptyResponse,
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
}

/// Check if the claude CLI is available
pub fn check_claude_available() -> bool {
    find_claude_executable().is_some()
}

/// Verify Claude is available when not using a custom command.
///
/// When a custom command is provided, Claude CLI is not needed.
/// Otherwise, this returns `ClaudeNotFound` if the CLI cannot be located.
pub(crate) fn ensure_claude_available(custom_command: Option<&str>) -> Result<(), ClaudeError> {
    if custom_command.is_none() {
        find_claude_executable().ok_or(ClaudeError::ClaudeNotFound)?;
    }
    Ok(())
}

/// Find the claude executable in PATH
pub(crate) fn find_claude_executable() -> Option<String> {
    // Try common locations
    let candidates = if cfg!(target_os = "windows") {
        vec!["claude.exe", "claude.cmd", "claude.bat"]
    } else {
        vec!["claude"]
    };

    for candidate in candidates {
        // Use `which` on Unix or `where` on Windows
        let which_cmd = if cfg!(target_os = "windows") {
            "where"
        } else {
            "which"
        };

        if let Ok(output) = Command::new(which_cmd).arg(candidate).output() {
            if output.status.success() {
                let path = String::from_utf8_lossy(&output.stdout)
                    .lines()
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_owned();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }

    // Fallback: check the standard installation path directly.
    // macOS GUI apps get a minimal PATH that excludes ~/.local/bin,
    // so `which` fails even though claude is installed.
    #[cfg(not(target_os = "windows"))]
    if let Some(home) = std::env::var_os("HOME") {
        let fallback = std::path::PathBuf::from(home).join(".local/bin/claude");
        if fallback.is_file() {
            return Some(fallback.to_string_lossy().into_owned());
        }
    }

    None
}

/// Run claude CLI with the given prompt and model, or use a custom command.
///
/// The prompt is piped via stdin to avoid OS argument length limits
/// (`ARG_MAX` ~1MB on macOS) which caused failures on large reviews.
///
/// # Security Warning
///
/// The `custom_command` parameter allows arbitrary shell command execution.
/// This is intentionally provided to allow users to use alternative AI backends
/// or custom wrappers, but it should only be set by the user through trusted
/// configuration (the app's settings UI). The command receives the full prompt
/// via stdin, so ensure the command itself is trusted.
pub(crate) fn run_claude_with_model(
    prompt: &str,
    cwd: &Path,
    model: &str,
    custom_command: Option<&str>,
    allowed_tools: &[&str],
) -> Result<String, ClaudeError> {
    // Build the Command differently depending on custom vs default CLI,
    // but share all the spawn/stdin/wait logic below.
    let mut cmd = if let Some(custom) = custom_command {
        let parts: Vec<&str> = custom.split_whitespace().collect();
        if parts.is_empty() {
            return Err(ClaudeError::CommandFailed(
                "Custom command is empty".to_owned(),
            ));
        }
        let mut c = Command::new(parts[0]);
        c.args(&parts[1..]);
        c
    } else {
        let claude_path = find_claude_executable().ok_or(ClaudeError::ClaudeNotFound)?;
        let mut c = Command::new(claude_path);
        c.args([
            "--print",
            "--model",
            model,
            "--setting-sources",
            "",
            "--disable-slash-commands",
            "--strict-mcp-config",
        ]);
        for tool in allowed_tools {
            c.args(["--allowedTools", tool]);
        }
        c
    };

    // Pipe the prompt via stdin to avoid OS argument length limits
    // (ARG_MAX ~1MB on macOS) which caused failures on large reviews.
    let mut child = cmd
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(cwd)
        .env_remove("CLAUDECODE")
        .spawn()
        .map_err(|e| ClaudeError::CommandFailed(e.to_string()))?;

    if let Some(mut stdin) = child.stdin.take() {
        stdin.write_all(prompt.as_bytes()).map_err(|e| {
            ClaudeError::CommandFailed(format!("Failed to write prompt to stdin: {e}"))
        })?;
    }

    let output = child
        .wait_with_output()
        .map_err(|e| ClaudeError::CommandFailed(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let code = output
            .status
            .code()
            .map(|c| format!("exit code {c}"))
            .unwrap_or_else(|| "killed by signal".to_string());

        let detail = if !stderr.is_empty() {
            stderr
        } else if !stdout.is_empty() {
            stdout
        } else {
            code
        };

        return Err(ClaudeError::CommandFailed(detail));
    }

    let stderr_str = String::from_utf8_lossy(&output.stderr);
    if !stderr_str.trim().is_empty() {
        eprintln!("[run_claude_with_model] stderr (command succeeded): {stderr_str}");
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Err(ClaudeError::EmptyResponse);
    }

    Ok(stdout)
}
