use super::prompt::SummaryInput;
use std::collections::HashSet;
use std::fmt::Write;

/// Build a prompt for generating a Mermaid dependency diagram from diff hunks.
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
         {file_count} files. Create a small Mermaid diagram that helps them visually understand \
         the shape of this change before diving into the code.\n\n\
         ## Goal\n\n\
         Give the reviewer an instant visual sense of what this change does. The diagram should \
         be something they glance at for a few seconds and think \"ah, got it.\" Use whatever \
         diagram style (flowchart, sequence, etc.) and structure best communicates THIS particular \
         change — there's no single right format.\n\n\
         ## Constraints\n\n\
         - Output ONLY raw Mermaid code — no fences, no explanation.\n\
         - Keep it small: at most {max_nodes} nodes. Fewer is better.\n\
         - Use short, readable labels. Prefer logical names (\"API layer\", \"Store\") over filenames \
           when multiple files serve the same role.\n\
         - Use basic Mermaid syntax. Node IDs must be simple alphanumeric with display labels: \
           `nodeId[\"Display Name\"]`.\n\
         - If a diagram wouldn't add anything useful beyond what a text summary says, \
           output the single word NONE.\n\n\
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
