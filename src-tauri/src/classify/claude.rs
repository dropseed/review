use super::prompt::{build_batch_prompt, build_single_hunk_prompt, HunkInput};
use futures::future::join_all;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use std::process::Command;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::Semaphore;

#[derive(Error, Debug)]
pub enum ClassifyError {
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassificationResult {
    pub label: Vec<String>,
    pub reasoning: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClassifyResponse {
    pub classifications: HashMap<String, ClassificationResult>,
}

/// Check if the claude CLI is available
pub fn check_claude_available() -> bool {
    find_claude_executable().is_some()
}

/// Find the claude executable in PATH
fn find_claude_executable() -> Option<String> {
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
                    .to_string();
                if !path.is_empty() {
                    return Some(path);
                }
            }
        }
    }

    None
}

/// Run claude CLI with the given prompt and model, or use a custom command
fn run_claude_with_model(
    prompt: &str,
    cwd: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<String, ClassifyError> {
    let output = if let Some(cmd) = custom_command {
        // Parse the custom command and append the prompt as the last argument
        let parts: Vec<&str> = cmd.split_whitespace().collect();
        if parts.is_empty() {
            return Err(ClassifyError::CommandFailed(
                "Custom command is empty".to_string(),
            ));
        }
        let program = parts[0];
        let mut args: Vec<&str> = parts[1..].to_vec();
        args.push(prompt);

        Command::new(program)
            .args(&args)
            .current_dir(cwd)
            .output()
            .map_err(|e| ClassifyError::CommandFailed(e.to_string()))?
    } else {
        // Use default claude CLI
        let claude_path = find_claude_executable().ok_or(ClassifyError::ClaudeNotFound)?;

        Command::new(&claude_path)
            .args(["--print", "--model", model, "-p", prompt])
            .current_dir(cwd)
            .output()
            .map_err(|e| ClassifyError::CommandFailed(e.to_string()))?
    };

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(ClassifyError::CommandFailed(stderr.to_string()));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    if stdout.trim().is_empty() {
        return Err(ClassifyError::EmptyResponse);
    }

    Ok(stdout)
}

/// Extract a single classification result from Claude's output
fn extract_single_classification(output: &str) -> Result<ClassificationResult, ClassifyError> {
    let trimmed = output.trim();

    // Try to find JSON, handling various formats
    let json_str = if let Some(start) = trimmed.find("```json") {
        let after_marker = &trimmed[start + 7..];
        if let Some(end) = after_marker.find("```") {
            after_marker[..end].trim()
        } else {
            after_marker.trim()
        }
    } else if let Some(start) = trimmed.find("```") {
        let after_marker = &trimmed[start + 3..];
        let after_newline = after_marker
            .find('\n')
            .map(|i| &after_marker[i + 1..])
            .unwrap_or(after_marker);
        if let Some(end) = after_newline.find("```") {
            after_newline[..end].trim()
        } else {
            after_newline.trim()
        }
    } else if trimmed.starts_with('{') {
        trimmed
    } else if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            &trimmed[start..=end]
        } else {
            return Err(ClassifyError::ParseError(
                "Could not find complete JSON object".to_string(),
            ));
        }
    } else {
        return Err(ClassifyError::ParseError(format!(
            "No JSON found in output: {}",
            &trimmed[..trimmed.len().min(200)]
        )));
    };

    serde_json::from_str(json_str).map_err(|e| {
        ClassifyError::ParseError(format!(
            "JSON parse error: {}. Input: {}",
            e,
            &json_str[..json_str.len().min(500)]
        ))
    })
}

