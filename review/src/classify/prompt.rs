use crate::trust::patterns::get_trust_taxonomy;
use std::fmt::Write;

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
pub fn build_single_hunk_prompt(hunk: &HunkInput) -> String {
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
pub fn build_batch_prompt(hunks: &[HunkInput]) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;

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
