//! Static hunk classifier that runs before AI classification.
//!
//! Detects easily-identifiable patterns (lockfiles, whitespace-only changes,
//! comment additions, import additions, etc.) so those hunks skip the AI call.
//! All rules are conservative: if uncertain, return `None` and let AI handle it.

use crate::classify::claude::{ClassificationResult, ClassifyResponse};
use crate::diff::parser::{DiffHunk, DiffLine, LineType};
use std::collections::HashMap;

/// Classify hunks using static pattern matching (no I/O, no AI).
///
/// Returns a `ClassifyResponse` containing only the hunks that were
/// confidently classified. Unclassified hunks are omitted.
/// Also populates `skipped_hunk_ids` for hunks that heuristics determine
/// are very unlikely to match any taxonomy label (saves AI tokens).
pub fn classify_hunks_static(hunks: &[DiffHunk]) -> ClassifyResponse {
    let mut classifications = HashMap::new();
    let mut skipped_hunk_ids = Vec::new();

    for hunk in hunks {
        if let Some(result) = classify_single_hunk(hunk) {
            classifications.insert(hunk.id.clone(), result);
        } else if should_skip_ai(hunk).is_some() {
            skipped_hunk_ids.push(hunk.id.clone());
        }
    }

    ClassifyResponse {
        classifications,
        skipped_hunk_ids,
    }
}

/// Attempt to classify a single hunk. Returns `None` if no rule matches.
fn classify_single_hunk(hunk: &DiffHunk) -> Option<ClassificationResult> {
    // Priority order: cheapest checks first
    classify_lockfile(hunk)
        .or_else(|| classify_whitespace(hunk))
        .or_else(|| classify_comments(hunk))
        .or_else(|| classify_imports(hunk))
}

// --- Rule 1: Lockfile detection (path-based) ---

const LOCKFILE_NAMES: &[&str] = &[
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "Gemfile.lock",
    "poetry.lock",
    "go.sum",
    "go.mod",
    "composer.lock",
    "Pipfile.lock",
    "bun.lockb",
    "bun.lock",
    "flake.lock",
    "packages.lock.json",
    "paket.lock",
    "pdm.lock",
    "uv.lock",
];

fn classify_lockfile(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let filename = hunk.file_path.rsplit('/').next().unwrap_or(&hunk.file_path);
    if LOCKFILE_NAMES.iter().any(|&name| filename == name) {
        Some(ClassificationResult {
            label: vec!["generated:lockfile".to_owned()],
            reasoning: "File is a package manager lockfile".to_owned(),
        })
    } else {
        None
    }
}

// --- Rule 2: Whitespace-only changes ---

fn classify_whitespace(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    let all_whitespace = changed_lines
        .iter()
        .all(|line| line.content.trim().is_empty());

    if all_whitespace {
        Some(ClassificationResult {
            label: vec!["formatting:whitespace".to_owned()],
            reasoning: "All changed lines are empty or whitespace-only".to_owned(),
        })
    } else {
        None
    }
}

// --- Rule 3: Comment-only changes ---

/// Maps file extension to line-comment prefixes.
fn comment_prefixes(ext: &str) -> Option<&'static [&'static str]> {
    match ext {
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "mts" | "cjs" | "cts" | "rs" | "go" | "java"
        | "kt" | "kts" | "scala" | "swift" | "c" | "cc" | "cpp" | "cxx" | "h" | "hpp" | "cs"
        | "m" | "mm" | "zig" | "v" | "dart" | "groovy" | "gradle" => Some(&["//"]),
        "py" | "rb" | "sh" | "bash" | "zsh" | "fish" | "yml" | "yaml" | "toml" | "pl" | "pm"
        | "r" | "jl" | "ex" | "exs" | "cr" | "nim" | "coffee" | "mk" | "cmake" | "tf" | "hcl" => {
            Some(&["#"])
        }
        "lua" | "hs" | "sql" => Some(&["--"]),
        "lisp" | "clj" | "cljs" | "cljc" | "edn" | "scm" | "rkt" => Some(&[";"]),
        "erl" | "hrl" => Some(&["%"]),
        _ => None,
    }
}

