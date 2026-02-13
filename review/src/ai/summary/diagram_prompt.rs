use super::prompt::SummaryInput;
use std::collections::HashSet;
use std::fmt::Write;

/// Build a prompt for generating an Excalidraw JSON diagram from diff hunks.
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
         {file_count} files. Create an Excalidraw sketch that helps them visually understand \
         the shape of this change before diving into the code.\n\n\
         ## Goal\n\n\
         Think of this as a whiteboard sketch a senior engineer would draw to explain a change \
         to a colleague. It should communicate the *story* of the change — what moves where, \
         what's new, what connects to what — in a way that's immediately intuitive.\n\n\
         You have a freeform canvas. Don't default to a generic flowchart. Choose the layout \
         that best fits THIS change — stacked layers, a pipeline, grouped clusters with \
         boundary lines, a before/after split, radial spokes, annotated callouts, etc.\n\n\
         ## Output format\n\n\
         Output ONLY valid JSON (no fences, no explanation):\n\
         `{{\"type\": \"excalidraw\", \"version\": 2, \"elements\": [...]}}`\n\n\
         ## Excalidraw tips\n\n\
         Element types: `rectangle`, `text`, `arrow`, `ellipse`, `line`, `diamond`. \
         Every element needs a unique `id`.\n\n\
         **Bound text** (critical — do not use free-floating text):\n\
         - ALL text must be bound to a parent shape or arrow. Create a text element with \
           `\"containerId\": \"<parent-id>\"` and add `\"boundElements\": [{{\"id\": \"<text-id>\", \
           \"type\": \"text\"}}]` to the parent. Excalidraw auto-centers the text.\n\
         - Free-floating text (no `containerId`) gets mispositioned. The only exception is \
           a standalone title/heading far from any shapes.\n\
         - For group labels, bind the text to the group's boundary rectangle.\n\n\
         **Lines** are useful for borders, dividers, underlines, and grouping boundaries — \
         not just connections.\n\n\
         ## Visual style (dark background)\n\n\
         This renders on a **dark background** with NO dark-mode inversion. Every element \
         must have explicit light/bright colors — anything left as default will be black \
         and invisible.\n\n\
         **Color palette** (pick 2-3 per diagram to distinguish roles):\n\
         `\"#f59e0b\"` amber · `\"#06b6d4\"` cyan · `\"#10b981\"` emerald · \
         `\"#a78bfa\"` violet · `\"#f472b6\"` pink · `\"#fb923c\"` orange\n\n\
         **Color rules:**\n\
         - Text `strokeColor`: `\"#fafaf9\"` (white). Secondary annotations: `\"#d6d3d1\"`.\n\
         - Shape/arrow `strokeColor`: a palette color or `\"#d6d3d1\"` — never black.\n\
         - Shape fills: `\"transparent\"` or a dark tone (`\"#1c1917\"`, `\"#292524\"`) with \
           `fillStyle: \"solid\"`. No hachure/cross-hatch on shapes that contain text — \
           the pattern obscures labels. Hachure is fine on decorative shapes without text.\n\n\
         **Sketch feel:**\n\
         - `roughness: 2`, `strokeWidth: 1-2` for hand-drawn aesthetic.\n\
         - Larger text (`fontSize: 20-24`) for key concepts, smaller (`fontSize: 14`) for \
           annotations. Vary shape sizes for visual hierarchy.\n\
         - Add sketch details: underlines (short `line` elements), arrow labels, \
           dashed grouping boundaries (`strokeStyle: \"dashed\"`).\n\
         - Leave breathing room between elements.\n\n\
         ## Constraints\n\n\
         - At most {max_nodes} major shapes. Lines, labels, and annotations don't count.\n\
         - Use short, readable labels. Prefer logical names (\"API layer\", \"Store\") over \
           filenames when multiple files serve the same role.\n\
         - If a diagram wouldn't help, output the single word NONE.\n\n\
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