/// Classify a single hunk using Claude CLI
fn classify_single_hunk(
    hunk: &HunkInput,
    repo_path: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<(String, ClassificationResult), ClassifyError> {
    let prompt = build_single_hunk_prompt(hunk);
    let output = run_claude_with_model(&prompt, repo_path, model, custom_command)?;
    let result = extract_single_classification(&output)?;
    Ok((hunk.id.clone(), result))
}

/// Extract batch classifications from Claude's output
fn extract_batch_classifications(
    output: &str,
) -> Result<HashMap<String, ClassificationResult>, ClassifyError> {
    let trimmed = output.trim();

    // Try to find JSON, handling various formats
    let json_str = if let Some(start) = trimmed.find("```json") {
        let after_marker = &trimmed[start + 7..];
        if let Some(end) = after_marker.find("```") {
            after_marker[..end].trim()
        } else {
            after_marker.trim()
        }
    } else if let Some(start) = trimmed.find("```") {
        let after_marker = &trimmed[start + 3..];
        let after_newline = after_marker
            .find('\n')
            .map(|i| &after_marker[i + 1..])
            .unwrap_or(after_marker);
        if let Some(end) = after_newline.find("```") {
            after_newline[..end].trim()
        } else {
            after_newline.trim()
        }
    } else if trimmed.starts_with('{') {
        trimmed
    } else if let Some(start) = trimmed.find('{') {
        if let Some(end) = trimmed.rfind('}') {
            &trimmed[start..=end]
        } else {
            return Err(ClassifyError::ParseError(
                "Could not find complete JSON object".to_string(),
            ));
        }
    } else {
        return Err(ClassifyError::ParseError(format!(
            "No JSON found in output: {}",
            &trimmed[..trimmed.len().min(200)]
        )));
    };

    serde_json::from_str(json_str).map_err(|e| {
        ClassifyError::ParseError(format!(
            "JSON parse error: {}. Input: {}",
            e,
            &json_str[..json_str.len().min(500)]
        ))
    })
}

/// Classify a batch of hunks using a single Claude CLI call
fn classify_batch(
    hunks: &[HunkInput],
    repo_path: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<HashMap<String, ClassificationResult>, ClassifyError> {
    if hunks.is_empty() {
        return Ok(HashMap::new());
    }

    // For a single hunk, use the single hunk prompt for better results
    if hunks.len() == 1 {
        let (id, result) = classify_single_hunk(&hunks[0], repo_path, model, custom_command)?;
        let mut map = HashMap::new();
        map.insert(id, result);
        return Ok(map);
    }

    let prompt = build_batch_prompt(hunks);
    let output = run_claude_with_model(&prompt, repo_path, model, custom_command)?;
    extract_batch_classifications(&output)
}

/// Classify hunks in batches using Claude CLI
/// The on_batch_complete callback is called after each batch finishes with the IDs that were classified
pub async fn classify_hunks_batched<F>(
    hunks: Vec<HunkInput>,
    repo_path: &Path,
    model: &str,
    batch_size: usize,
    max_concurrent: usize,
    custom_command: Option<&str>,
    on_batch_complete: F,
) -> Result<ClassifyResponse, ClassifyError>
where
    F: Fn(Vec<String>) + Send + Sync + 'static,
{
    if hunks.is_empty() {
        return Ok(ClassifyResponse {
            classifications: HashMap::new(),
        });
    }

    let semaphore = Arc::new(Semaphore::new(max_concurrent));
    let repo_path = repo_path.to_path_buf();
    let model = model.to_string();
    let custom_command = custom_command.map(|s| s.to_string());
    let on_batch_complete = Arc::new(on_batch_complete);

    // Split hunks into batches, keeping track of IDs per batch
    let batches: Vec<(Vec<String>, Vec<HunkInput>)> = hunks
        .chunks(batch_size)
        .map(|chunk| {
            let ids: Vec<String> = chunk.iter().map(|h| h.id.clone()).collect();
            (ids, chunk.to_vec())
        })
        .collect();

    eprintln!(
        "[classify_hunks_batched] Processing {} hunks in {} batches (batch_size={}, max_concurrent={})",
        hunks.len(),
        batches.len(),
        batch_size,
        max_concurrent
    );

    let tasks: Vec<_> = batches
        .into_iter()
        .map(|(batch_ids, batch)| {
            let sem = semaphore.clone();
            let repo = repo_path.clone();
            let m = model.clone();
            let cmd = custom_command.clone();
            let callback = on_batch_complete.clone();
            tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                // Run the blocking Claude CLI call in a blocking thread
                let result = tokio::task::spawn_blocking(move || {
                    classify_batch(&batch, &repo, &m, cmd.as_deref())
                })
                .await
                .map_err(|e| ClassifyError::CommandFailed(format!("Task join error: {}", e)))?;

                // Call the callback with the batch IDs that were processed
                callback(batch_ids);

                result
            })
        })
        .collect();

    let results = join_all(tasks).await;

    let mut classifications = HashMap::new();
    let mut errors = Vec::new();

    for result in results {
        match result {
            Ok(Ok(batch_results)) => {
                classifications.extend(batch_results);
            }
            Ok(Err(e)) => {
                errors.push(e.to_string());
            }
            Err(e) => {
                errors.push(format!("Task join error: {}", e));
            }
        }
    }

    // If we got some classifications, return them even if some failed
    if !classifications.is_empty() {
        if !errors.is_empty() {
            eprintln!(
                "[classify_hunks_batched] {} errors occurred: {:?}",
                errors.len(),
                errors
            );
        }
        Ok(ClassifyResponse { classifications })
    } else if !errors.is_empty() {
        Err(ClassifyError::CommandFailed(errors.join("; ")))
    } else {
        Ok(ClassifyResponse { classifications })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_single_classification_from_markdown() {
        let output = r#"Here's the classification:

```json
{
  "label": ["imports:added"],
  "reasoning": "New import statement"
}
```

That's the result."#;

        let result = extract_single_classification(output).unwrap();
        assert_eq!(result.label, vec!["imports:added"]);
        assert_eq!(result.reasoning, "New import statement");
    }

    #[test]
    fn test_extract_single_classification_plain_json() {
        let output =
            r#"{"label": ["formatting:whitespace"], "reasoning": "Whitespace changes only"}"#;

        let result = extract_single_classification(output).unwrap();
        assert_eq!(result.label, vec!["formatting:whitespace"]);
    }

    #[test]
    fn test_extract_single_classification_multiple_labels() {
        let output = r#"{"label": ["imports:added", "imports:removed"], "reasoning": "Import reorganization"}"#;

        let result = extract_single_classification(output).unwrap();
        assert_eq!(result.label.len(), 2);
        assert!(result.label.contains(&"imports:added".to_string()));
        assert!(result.label.contains(&"imports:removed".to_string()));
    }

    #[test]
    fn test_extract_single_classification_empty_labels() {
        let output = r#"{"label": [], "reasoning": "Complex logic change requiring review"}"#;

        let result = extract_single_classification(output).unwrap();
        assert!(result.label.is_empty());
    }

    #[test]
    fn test_extract_batch_classifications() {
        let output = r#"{
            "file.ts:abc123": {"label": ["imports:added"], "reasoning": "New import"},
            "file.ts:def456": {"label": ["formatting:whitespace"], "reasoning": "Whitespace only"}
        }"#;

        let result = extract_batch_classifications(output).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.contains_key("file.ts:abc123"));
        assert!(result.contains_key("file.ts:def456"));
        assert_eq!(result["file.ts:abc123"].label, vec!["imports:added"]);
        assert_eq!(
            result["file.ts:def456"].label,
            vec!["formatting:whitespace"]
        );
    }

    #[test]
    fn test_extract_batch_classifications_with_markdown() {
        let output = r#"Here are the classifications:

```json
{
    "src/app.ts:hash1": {"label": ["code:relocated"], "reasoning": "Code moved"},
    "src/app.ts:hash2": {"label": [], "reasoning": "Needs review"}
}
```

Done."#;

        let result = extract_batch_classifications(output).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result["src/app.ts:hash1"].label, vec!["code:relocated"]);
        assert!(result["src/app.ts:hash2"].label.is_empty());
    }
}
