use crate::trust::patterns::get_trust_taxonomy;

/// Build a flat list of all valid labels with descriptions
fn build_taxonomy_string() -> String {
    let taxonomy = get_trust_taxonomy();
    let mut result = String::new();

    for category in taxonomy {
        for pattern in category.patterns {
            result.push_str(&format!("- `{}`: {}\n", pattern.id, pattern.description));
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
pub fn build_single_hunk_prompt(hunk: &HunkInput) -> String {
    let taxonomy = build_taxonomy_string();

    format!(
        r#"Classify this diff hunk. Use ONLY labels from the list below, or empty labels if none apply.

# Valid Labels (use ONLY these exact strings)

{taxonomy}
# Hunk

File: {file_path}
```diff
{content}
```

# Response

Return JSON only, no markdown:
{{"label": ["label:id"], "reasoning": "one sentence"}}

# Rules

1. DEFAULT TO EMPTY LABELS. When uncertain, use []. Most hunks need human review.
2. Labels are for TRIVIAL, MECHANICAL changes only - things a reviewer can safely skip.
3. A label applies ONLY when the ENTIRE hunk matches its description exactly.
4. Any change to values, logic, behavior, or configuration = empty labels [].
5. Mixed changes (e.g., import added + code changed) = empty labels [].
6. Use ONLY the exact label strings listed above. Inventing labels is forbidden."#,
        taxonomy = taxonomy,
        file_path = hunk.file_path,
        content = hunk.content
    )
}

/// Build a prompt for classifying multiple hunks in a single request
pub fn build_batch_prompt(hunks: &[HunkInput]) -> String {
    let taxonomy = build_taxonomy_string();

    let mut hunks_section = String::new();
    for (i, hunk) in hunks.iter().enumerate() {
        hunks_section.push_str(&format!(
            r#"### Hunk {} (ID: {})
File: {}
```diff
{}
```

"#,
            i + 1,
            hunk.id,
            hunk.file_path,
            hunk.content
        ));
    }

    format!(
        r#"Classify these diff hunks. Use ONLY labels from the list below, or empty labels if none apply.

# Valid Labels (use ONLY these exact strings)

{taxonomy}
# Hunks

{hunks_section}
# Response

Return JSON only, no markdown:
{{
  "hunk_id": {{"label": ["label:id"], "reasoning": "one sentence"}},
  ...
}}

# Rules

1. DEFAULT TO EMPTY LABELS. When uncertain, use []. Most hunks need human review.
2. Labels are for TRIVIAL, MECHANICAL changes only - things a reviewer can safely skip.
3. A label applies ONLY when the ENTIRE hunk matches its description exactly.
4. Any change to values, logic, behavior, or configuration = empty labels [].
5. Mixed changes (e.g., import added + code changed) = empty labels [].
6. Use ONLY the exact label strings listed above. Inventing labels is forbidden.
7. You MUST provide a classification for EVERY hunk ID listed above."#,
        taxonomy = taxonomy,
        hunks_section = hunks_section
    )
}
