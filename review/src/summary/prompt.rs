use serde::Deserialize;
use std::fmt::Write;

/// Input for summary generation — one per hunk.
#[derive(Debug, Clone, Deserialize)]
pub struct SummaryInput {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
    #[serde(default)]
    pub label: Option<Vec<String>>,
}

/// Build the prompt sent to Claude for diff summary generation.
pub fn build_summary_prompt(hunks: &[SummaryInput]) -> String {
    let mut prompt = String::new();

    let _ = write!(
        prompt,
        "You are a code-review assistant. Given a set of diff hunks from a code review, \
         write a concise 2-4 sentence summary of what this diff does and its key changes.\n\n\
         ## Rules\n\n\
         - Focus on what changed and why, not listing every file.\n\
         - Output plain text only — no JSON, no markdown formatting.\n\
         - Be concise and informative.\n\n"
    );

    prompt.push_str("## Hunks\n\n");

    for hunk in hunks {
        let _ = writeln!(prompt, "### Hunk `{}` in `{}`", hunk.id, hunk.file_path);

        if let Some(labels) = hunk.label.as_deref() {
            if !labels.is_empty() {
                let _ = writeln!(prompt, "Labels: {}", labels.join(", "));
            }
        }

        let _ = writeln!(prompt, "\n```\n{}\n```\n", hunk.content);
    }

    prompt
}
