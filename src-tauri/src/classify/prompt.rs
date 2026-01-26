use crate::trust::patterns::get_trust_taxonomy;

/// Build a formatted taxonomy string for the classification prompt
fn build_taxonomy_string() -> String {
    let taxonomy = get_trust_taxonomy();
    let mut result = String::new();

    for category in taxonomy {
        result.push_str(&format!("## {}\n", category.name));
        result.push_str(&format!("{}\n\n", category.description));

        for pattern in category.patterns {
            result.push_str(&format!("- `{}`: {}\n", pattern.id, pattern.description));
        }
        result.push('\n');
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
pub fn build_single_hunk_prompt(hunk: &HunkInput) -> String {
    let taxonomy = build_taxonomy_string();

    format!(
        r#"Classify this code change hunk. Respond with JSON only, no markdown.

# Trust Pattern Taxonomy

{taxonomy}
# Hunk to Classify

File: {file_path}
```diff
{content}
```

# Response Format

Respond with ONLY this JSON structure (no markdown code blocks):
{{"label": ["pattern:id"], "reasoning": "Brief explanation"}}

Rules:
- Use exact pattern IDs from the taxonomy (e.g., "imports:added", "formatting:whitespace")
- Multiple labels are allowed: {{"label": ["imports:added", "imports:removed"], "reasoning": "..."}}
- If the change doesn't fit any pattern or mixes trustable with non-trustable changes, use empty labels: {{"label": [], "reasoning": "Requires manual review because..."}}"#,
        taxonomy = taxonomy,
        file_path = hunk.file_path,
        content = hunk.content
    )
}