fn is_comment_line(content: &str, prefixes: &[&str]) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return true; // Blank lines between comments are fine
    }
    prefixes.iter().any(|prefix| trimmed.starts_with(prefix))
}

fn classify_comments(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let ext = hunk.file_path.rsplit('.').next()?;
    let prefixes = comment_prefixes(ext)?;

    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    let all_comments = changed_lines
        .iter()
        .all(|line| is_comment_line(&line.content, prefixes));

    if !all_comments {
        return None;
    }

    let has_added = changed_lines.iter().any(|l| l.line_type == LineType::Added);
    let has_removed = changed_lines
        .iter()
        .any(|l| l.line_type == LineType::Removed);

    let label = match (has_added, has_removed) {
        (true, false) => "comments:added",
        (false, true) => "comments:removed",
        (true, true) => "comments:modified",
        (false, false) => return None,
    };

    Some(ClassificationResult {
        label: vec![label.to_owned()],
        reasoning: "All changed lines are comments".to_owned(),
    })
}

// --- Rule 4: Import-only changes ---

/// Returns (prefixes, bracket_char) for import multi-line handling.
/// bracket_char is '\0' for languages that don't support multi-line imports.
fn import_config(ext: &str) -> Option<(&'static [&'static str], char)> {
    match ext {
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "mts" | "cjs" | "cts" => {
            Some((&["import ", "import{", "export { ", "export {"], '{'))
        }
        "py" => Some((&["import ", "from "], '(')),
        "go" => Some((&["import "], '(')),
        "rs" => Some((&["use "], '{')),
        // Languages that use simple single-line detection only
        "java" | "kt" | "kts" | "scala" | "groovy" | "gradle" => Some((&["import "], '\0')),
        "c" | "cc" | "cpp" | "cxx" | "h" | "hpp" | "m" | "mm" => Some((&["#include"], '\0')),
        "rb" => Some((&["require ", "require_relative "], '\0')),
        "cs" => Some((&["using "], '\0')),
        "swift" | "dart" => Some((&["import "], '\0')),
        _ => None,
    }
}

/// Legacy function for simple single-line import check.
fn is_import_line(content: &str, prefixes: &[&str]) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return true; // Blank lines between imports are fine
    }
    prefixes.iter().any(|prefix| trimmed.starts_with(prefix))
}

/// Check if all changed lines are import statements (including multi-line).
fn are_all_import_lines(lines: &[&DiffLine], prefixes: &[&str], bracket: char) -> bool {
    // For languages without multi-line support, use simple check
    if bracket == '\0' {
        return lines
            .iter()
            .all(|line| is_import_line(&line.content, prefixes));
    }

    let mut depth = 0i32;

    for line in lines {
        let trimmed = line.content.trim();

        // Empty lines are OK between imports
        if trimmed.is_empty() {
            continue;
        }

        let starts_import = prefixes.iter().any(|p| trimmed.starts_with(p));

        if starts_import {
            // New import statement - track brackets
            depth += count_char(trimmed, bracket);
            depth -= count_char(trimmed, closing_bracket(bracket));
        } else if depth > 0 {
            // Inside multi-line import - validate continuation
            if !is_import_continuation(trimmed, bracket) {
                return false;
            }
            depth += count_char(trimmed, bracket);
            depth -= count_char(trimmed, closing_bracket(bracket));
        } else {
            // Not an import and not in multi-line context
            return false;
        }
    }

    true
}

fn closing_bracket(open: char) -> char {
    match open {
        '(' => ')',
        '{' => '}',
        _ => '\0',
    }
}

