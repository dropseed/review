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
    let mut prompt = String::from(
        "You are a code-review assistant. Given a set of diff hunks from a code review, \
         write a short bullet-point summary of what this diff does.\n\n\
         ## Rules\n\n\
         - Use 3-5 markdown bullet points, one key change per bullet.\n\
         - Each bullet must be ONE short sentence (under 15 words). No compound sentences.\n\
         - Start each bullet with a bold key phrase, then a short description.\n\
         - Focus on what changed and why, not listing every file.\n\
         - Output markdown only — no JSON, no wrapping fences.\n\n\
         ## Hunks\n\n",
    );

    for hunk in hunks {
        let _ = writeln!(prompt, "### Hunk `{}` in `{}`", hunk.id, hunk.file_path);

        if let Some(labels) = hunk.label.as_deref().filter(|l| !l.is_empty()) {
            let _ = writeln!(prompt, "Labels: {}", labels.join(", "));
        }

        let _ = writeln!(prompt, "\n```\n{}\n```\n", hunk.content);
    }

    prompt
}
