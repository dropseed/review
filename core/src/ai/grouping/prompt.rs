use std::collections::{HashMap, HashSet};
use std::fmt::Write;
use std::path::PathBuf;

use serde::Deserialize;

/// How diff content is provided to the AI model.
pub enum DiffContentMode {
    /// Diff content is inlined directly in the prompt (faster, no tool use needed).
    Inline,
    /// Diff content is written to temp files; the model uses the Read tool.
    TempFiles(HashMap<String, PathBuf>),
}

/// Maximum lines per hunk when inlining diff content.
const INLINE_MAX_LINES_PER_HUNK: usize = 300;

/// Input for grouping generation — one per hunk.
#[derive(Debug, Clone, Deserialize)]
pub struct GroupingInput {
    pub id: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
    pub content: String,
    #[serde(default)]
    pub label: Option<Vec<String>>,
    /// Symbols this hunk defines or modifies.
    #[serde(default)]
    pub symbols: Option<Vec<HunkSymbolDef>>,
    /// Modified symbols this hunk references (call sites, usages).
    #[serde(default)]
    pub references: Option<Vec<HunkSymbolRef>>,
    /// Whether tree-sitter could parse this file.
    #[serde(default, rename = "hasGrammar")]
    pub has_grammar: Option<bool>,
}

/// A symbol definition/modification within a hunk.
#[derive(Debug, Clone, Deserialize)]
pub struct HunkSymbolDef {
    pub name: String,
    pub kind: Option<String>,
    #[serde(rename = "changeType")]
    pub change_type: String,
}

/// A reference to a modified symbol within a hunk.
#[derive(Debug, Clone, Deserialize)]
pub struct HunkSymbolRef {
    pub name: String,
}

/// A modified symbol entry for the global glossary.
#[derive(Debug, Clone, Deserialize)]
pub struct ModifiedSymbolEntry {
    pub name: String,
    pub kind: Option<String>,
    #[serde(rename = "changeType")]
    pub change_type: String,
    #[serde(rename = "filePath")]
    pub file_path: String,
}

/// Format a symbol definition as "name (kind, changeType)" or "name (changeType)".
fn format_symbol_def(def: &HunkSymbolDef) -> String {
    match def.kind.as_deref() {
        Some(kind) => format!("{} ({}, {})", def.name, kind, def.change_type),
        None => format!("{} ({})", def.name, def.change_type),
    }
}