fn count_char(s: &str, c: char) -> i32 {
    s.chars().filter(|&ch| ch == c).count() as i32
}

/// Validate that a line looks like an import continuation.
/// Accepts: closing brackets (with optional semicolon/comma), "} from" patterns,
/// identifiers, and quoted strings (for Go imports).
fn is_import_continuation(trimmed: &str, bracket: char) -> bool {
    let close = closing_bracket(bracket);

    // Closing bracket alone or with semicolon/comma (e.g., "}", "};", "},")
    if trimmed == format!("{close}")
        || trimmed == format!("{close};")
        || trimmed == format!("{close},")
    {
        return true;
    }

    // Destructured import endings: "} from '...'" or ") from '...'"
    if trimmed.starts_with("} from ")
        || trimmed.starts_with("}from ")
        || trimmed.starts_with(") from ")
        || trimmed.starts_with(")from ")
    {
        return true;
    }

    // Identifier or quoted string (letter, underscore, or quote)
    matches!(
        trimmed.chars().next(),
        Some('a'..='z' | 'A'..='Z' | '_' | '"' | '\'')
    )
}

fn classify_imports(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let ext = hunk.file_path.rsplit('.').next()?;
    let (prefixes, bracket) = import_config(ext)?;

    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    if !are_all_import_lines(&changed_lines, prefixes, bracket) {
        return None;
    }

    let has_added = changed_lines.iter().any(|l| l.line_type == LineType::Added);
    let has_removed = changed_lines
        .iter()
        .any(|l| l.line_type == LineType::Removed);

    match (has_added, has_removed) {
        (true, false) => Some(ClassificationResult {
            label: vec!["imports:added".to_owned()],
            reasoning: "All changed lines are import statements (additions only)".to_owned(),
        }),
        (false, true) => Some(ClassificationResult {
            label: vec!["imports:removed".to_owned()],
            reasoning: "All changed lines are import statements (removals only)".to_owned(),
        }),
        (true, true) => {
            // Check if it's a reorder: same imports, different order
            if is_import_reorder(&changed_lines, prefixes) {
                Some(ClassificationResult {
                    label: vec!["imports:reordered".to_owned()],
                    reasoning: "Import statements were reordered (same set of imports)".to_owned(),
                })
            } else {
                Some(ClassificationResult {
                    label: vec!["imports:modified".to_owned()],
                    reasoning: "All changed lines are import statements (modified)".to_owned(),
                })
            }
        }
        (false, false) => None,
    }
}

/// Check if the added and removed import lines represent a reorder
/// (same set of normalized imports in different order).
fn is_import_reorder(changed_lines: &[&DiffLine], prefixes: &[&str]) -> bool {
    let mut added: Vec<String> = changed_lines
        .iter()
        .filter(|l| l.line_type == LineType::Added)
        .filter(|l| {
            let trimmed = l.content.trim();
            !trimmed.is_empty() && prefixes.iter().any(|p| trimmed.starts_with(p))
        })
        .map(|l| normalize_import(&l.content))
        .collect();

    let mut removed: Vec<String> = changed_lines
        .iter()
        .filter(|l| l.line_type == LineType::Removed)
        .filter(|l| {
            let trimmed = l.content.trim();
            !trimmed.is_empty() && prefixes.iter().any(|p| trimmed.starts_with(p))
        })
        .map(|l| normalize_import(&l.content))
        .collect();

    if added.is_empty() || removed.is_empty() {
        return false;
    }

    added.sort();
    removed.sort();
    added == removed
}

/// Normalize an import line for comparison (trim, collapse whitespace).
fn normalize_import(line: &str) -> String {
    line.split_whitespace().collect::<Vec<_>>().join(" ")
}

// --- Rule 5: Pre-AI skip heuristics ---

/// Maximum number of changed lines (added + removed) before we skip AI.
/// Hunks larger than this are very unlikely to match a single taxonomy label
/// since every label requires the ENTIRE hunk to be one type of trivial change.
const MAX_CHANGED_LINES_FOR_AI: usize = 50;

