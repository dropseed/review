use serde::Deserialize;
use std::fmt::Write;

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
pub fn build_grouping_prompt(
    hunks: &[GroupingInput],
    modified_symbols: &[ModifiedSymbolEntry],
) -> String {
    let mut prompt = String::new();

    let _ = write!(
        prompt,
        "You are a code-review assistant. Given a set of diff hunks from a code review, \
         group them by logical concern so a reviewer can understand the changes progressively.\n\n\
         ## Rules\n\n\
         - Group hunks by logical concern (not necessarily file order).\n\
         - Each group should be a reviewable unit.\n\
         - Include every hunk ID exactly once.\n\
         - Each group needs a short title and a one-sentence description.\n\
         - Use symbol information to group related changes across files \
           (e.g., a function definition and its call sites).\n\
         - For hunks in files without grammar support, check the glossary \
           to identify potential symbol references in the diff content.\n\
         - Assign each group a phase name. Phases tell a narrative — the reviewer reads Phase 1 first, then Phase 2, etc. \
           Common phase patterns: \"Setup\" (imports, dependencies, scaffolding), \"Core changes\" (main logic), \
           \"Integration\" (wiring, call sites), \"Tests\" (test updates), \"Cleanup\" (formatting, docs). \
           Use names that fit the actual changes — not every phase will apply.\n\
         - Order groups within each phase by dependency (if B uses something A introduces, A comes first).\n\
         - Output JSON only — an array of objects with keys: title, description, hunkIds, phase.\n\
         - Do NOT wrap the JSON in markdown code fences or any other text.\n\n"
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

        if let Some(labels) = hunk.label.as_deref() {
            if !labels.is_empty() {
                let _ = writeln!(prompt, "Labels: {}", labels.join(", "));
            }
        }

        if let Some(defs) = hunk.symbols.as_deref() {
            if !defs.is_empty() {
                let formatted: Vec<String> = defs.iter().map(format_symbol_def).collect();
                let _ = writeln!(prompt, "Defines: {}", formatted.join("; "));
            }
        }

        if let Some(refs) = hunk.references.as_deref() {
            if !refs.is_empty() {
                let names: Vec<&str> = refs.iter().map(|r| r.name.as_str()).collect();
                let _ = writeln!(prompt, "References: {}", names.join(", "));
            }
        }

        if hunk.has_grammar == Some(false) {
            prompt.push_str("[No grammar \u{2014} check glossary for symbol references]\n");
        }

        let _ = writeln!(prompt, "\n```\n{}\n```\n", hunk.content);
    }

    prompt
}
