use super::prompt::SummaryInput;
use std::collections::HashSet;
use std::fmt::Write;

/// Build a prompt for generating a semantic JSON diagram from diff hunks.
///
/// Returns `None` if fewer than 2 distinct files are changed (single-file diffs
/// don't need a diagram).
pub fn build_diagram_prompt(hunks: &[SummaryInput]) -> Option<String> {
    let distinct_files: HashSet<&str> = hunks.iter().map(|h| h.file_path.as_str()).collect();
    let file_count = distinct_files.len();
    if file_count < 2 {
        return None;
    }

    // Scale diagram complexity to the size of the change.
    let max_nodes = match file_count {
        2..=4 => file_count,
        5..=8 => 5,
        9..=15 => 6,
        _ => 7,
    };

    let mut prompt = String::new();

    let _ = write!(
        prompt,
        "You are a code-review assistant. A reviewer is about to look at a diff that touches \
         {file_count} files. Create a structured diagram that helps them visually understand \
         the shape of this change before diving into the code.\n\n\
         ## Goal\n\n\
         Think of this as a whiteboard sketch a senior engineer would draw to explain a change \
         to a colleague — what moves where, what's new, what connects to what.\n\n\
         ## Output format\n\n\
         Output ONLY valid JSON (no fences, no explanation) matching this schema:\n\
         ```\n\
         {{\n\
           \"nodes\": [\n\
             {{ \"id\": \"n1\", \"label\": \"Short Name\", \"files\": [\"src/foo.ts\"], \"role\": \"modified\" }}\n\
           ],\n\
           \"edges\": [\n\
             {{ \"from\": \"n1\", \"to\": \"n2\", \"label\": \"calls\" }}\n\
           ]\n\
         }}\n\
         ```\n\n\
         ## Rules\n\n\
         - `role` must be one of: `\"new\"`, `\"modified\"`, `\"deleted\"`, `\"unchanged\"`\n\
         - Every changed file must appear in exactly one node's `files` array\n\
         - Use short, readable labels — prefer logical names (\"API layer\", \"Store\") over \
           raw filenames when multiple files serve the same role\n\
         - At most {max_nodes} nodes\n\
         - Edges are optional — only include them when there is a meaningful relationship\n\
         - If a diagram would not be helpful, output the single word NONE\n\n\
         ## Changed files\n\n"
    );

    for file in &distinct_files {
        let _ = writeln!(prompt, "- `{file}`");
    }
    let _ = writeln!(prompt);

    prompt.push_str("## Hunks\n\n");

    for hunk in hunks {
        let _ = writeln!(prompt, "### `{}` in `{}`", hunk.id, hunk.file_path);

        if let Some(labels) = hunk.label.as_deref().filter(|l| !l.is_empty()) {
            let _ = writeln!(prompt, "Labels: {}", labels.join(", "));
        }

        let _ = writeln!(prompt, "\n```\n{}\n```\n", hunk.content);
    }

    Some(prompt)
}