/// Check if a hunk should be skipped for AI classification.
/// Returns a reason string if the hunk should be skipped, `None` otherwise.
///
/// These are hunks that are very unlikely to match any taxonomy label,
/// so sending them to the AI would just waste tokens.
pub fn should_skip_ai(hunk: &DiffHunk) -> Option<&'static str> {
    // 1. Too many changed lines — unlikely to be entirely one trivial pattern
    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.len() > MAX_CHANGED_LINES_FOR_AI {
        return Some("too many changed lines for single-label match");
    }

    // 2. Generated/minified files (beyond lockfiles, which are caught by classify_lockfile)
    if is_generated_file(&hunk.file_path) {
        return Some("generated or minified file");
    }

    // 3. Pure deletion hunks (only removed lines, no additions).
    //    No AI-classified taxonomy label applies to pure deletions.
    //    (imports:removed and comments:removed are already handled by the static classifier.)
    let has_added = changed_lines.iter().any(|l| l.line_type == LineType::Added);
    let has_removed = changed_lines
        .iter()
        .any(|l| l.line_type == LineType::Removed);
    if has_removed && !has_added {
        return Some("pure deletion — no matching AI taxonomy label");
    }

    None
}

/// Check if a file path looks like a generated/minified file that
/// should skip AI classification.
fn is_generated_file(file_path: &str) -> bool {
    let lower = file_path.to_lowercase();

    // Minified bundles
    if lower.ends_with(".min.js") || lower.ends_with(".min.css") || lower.ends_with(".min.mjs") {
        return true;
    }

    // Source maps
    if lower.ends_with(".js.map")
        || lower.ends_with(".css.map")
        || lower.ends_with(".mjs.map")
        || lower.ends_with(".ts.map")
    {
        return true;
    }

    // Protobuf generated
    if lower.ends_with(".pb.go")
        || lower.ends_with(".pb.cc")
        || lower.ends_with(".pb.h")
        || lower.ends_with(".pb.rs")
    {
        return true;
    }

    false
}

// --- Helpers ---

