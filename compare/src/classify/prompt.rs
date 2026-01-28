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
        r#"Determine if this diff hunk is a trivial, mechanical change that a reviewer can safely skip. If it is, apply the matching label. If not, use `review:required`.

# Valid Labels (use ONLY these exact strings)

{taxonomy}
# Rules

1. DEFAULT TO `review:required`. Most hunks need human review. Only use other labels for trivial, mechanical changes.
2. A non-review label applies ONLY when the ENTIRE hunk matches its description exactly.
3. Any change to values, logic, behavior, or configuration = `review:required`.
4. Mixed changes (e.g., import added + code changed) = `review:required`.
5. Template/markup tags (`{{% endif %}}`, `<div>`, `{{{{ }}}}`) are structural code, NOT whitespace. Removing or adding them is a code change.
6. If a hunk changes code AND adds/modifies/removes a comment, it is mixed = `review:required`.
7. Use ONLY the exact label strings listed above.

# Hunk

File: {file_path}
```diff
{content}
```

# Response

STEP 1: List each changed line (+ or -) and what it does (code, comment, whitespace, import, etc.)
STEP 2: Do ALL changed lines fall under a single trivial label's description?
STEP 3: If yes, use that label. If not, use review:required.

After your analysis, return JSON on its own line:
{{"label": ["label:id"], "reasoning": "one sentence"}}"#,
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
        r#"Determine if these diff hunks are trivial, mechanical changes that a reviewer can safely skip. If a hunk is trivial, apply the matching label. If not, use `review:required`.

# Valid Labels (use ONLY these exact strings)

{taxonomy}
# Rules

1. DEFAULT TO `review:required`. Most hunks need human review. Only use other labels for trivial, mechanical changes.
2. A non-review label applies ONLY when the ENTIRE hunk matches its description exactly.
3. Any change to values, logic, behavior, or configuration = `review:required`.
4. Mixed changes (e.g., import added + code changed) = `review:required`.
5. Template/markup tags (`{{% endif %}}`, `<div>`, `{{{{ }}}}`) are structural code, NOT whitespace. Removing or adding them is a code change.
6. If a hunk changes code AND adds/modifies/removes a comment, it is mixed = `review:required`.
7. Use ONLY the exact label strings listed above.
8. You MUST classify EVERY hunk ID listed above.

# Hunks

{hunks_section}
# Response

For EACH hunk, analyze it step by step:
STEP 1: List each changed line (+ or -) and what it does (code, comment, whitespace, import, etc.)
STEP 2: Do ALL changed lines fall under a single trivial label's description?
STEP 3: If yes, use that label. If not, use review:required.

After analyzing all hunks, return JSON on its own line:
{{
  "hunk_id": {{"label": ["label:id"], "reasoning": "one sentence"}},
  ...
}}"#,
        taxonomy = taxonomy,
        hunks_section = hunks_section
    )
}
