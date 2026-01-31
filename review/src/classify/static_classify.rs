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
pub fn classify_hunks_static(hunks: &[DiffHunk]) -> ClassifyResponse {
    let mut classifications = HashMap::new();

    for hunk in hunks {
        if let Some(result) = classify_single_hunk(hunk) {
            classifications.insert(hunk.id.clone(), result);
        }
    }

    ClassifyResponse { classifications }
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

/// Maps file extension to import statement prefixes.
fn import_prefixes(ext: &str) -> Option<&'static [&'static str]> {
    match ext {
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "mts" | "cjs" | "cts" => {
            Some(&["import ", "import{", "export { ", "export {"])
        }
        "py" => Some(&["import ", "from "]),
        "go" => Some(&["import "]),
        "rs" => Some(&["use "]),
        "java" | "kt" | "kts" | "scala" | "groovy" | "gradle" => Some(&["import "]),
        "c" | "cc" | "cpp" | "cxx" | "h" | "hpp" | "m" | "mm" => Some(&["#include"]),
        "rb" => Some(&["require ", "require_relative "]),
        "cs" => Some(&["using "]),
        "swift" => Some(&["import "]),
        "dart" => Some(&["import ", "export "]),
        _ => None,
    }
}

fn is_import_line(content: &str, prefixes: &[&str]) -> bool {
    let trimmed = content.trim();
    if trimmed.is_empty() {
        return true; // Blank lines between imports are fine
    }
    prefixes.iter().any(|prefix| trimmed.starts_with(prefix))
}

fn classify_imports(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let ext = hunk.file_path.rsplit('.').next()?;
    let prefixes = import_prefixes(ext)?;

    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    let all_imports = changed_lines
        .iter()
        .all(|line| is_import_line(&line.content, prefixes));

    if !all_imports {
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
                // Mixed add/remove of different imports - let AI handle
                None
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
    fn test_import_different_imports_fall_through() {
        let hunk = make_hunk(
            "index.js",
            vec![
                removed("import { a } from './a';"),
                added("import { b } from './b';"),
            ],
        );
        let result = classify_imports(&hunk);
        // Different imports added vs removed: fall through to AI
        assert!(result.is_none());
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
}
