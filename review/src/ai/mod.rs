pub mod grouping;

use std::io::{BufRead, BufReader, Write};
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

/// Verify Claude CLI is available, returning `ClaudeNotFound` if not.
pub(crate) fn ensure_claude_available() -> Result<(), ClaudeError> {
    find_claude_executable().ok_or(ClaudeError::ClaudeNotFound)?;
    Ok(())
}

/// Find the claude executable in PATH
pub fn find_claude_executable() -> Option<String> {
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

/// Build a base `Command` for the Claude CLI with common flags applied.
fn build_claude_command(model: &str, allowed_tools: &[&str]) -> Result<Command, ClaudeError> {
    let claude_path = find_claude_executable().ok_or(ClaudeError::ClaudeNotFound)?;
    let mut cmd = Command::new(claude_path);
    cmd.args([
        "--print",
        "--model",
        model,
        "--setting-sources",
        "",
        "--disable-slash-commands",
        "--strict-mcp-config",
    ]);
    for tool in allowed_tools {
        cmd.args(["--allowedTools", tool]);
    }
    Ok(cmd)
}

/// Format a detail string for a failed Claude process.
fn format_exit_error(stderr: &str, stdout: &str, status: &std::process::ExitStatus) -> String {
    let stderr_trimmed = stderr.trim();
    let stdout_trimmed = stdout.trim();
    if !stderr_trimmed.is_empty() {
        stderr_trimmed.to_owned()
    } else if !stdout_trimmed.is_empty() {
        stdout_trimmed.to_owned()
    } else {
        status
            .code()
            .map(|c| format!("exit code {c}"))
            .unwrap_or_else(|| "killed by signal".to_owned())
    }
}

/// Run the Claude CLI with the given prompt and model.
///
/// The prompt is piped via stdin to avoid OS argument length limits
/// (`ARG_MAX` ~1MB on macOS) which caused failures on large reviews.
pub(crate) fn run_claude_with_model(
    prompt: &str,
    cwd: &Path,
    model: &str,
    allowed_tools: &[&str],
) -> Result<String, ClaudeError> {
    let mut cmd = build_claude_command(model, allowed_tools)?;

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
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        return Err(ClaudeError::CommandFailed(format_exit_error(
            &stderr,
            &stdout,
            &output.status,
        )));
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

/// Run the Claude CLI with streaming stdout via `--output-format stream-json`.
///
/// Uses NDJSON streaming output so that each token is flushed immediately
/// (avoids pipe-buffering that defeats streaming with plain `--print`).
/// Calls `on_text` with each text delta as it arrives.
/// Returns the full accumulated text output when the process exits.
///
/// Large diffs that use temp files + Read tool fall back to `run_claude_with_model`
/// since tool calls break the JSON stream.
pub fn run_claude_streaming(
    prompt: &str,
    cwd: &Path,
    model: &str,
    allowed_tools: &[&str],
    on_text: &mut dyn FnMut(&str),
) -> Result<String, ClaudeError> {
    let mut cmd = build_claude_command(model, allowed_tools)?;
    cmd.args([
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
    ]);

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

    // Take both pipes before reading either — we must drain stderr
    // concurrently to avoid a deadlock when the OS pipe buffer fills up.
    let stdout_pipe = child
        .stdout
        .take()
        .ok_or_else(|| ClaudeError::CommandFailed("Failed to capture stdout".to_owned()))?;
    let stderr_pipe = child.stderr.take();

    // Drain stderr on a background thread to prevent pipe buffer deadlock
    let stderr_thread = std::thread::spawn(move || {
        let mut stderr_output = String::new();
        if let Some(mut pipe) = stderr_pipe {
            use std::io::Read;
            let _ = pipe.read_to_string(&mut stderr_output);
        }
        stderr_output
    });

    // Read NDJSON events line-by-line as they stream in.
    //
    // With `--include-partial-messages`, Claude CLI emits token-level events:
    //   {"type":"stream_event","event":{"type":"content_block_delta",
    //    "delta":{"type":"text_delta","text":"..."}}}
    //
    // We also handle the final result event:
    //   {"type":"result","result":"full text here"}
    let reader = BufReader::new(stdout_pipe);
    let mut full_output = String::new();

    for line_result in reader.lines() {
        let line = line_result
            .map_err(|e| ClaudeError::CommandFailed(format!("Error reading stdout: {e}")))?;

        let event: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");

        match event_type {
            "stream_event" => {
                // Token-level streaming: extract text deltas
                if let Some(text) = event
                    .get("event")
                    .and_then(|e| e.get("delta"))
                    .and_then(|d| d.get("text"))
                    .and_then(|t| t.as_str())
                {
                    on_text(text);
                    full_output.push_str(text);
                }
            }
            "result" => {
                // Final result — use as canonical output, emit any missing tail
                if let Some(result_text) = event.get("result").and_then(|r| r.as_str()) {
                    if result_text.len() > full_output.len() {
                        let delta = &result_text[full_output.len()..];
                        if !delta.is_empty() {
                            on_text(delta);
                        }
                    }
                    full_output = result_text.to_owned();
                }
            }
            _ => {} // system, rate_limit_event, assistant, thinking — skip
        }
    }

    let stderr_str = stderr_thread.join().unwrap_or_default();

    // Wait for the process to finish
    let status = child
        .wait()
        .map_err(|e| ClaudeError::CommandFailed(e.to_string()))?;

    if !status.success() {
        return Err(ClaudeError::CommandFailed(format_exit_error(
            &stderr_str,
            &full_output,
            &status,
        )));
    }

    if !stderr_str.trim().is_empty() {
        eprintln!(
            "[run_claude_streaming] stderr (command succeeded): {}",
            stderr_str.trim()
        );
    }

    if full_output.trim().is_empty() {
        return Err(ClaudeError::EmptyResponse);
    }

    Ok(full_output)
}
