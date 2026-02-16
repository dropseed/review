use super::{extract_json_str, parse_json, run_claude_with_model, ClaudeError};
use crate::classify::{ClassificationResult, ClassifyResponse};
use crate::trust::patterns::{get_trust_taxonomy, is_valid_pattern_id};
use futures::future::join_all;
use std::collections::HashMap;
use std::fmt::Write;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::Semaphore;

// ---------------------------------------------------------------------------
// Prompt construction (merged from classify/prompt.rs)
// ---------------------------------------------------------------------------

/// Labels that are fully handled by the static classifier and should
/// never be offered to the AI (to prevent hallucinated matches).
const STATIC_ONLY_LABELS: &[&str] = &["formatting:whitespace", "generated:lockfile"];

/// Build a flat list of all valid labels with descriptions,
/// excluding labels that are handled entirely by the static classifier.
fn build_taxonomy_string() -> String {
    let taxonomy = get_trust_taxonomy();
    let mut result = String::new();

    for category in taxonomy {
        for pattern in category.patterns {
            if STATIC_ONLY_LABELS.contains(&pattern.id.as_str()) {
                continue;
            }
            let _ = writeln!(result, "- `{}`: {}", pattern.id, pattern.description);
        }
    }

    result
}

/// Input structure for a hunk to classify
#[derive(Debug, Clone, serde::Deserialize)]
pub struct HunkInput {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
}

/// Build a prompt for classifying a single hunk
fn build_single_hunk_prompt(hunk: &HunkInput) -> String {
    let taxonomy = build_taxonomy_string();

    format!(
        r#"Determine if this diff hunk is a trivial, mechanical change that a reviewer can safely skip. If it matches a trivial pattern, apply the matching label. If not, return an empty label array.

# Valid Labels (use ONLY these exact strings)

{taxonomy}
# Rules

1. DEFAULT TO EMPTY LABELS. Most hunks need human review. Only apply a label for trivial, mechanical changes.
2. A label applies ONLY when the ENTIRE hunk matches its description exactly.
3. Any change to values, logic, behavior, or configuration = empty labels.
4. Mixed changes (e.g., import added + code changed) = empty labels.
5. If a hunk changes code AND adds/modifies/removes a comment, it is mixed = empty labels.
6. Use ONLY the exact label strings listed above.

# Hunk

File: {file_path}
```diff
{content}
```

# Response

STEP 1: List each changed line (+ or -) and what it does (code, comment, whitespace, import, etc.)
STEP 2: Do ALL changed lines fall under a single trivial label's description?
STEP 3: If yes, use that label. If not, return empty labels.

After your analysis, return JSON on its own line:
{{"label": [], "reasoning": "one sentence"}}"#,
        taxonomy = taxonomy,
        file_path = hunk.file_path,
        content = hunk.content
    )
}

/// Build a prompt for classifying multiple hunks in a single request
fn build_batch_prompt(hunks: &[HunkInput]) -> String {
    let taxonomy = build_taxonomy_string();

    let mut hunks_section = String::new();
    for (i, hunk) in hunks.iter().enumerate() {
        let _ = write!(
            hunks_section,
            r"### Hunk {} (ID: {})
File: {}
```diff
{}
```

",
            i + 1,
            hunk.id,
            hunk.file_path,
            hunk.content
        );
    }

    format!(
        r#"Determine if these diff hunks are trivial, mechanical changes that a reviewer can safely skip. If a hunk matches a trivial pattern, apply the matching label. If not, return an empty label array.

# Valid Labels (use ONLY these exact strings)

{taxonomy}
# Rules

1. DEFAULT TO EMPTY LABELS. Most hunks need human review. Only apply a label for trivial, mechanical changes.
2. A label applies ONLY when the ENTIRE hunk matches its description exactly.
3. Any change to values, logic, behavior, or configuration = empty labels.
4. Mixed changes (e.g., import added + code changed) = empty labels.
5. If a hunk changes code AND adds/modifies/removes a comment, it is mixed = empty labels.
6. Use ONLY the exact label strings listed above.
7. You MUST classify EVERY hunk ID listed above.

# Hunks

{hunks_section}
# Response

For EACH hunk, analyze it step by step:
STEP 1: List each changed line (+ or -) and what it does (code, comment, whitespace, import, etc.)
STEP 2: Do ALL changed lines fall under a single trivial label's description?
STEP 3: If yes, use that label. If not, return empty labels.

After analyzing all hunks, return JSON on its own line:
{{
  "hunk_id": {{"label": [], "reasoning": "one sentence"}},
  ...
}}"#
    )
}

// ---------------------------------------------------------------------------
// Classification logic (merged from classify/claude.rs)
// ---------------------------------------------------------------------------

/// Filter out invalid labels and return only valid taxonomy pattern IDs.
fn validate_labels(result: ClassificationResult) -> ClassificationResult {
    let valid_labels: Vec<String> = result
        .label
        .into_iter()
        .filter(|label| {
            if is_valid_pattern_id(label) {
                true
            } else {
                eprintln!(
                    "[validate_labels] Filtered out invalid label: '{label}' - not in taxonomy"
                );
                false
            }
        })
        .collect();

    ClassificationResult {
        label: valid_labels,
        reasoning: result.reasoning,
    }
}

/// Extract a single classification result from Claude's output
fn extract_single_classification(output: &str) -> Result<ClassificationResult, ClaudeError> {
    let json_str = extract_json_str(output)?;
    parse_json(json_str)
}

