use super::prompt::{build_single_hunk_prompt, HunkInput};
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

/// Run claude CLI with the given prompt and model
fn run_claude_with_model(prompt: &str, cwd: &Path, model: &str) -> Result<String, ClassifyError> {
    let claude_path = find_claude_executable().ok_or(ClassifyError::ClaudeNotFound)?;

    let output = Command::new(&claude_path)
        .args(["--print", "--model", model, "-p", prompt])
        .current_dir(cwd)
        .output()
        .map_err(|e| ClassifyError::CommandFailed(e.to_string()))?;

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
) -> Result<(String, ClassificationResult), ClassifyError> {
    let prompt = build_single_hunk_prompt(hunk);
    let output = run_claude_with_model(&prompt, repo_path, model)?;
    let result = extract_single_classification(&output)?;
    Ok((hunk.id.clone(), result))
}

/// Classify hunks in parallel using Claude CLI
pub async fn classify_hunks_parallel(
    hunks: Vec<HunkInput>,
    repo_path: &Path,
    model: &str,
    max_concurrent: usize,
) -> Result<ClassifyResponse, ClassifyError> {
    if hunks.is_empty() {
        return Ok(ClassifyResponse {
            classifications: HashMap::new(),
        });
    }

    let semaphore = Arc::new(Semaphore::new(max_concurrent));
    let repo_path = repo_path.to_path_buf();
    let model = model.to_string();

    let tasks: Vec<_> = hunks
        .into_iter()
        .map(|hunk| {
            let sem = semaphore.clone();
            let repo = repo_path.clone();
            let m = model.clone();
            tokio::spawn(async move {
                let _permit = sem.acquire().await.unwrap();
                // Run the blocking Claude CLI call in a blocking thread
                tokio::task::spawn_blocking(move || classify_single_hunk(&hunk, &repo, &m))
                    .await
                    .map_err(|e| ClassifyError::CommandFailed(format!("Task join error: {}", e)))?
            })
        })
        .collect();

    let results = join_all(tasks).await;

    let mut classifications = HashMap::new();
    let mut errors = Vec::new();

    for result in results {
        match result {
            Ok(Ok((id, classification))) => {
                classifications.insert(id, classification);
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
                "[classify_hunks_parallel] {} errors occurred: {:?}",
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
}