/// Build the prompt sent to Claude for hunk grouping.
///
/// In `Inline` mode, hunk diff content is embedded directly in the prompt
/// (faster, no tool round-trips). In `TempFiles` mode, each hunk's content is
/// written to a temp file and the model is given the Read tool to inspect them.
pub fn build_grouping_prompt(
    hunks: &[GroupingInput],
    modified_symbols: &[ModifiedSymbolEntry],
    content_mode: &DiffContentMode,
) -> String {
    let mut prompt = String::new();

    let read_tool_instruction = match content_mode {
        DiffContentMode::TempFiles(_) => {
            "\n- Each hunk's diff content is in a file listed below. Use the Read tool to \
           inspect hunks when the metadata (labels, symbols, file path) is not enough \
           to decide how to group them. You do NOT need to read every hunk.\n"
        }
        DiffContentMode::Inline => "",
    };

    let _ = write!(
        prompt,
        "You are a code-review assistant. Given a set of diff hunks from a code review, \
         group them by logical concern so a reviewer can understand the changes progressively.\n\n\
         ## Rules\n\n\
         - Group hunks by logical concern (not necessarily file order).\n\
         - Each group should be a reviewable unit.\n\
         - Prefer groups of 2\u{2013}5 hunks. A single-hunk group is acceptable only when \
           a change is truly independent and unrelated to all other hunks. \
           If in doubt, merge small groups together.\n\
         - Multiple hunks in the same file that contribute to the same feature or \
           concern should typically be grouped together, not split across groups.\n\
         - Even without symbol data, examine the diff content to identify shared names, \
           patterns, or types across hunks (e.g., a method defined in one hunk and \
           called in another). Group definition + usage together.\n\
         - Use symbol information to group related changes across files \
           (e.g., a function definition and its call sites).\n\
         - For hunks in files without grammar support, check the glossary \
           to identify potential symbol references in the diff content.\n\
         - Include every hunk ID exactly once.\n\
         - Each group needs a short title. Optionally include a one-sentence description.\n\
         - Assign each group a `phase` name identifying the broader feature or topic \
           it belongs to (e.g., \"Authentication\", \"API client\", \"Database schema\"). \
           Use phases to show which groups are interconnected. \
           Unrelated groups should have different phases.\n\
         - Groups sharing a phase must be adjacent in the output array.\n\
         - Order groups so a reviewer reads foundational changes first, then dependent changes.\n\
         - Output JSON only — an array of objects with keys: title, hunkIds, phase, and optionally description.\n\
         - Do NOT wrap the JSON in markdown code fences or any other text.\n\
         - Output the JSON array with one group object per line for readability. \
           Begin outputting groups as soon as you've decided their contents.\n\
         {read_tool_instruction}\n"
    );

    let file_count = hunks
        .iter()
        .map(|h| h.file_path.as_str())
        .collect::<HashSet<_>>()
        .len();
    let _ = writeln!(
        prompt,
        "## Summary\n\nThis diff contains {} hunks across {} files.\n",
        hunks.len(),
        file_count
    );

    if !modified_symbols.is_empty() {
        let _ = write!(
            prompt,
            "## Modified Symbols\n\n\
             Symbols changed in this diff. Use to detect cross-file connections.\n\n\
             | Symbol | Kind | Change | File |\n\
             |--------|------|--------|------|\n"
        );
        for entry in modified_symbols {
            let kind = entry.kind.as_deref().unwrap_or("\u{2014}");
            let _ = writeln!(
                prompt,
                "| {} | {} | {} | {} |",
                entry.name, kind, entry.change_type, entry.file_path
            );
        }
        prompt.push('\n');
    }

    prompt.push_str("## Hunks\n\n");

    for hunk in hunks {
        let _ = writeln!(prompt, "### Hunk `{}` in `{}`", hunk.id, hunk.file_path);

        if let Some(labels) = hunk.label.as_deref().filter(|l| !l.is_empty()) {
            let _ = writeln!(prompt, "Labels: {}", labels.join(", "));
        }

        if let Some(defs) = hunk.symbols.as_deref().filter(|d| !d.is_empty()) {
            let formatted: Vec<String> = defs.iter().map(format_symbol_def).collect();
            let _ = writeln!(prompt, "Defines: {}", formatted.join("; "));
        }

        if let Some(refs) = hunk.references.as_deref().filter(|r| !r.is_empty()) {
            let names: Vec<&str> = refs.iter().map(|r| r.name.as_str()).collect();
            let _ = writeln!(prompt, "References: {}", names.join(", "));
        }

        if hunk.has_grammar == Some(false) {
            let hint = if modified_symbols.is_empty() {
                "[No grammar \u{2014} scan diff content for cross-hunk symbol relationships]\n"
            } else {
                "[No grammar \u{2014} check glossary for symbol references]\n"
            };
            prompt.push_str(hint);
        }

        match content_mode {
            DiffContentMode::Inline => {
                let lines: Vec<&str> = hunk.content.lines().collect();
                let total = lines.len();
                let truncated = total > INLINE_MAX_LINES_PER_HUNK;
                let display_lines = if truncated {
                    &lines[..INLINE_MAX_LINES_PER_HUNK]
                } else {
                    &lines[..]
                };
                prompt.push_str("```diff\n");
                for line in display_lines {
                    let _ = writeln!(prompt, "{}", line);
                }
                if truncated {
                    let _ = writeln!(
                        prompt,
                        "[...truncated, {} more lines]",
                        total - INLINE_MAX_LINES_PER_HUNK
                    );
                }
                prompt.push_str("```\n");
            }
            DiffContentMode::TempFiles(paths) => {
                if let Some(path) = paths.get(&hunk.id) {
                    let _ = writeln!(prompt, "Diff content: `{}`", path.display());
                }
            }
        }
        prompt.push('\n');
    }

    prompt
}