fn get_changed_lines(lines: &[DiffLine]) -> Vec<&DiffLine> {
    lines
        .iter()
        .filter(|l| l.line_type == LineType::Added || l.line_type == LineType::Removed)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_hunk(file_path: &str, lines: Vec<DiffLine>) -> DiffHunk {
        DiffHunk {
            id: format!("{}:testhash", file_path),
            file_path: file_path.to_owned(),
            old_start: 1,
            old_count: 0,
            new_start: 1,
            new_count: 0,
            content: String::new(),
            lines,
            content_hash: "testhash".to_owned(),
            move_pair_id: None,
        }
    }

    fn added(content: &str) -> DiffLine {
        DiffLine {
            line_type: LineType::Added,
            content: content.to_owned(),
            old_line_number: None,
            new_line_number: Some(1),
        }
    }

    fn removed(content: &str) -> DiffLine {
        DiffLine {
            line_type: LineType::Removed,
            content: content.to_owned(),
            old_line_number: Some(1),
            new_line_number: None,
        }
    }

    fn context(content: &str) -> DiffLine {
        DiffLine {
            line_type: LineType::Context,
            content: content.to_owned(),
            old_line_number: Some(1),
            new_line_number: Some(1),
        }
    }

    // --- Lockfile tests ---

    #[test]
    fn test_lockfile_package_lock() {
        let hunk = make_hunk("package-lock.json", vec![added("{}")]);
        let result = classify_single_hunk(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["generated:lockfile"]);
    }

    #[test]
    fn test_lockfile_nested_path() {
        let hunk = make_hunk("some/path/yarn.lock", vec![added("resolved")]);
        let result = classify_single_hunk(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["generated:lockfile"]);
    }

    #[test]
    fn test_lockfile_cargo_lock() {
        let hunk = make_hunk("Cargo.lock", vec![added("[[package]]")]);
        let result = classify_single_hunk(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["generated:lockfile"]);
    }

    #[test]
    fn test_not_lockfile() {
        let hunk = make_hunk("src/main.rs", vec![added("fn main() {}")]);
        let result = classify_lockfile(&hunk);
        assert!(result.is_none());
    }

    // --- Whitespace tests ---

    #[test]
    fn test_whitespace_only_blank_lines() {
        let hunk = make_hunk("src/main.rs", vec![added(""), added("   "), removed("  ")]);
        let result = classify_whitespace(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["formatting:whitespace"]);
    }

    #[test]
    fn test_whitespace_with_content() {
        let hunk = make_hunk("src/main.rs", vec![added(""), added("let x = 1;")]);
        let result = classify_whitespace(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_whitespace_context_lines_ignored() {
        let hunk = make_hunk(
            "src/main.rs",
            vec![context("let x = 1;"), added("  "), added("")],
        );
        let result = classify_whitespace(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["formatting:whitespace"]);
    }

    // --- Comment tests ---

    #[test]
    fn test_comment_added_rust() {
        let hunk = make_hunk(
            "src/main.rs",
            vec![added("// This is a comment"), added("// Another comment")],
        );
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:added"]);
    }

    #[test]
    fn test_comment_removed_python() {
        let hunk = make_hunk(
            "script.py",
            vec![removed("# Old comment"), removed("# Another old")],
        );
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:removed"]);
    }

    #[test]
    fn test_comment_modified_js() {
        let hunk = make_hunk(
            "app.js",
            vec![removed("// Old comment"), added("// New comment")],
        );
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:modified"]);
    }

    #[test]
    fn test_comment_mixed_with_code() {
        let hunk = make_hunk("app.js", vec![added("// Comment"), added("const x = 1;")]);
        let result = classify_comments(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_comment_unknown_extension() {
        let hunk = make_hunk("file.xyz", vec![added("// Comment")]);
        let result = classify_comments(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_comment_yaml() {
        let hunk = make_hunk("config.yml", vec![added("# Added config comment")]);
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:added"]);
    }

    // --- Import tests ---

    #[test]
    fn test_import_added_ts() {
        let hunk = make_hunk("src/app.ts", vec![added("import { Foo } from './foo';")]);
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:added"]);
    }

    #[test]
    fn test_import_removed_python() {
        let hunk = make_hunk(
            "main.py",
            vec![removed("import os"), removed("from sys import argv")],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:removed"]);
    }

    #[test]
    fn test_import_reorder_js() {
        let hunk = make_hunk(
            "index.js",
            vec![
                removed("import { b } from './b';"),
                removed("import { a } from './a';"),
                added("import { a } from './a';"),
                added("import { b } from './b';"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:reordered"]);
    }

    #[test]
    fn test_import_different_imports_modified() {
        let hunk = make_hunk(
            "index.js",
            vec![
                removed("import { a } from './a';"),
                added("import { b } from './b';"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:modified"]);
    }

    #[test]
    fn test_import_modified_expanded() {
        let hunk = make_hunk(
            "src/main.tsx",
            vec![
                removed("import React from \"react\";"),
                added("import React, { useEffect } from \"react\";"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:modified"]);
    }

    #[test]
    fn test_import_rust_use() {
        let hunk = make_hunk("src/lib.rs", vec![added("use std::collections::HashMap;")]);
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:added"]);
    }

    #[test]
    fn test_import_c_include() {
        let hunk = make_hunk("main.c", vec![added("#include <stdio.h>")]);
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:added"]);
    }

    #[test]
    fn test_import_mixed_with_code() {
        let hunk = make_hunk(
            "app.ts",
            vec![
                added("import { Foo } from './foo';"),
                added("const x = new Foo();"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_none());
    }

    // --- Multi-line import tests ---

    #[test]
    fn test_import_python_multiline() {
        let hunk = make_hunk(
            "main.py",
            vec![
                added("from plain.models import ("),
                added("    query_utils,"),
                added("    sql,"),
                added(")"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:added"]);
    }

    #[test]
    fn test_import_ts_multiline() {
        let hunk = make_hunk(
            "app.tsx",
            vec![
                added("import {"),
                added("  useState,"),
                added("  useEffect,"),
                added("} from \"react\";"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:added"]);
    }

    #[test]
    fn test_import_rust_multiline() {
        let hunk = make_hunk(
            "lib.rs",
            vec![
                added("use std::collections::{"),
                added("    HashMap,"),
                added("    HashSet,"),
                added("};"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:added"]);
    }

    #[test]
    fn test_import_python_multiline_modified() {
        // User's exact case: multi-line reformatted to single-line
        let hunk = make_hunk(
            "main.py",
            vec![
                removed("from plain.models import ("),
                removed("    query_utils,"),
                removed("    sql,"),
                removed("    transaction,"),
                removed(")"),
                added("from plain.models import query_utils, transaction"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:modified"]);
    }

    #[test]
    fn test_import_go_multiline() {
        let hunk = make_hunk(
            "main.go",
            vec![
                added("import ("),
                added("    \"fmt\""),
                added("    \"os\""),
                added(")"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["imports:added"]);
    }

    #[test]
    fn test_import_multiline_not_mixed_with_code() {
        // Multi-line import followed by code should NOT match
        let hunk = make_hunk(
            "main.py",
            vec![
                added("from os import ("),
                added("    path,"),
                added(")"),
                added("x = path.join('a', 'b')"),
            ],
        );
        let result = classify_imports(&hunk);
        assert!(result.is_none());
    }

    // --- Integration: classify_hunks_static ---

    #[test]
    fn test_static_classify_multiple_hunks() {
        let hunks = vec![
            make_hunk("package-lock.json", vec![added("{}")]),
            make_hunk("src/main.rs", vec![added("fn main() {}")]),
            make_hunk("src/lib.rs", vec![added("use std::io;")]),
        ];

        let response = classify_hunks_static(&hunks);

        // lockfile and import should be classified, main.rs code should not
        assert_eq!(response.classifications.len(), 2);
        assert!(response
            .classifications
            .contains_key("package-lock.json:testhash"));
        assert!(response.classifications.contains_key("src/lib.rs:testhash"));
        assert!(!response
            .classifications
            .contains_key("src/main.rs:testhash"));
    }

    #[test]
    fn test_static_classify_empty() {
        let response = classify_hunks_static(&[]);
        assert!(response.classifications.is_empty());
    }

    #[test]
    fn test_no_changed_lines() {
        let hunk = make_hunk("src/main.rs", vec![context("let x = 1;")]);
        let result = classify_single_hunk(&hunk);
        assert!(result.is_none());
    }

    // --- Priority: lockfile wins over other rules ---

    #[test]
    fn test_lockfile_takes_priority_over_comments() {
        // A lockfile with comment-like lines should still be classified as lockfile
        let hunk = make_hunk("Cargo.lock", vec![added("# This is version info")]);
        let result = classify_single_hunk(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["generated:lockfile"]);
    }

    // --- should_skip_ai tests ---

    #[test]
    fn test_skip_ai_too_many_changed_lines() {
        let mut lines = Vec::new();
        for i in 0..60 {
            lines.push(added(&format!("line {i}")));
        }
        let hunk = make_hunk("src/big_file.rs", lines);
        assert!(should_skip_ai(&hunk).is_some());
    }

    #[test]
    fn test_skip_ai_small_hunk_not_skipped() {
        let hunk = make_hunk(
            "src/main.rs",
            vec![added("let x = 1;"), added("let y = 2;")],
        );
        assert!(should_skip_ai(&hunk).is_none());
    }

    #[test]
    fn test_skip_ai_generated_minified_js() {
        let hunk = make_hunk("dist/bundle.min.js", vec![added("var a=1;")]);
        assert!(should_skip_ai(&hunk).is_some());
    }

    #[test]
    fn test_skip_ai_generated_sourcemap() {
        let hunk = make_hunk("dist/app.js.map", vec![added("{}")]);
        assert!(should_skip_ai(&hunk).is_some());
    }

    #[test]
    fn test_skip_ai_generated_protobuf() {
        let hunk = make_hunk("proto/service.pb.go", vec![added("func init() {}")]);
        assert!(should_skip_ai(&hunk).is_some());
    }

    #[test]
    fn test_skip_ai_minified_css() {
        let hunk = make_hunk("styles/app.min.css", vec![added(".a{color:red}")]);
        assert!(should_skip_ai(&hunk).is_some());
    }

    #[test]
    fn test_skip_ai_normal_js_not_skipped() {
        let hunk = make_hunk("src/app.js", vec![added("const x = 1;")]);
        assert!(should_skip_ai(&hunk).is_none());
    }

    #[test]
    fn test_skip_ai_pure_deletion() {
        let hunk = make_hunk(
            "src/main.rs",
            vec![
                removed("fn old_function() {"),
                removed("    println!(\"old\");"),
                removed("}"),
            ],
        );
        assert!(should_skip_ai(&hunk).is_some());
    }

    #[test]
    fn test_skip_ai_deletion_with_context_still_skipped() {
        let hunk = make_hunk(
            "src/main.rs",
            vec![
                context("fn main() {"),
                removed("    old_line();"),
                context("}"),
            ],
        );
        assert!(should_skip_ai(&hunk).is_some());
    }

    #[test]
    fn test_skip_ai_modification_not_skipped() {
        // Has both added and removed lines — this is a modification, don't skip
        let hunk = make_hunk(
            "src/main.rs",
            vec![removed("let x = 1;"), added("let x = 2;")],
        );
        assert!(should_skip_ai(&hunk).is_none());
    }

    #[test]
    fn test_skip_ai_lockfile_not_skipped() {
        // Lockfiles are handled by classify_lockfile, not should_skip_ai.
        // should_skip_ai should still return None for lockfiles since they
        // will already be classified before reaching this check.
        let hunk = make_hunk("Cargo.lock", vec![added("[[package]]")]);
        // Lockfile has additions only, is a small hunk, and is not in the generated patterns
        // (lockfiles are handled separately). So should_skip_ai returns None.
        assert!(should_skip_ai(&hunk).is_none());
    }

    // --- Integration: skipped_hunk_ids in classify_hunks_static ---

    #[test]
    fn test_static_classify_populates_skipped_ids() {
        let mut large_lines = Vec::new();
        for i in 0..60 {
            large_lines.push(added(&format!("line {i}")));
        }

        let hunks = vec![
            make_hunk("package-lock.json", vec![added("{}")]), // classified: lockfile
            make_hunk("src/main.rs", large_lines),             // skipped: too large
            make_hunk("dist/app.min.js", vec![added("var a=1;")]), // skipped: generated
            make_hunk("src/lib.rs", vec![added("let x = 1;")]), // neither: goes to AI
        ];

        let response = classify_hunks_static(&hunks);

        // lockfile classified
        assert_eq!(response.classifications.len(), 1);
        assert!(response
            .classifications
            .contains_key("package-lock.json:testhash"));

        // large hunk and minified file skipped
        assert_eq!(response.skipped_hunk_ids.len(), 2);
        assert!(response
            .skipped_hunk_ids
            .contains(&"src/main.rs:testhash".to_owned()));
        assert!(response
            .skipped_hunk_ids
            .contains(&"dist/app.min.js:testhash".to_owned()));
    }
}
