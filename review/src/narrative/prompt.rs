use serde::Deserialize;

/// Input for narrative generation — one per hunk.
#[derive(Debug, Clone, Deserialize)]
pub struct NarrativeInput {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
}

/// Build the prompt sent to Claude for narrative generation.
pub fn build_narrative_prompt(hunks: &[NarrativeInput]) -> String {
    let mut prompt = String::new();

    prompt.push_str(
        "You are a code-change narrator. Given a set of diff hunks from a code review, \
         write a concise markdown walkthrough that helps a reviewer understand the changes \
         in a logical reading order.\n\n",
    );

    prompt.push_str("## Rules\n\n");
    prompt.push_str("- Start with a 2-3 sentence summary of the overall change.\n");
    prompt.push_str(
        "- Then walk through the changes grouped by logical concern (not necessarily file order).\n",
    );
    prompt.push_str("- Use markdown headings, bullet points, and code references.\n");
    prompt.push_str(
        "- Link to specific hunks like this: [description](review://path/to/file.ts?hunk=HUNK_ID)\n",
    );
    prompt.push_str(
        "- ALWAYS prefer hunk-specific links over bare file links. When you mention a specific change, \
         link to the exact hunk that contains it. Multiple links to the same file should point to \
         different hunks so the reader jumps to the right place.\n",
    );
    prompt.push_str(
        "- You can also link to a specific line: [description](review://path/to/file.ts?line=42) \
         Use this when referring to a particular line number visible in the diff.\n",
    );
    prompt.push_str(
        "- Only use a bare file link [file](review://path/to/file.ts) when referring to the file \
         as a whole, not a specific change within it.\n",
    );
    prompt.push_str(
        "- Use the actual filename as the link text sometimes (e.g. [`utils.ts`](review://src/utils.ts?hunk=HUNK_ID)) \
         to help the reviewer become familiar with the file names in the change.\n",
    );
    prompt.push_str("- Do NOT judge code quality or suggest improvements.\n");
    prompt.push_str("- Do NOT include a title/heading at the very top — the UI provides one.\n");
    prompt.push_str(
        "- Only describe and guide the reader through what changed and why it matters.\n",
    );
    prompt
        .push_str("- Keep it concise — aim for a quick orientation, not an exhaustive catalog.\n");
    prompt.push_str(
        "- The diff may contain multiple independent, unrelated changes (e.g. a feature and a \
         separate refactor). If so, split them into separate sections with their own headings \
         rather than forcing a single unified narrative.\n",
    );
    prompt.push_str("- Output raw markdown only. No JSON wrapper, no code fences around the whole response.\n\n");

    prompt.push_str("## Hunks\n\n");

    for hunk in hunks {
        prompt.push_str(&format!(
            "### Hunk `{}` in `{}`\n\n```\n{}\n```\n\n",
            hunk.id, hunk.file_path, hunk.content
        ));
    }

    prompt
}