/// Classify a single hunk using Claude CLI
pub(crate) fn classify_single_hunk(
    hunk: &HunkInput,
    repo_path: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<(String, ClassificationResult), ClaudeError> {
    let prompt = build_single_hunk_prompt(hunk);
    let output = run_claude_with_model(&prompt, repo_path, model, custom_command, &[])?;
    let result = extract_single_classification(&output)?;
    let validated = validate_labels(result);
    Ok((hunk.id.clone(), validated))
}

/// Extract batch classifications from Claude's output
fn extract_batch_classifications(
    output: &str,
) -> Result<HashMap<String, ClassificationResult>, ClaudeError> {
    let json_str = extract_json_str(output)?;
    let parsed: HashMap<String, ClassificationResult> = parse_json(json_str)?;

    Ok(parsed
        .into_iter()
        .map(|(id, result)| (id, validate_labels(result)))
        .collect())
}

/// Classify a batch of hunks using a single Claude CLI call
fn classify_batch(
    hunks: &[HunkInput],
    repo_path: &Path,
    model: &str,
    custom_command: Option<&str>,
) -> Result<HashMap<String, ClassificationResult>, ClaudeError> {
    if hunks.is_empty() {
        return Ok(HashMap::new());
    }

    // For a single hunk, use the single hunk prompt for better results
    if hunks.len() == 1 {
        let (id, result) = classify_single_hunk(&hunks[0], repo_path, model, custom_command)?;
        return Ok(HashMap::from([(id, result)]));
    }

    let prompt = build_batch_prompt(hunks);
    let output = run_claude_with_model(&prompt, repo_path, model, custom_command, &[])?;
    extract_batch_classifications(&output)
}

/// Classify hunks in batches using Claude CLI
/// The on_batch_complete callback is called after each batch finishes with the IDs that were classified
/// and the classification results for that batch (empty map on error).
pub async fn classify_hunks_batched<F>(
    hunks: Vec<HunkInput>,
    repo_path: &Path,
    model: &str,
    batch_size: usize,
    max_concurrent: usize,
    custom_command: Option<&str>,
    on_batch_complete: F,
) -> Result<ClassifyResponse, ClaudeError>
where
    F: Fn(Vec<String>, HashMap<String, ClassificationResult>) + Send + Sync + 'static,
{
    if hunks.is_empty() {
        return Ok(ClassifyResponse {
            classifications: HashMap::new(),
            skipped_hunk_ids: Vec::new(),
        });
    }

    let semaphore = Arc::new(Semaphore::new(max_concurrent));
    let repo_path = repo_path.to_path_buf();
    let model = model.to_owned();
    let custom_command = custom_command.map(std::borrow::ToOwned::to_owned);
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
            let sem = Arc::clone(&semaphore);
            let repo = repo_path.clone();
            let m = model.clone();
            let cmd = custom_command.clone();
            let callback = Arc::clone(&on_batch_complete);
            tokio::spawn(async move {
                let _permit = sem.acquire().await.expect("semaphore closed unexpectedly");
                // Run the blocking Claude CLI call in a blocking thread
                let result = tokio::task::spawn_blocking(move || {
                    classify_batch(&batch, &repo, &m, cmd.as_deref())
                })
                .await
                .map_err(|e| ClaudeError::CommandFailed(format!("Task join error: {e}")))?;

                // Call the callback with the batch IDs and results (empty map on error)
                let batch_results = match &result {
                    Ok(classifications) => classifications.clone(),
                    Err(_) => HashMap::new(),
                };
                callback(batch_ids, batch_results);

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
                errors.push(format!("Task join error: {e}"));
            }
        }
    }

    // If all batches failed and we got nothing, propagate the error
    if classifications.is_empty() && !errors.is_empty() {
        return Err(ClaudeError::CommandFailed(errors.join("; ")));
    }

    // Log partial failures but return whatever we got
    if !errors.is_empty() {
        eprintln!(
            "[classify_hunks_batched] {} errors occurred: {:?}",
            errors.len(),
            errors
        );
    }

    Ok(ClassifyResponse {
        classifications,
        skipped_hunk_ids: Vec::new(),
    })
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
    "src/app.ts:hash1": {"label": ["imports:reordered"], "reasoning": "Imports reorganized"},
    "src/app.ts:hash2": {"label": [], "reasoning": "Needs review"}
}
```

Done."#;

        let result = extract_batch_classifications(output).unwrap();
        assert_eq!(result.len(), 2);
        assert_eq!(result["src/app.ts:hash1"].label, vec!["imports:reordered"]);
        assert!(result["src/app.ts:hash2"].label.is_empty());
    }

    #[test]
    fn test_extract_batch_classifications_filters_invalid_labels() {
        let output = r#"{
            "src/app.ts:hash1": {"label": ["code:invented", "imports:added"], "reasoning": "Mixed valid/invalid"},
            "src/app.ts:hash2": {"label": ["totally:fake"], "reasoning": "All invalid"}
        }"#;

        let result = extract_batch_classifications(output).unwrap();
        assert_eq!(result.len(), 2);
        // Only valid label should remain
        assert_eq!(result["src/app.ts:hash1"].label, vec!["imports:added"]);
        // Invalid labels filtered out, leaving empty
        assert!(result["src/app.ts:hash2"].label.is_empty());
    }

    #[test]
    fn test_taxonomy_string_excludes_static_only_labels() {
        let taxonomy = build_taxonomy_string();
        assert!(
            !taxonomy.contains("formatting:whitespace"),
            "formatting:whitespace should be excluded from AI taxonomy"
        );
        assert!(
            !taxonomy.contains("generated:lockfile"),
            "generated:lockfile should be excluded from AI taxonomy"
        );
        // Other labels should still be present
        assert!(taxonomy.contains("formatting:line-length"));
        assert!(taxonomy.contains("formatting:style"));
        assert!(taxonomy.contains("imports:added"));
    }
}
