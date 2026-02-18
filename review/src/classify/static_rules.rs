//! Static hunk classifier using rule-based pattern matching.
//!
//! Detects easily-identifiable patterns (lockfiles, whitespace-only changes,
//! comment additions, import additions, etc.) without any external calls.
//! All rules are conservative: if uncertain, return `None`.

use crate::classify::{ClassificationResult, ClassifyResponse};
use crate::diff::parser::{DiffHunk, DiffLine, LineType};
use std::collections::HashMap;

/// Classify hunks using static pattern matching (no I/O).
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
    classify_moved(hunk)
        .or_else(|| classify_lockfile(hunk))
        .or_else(|| classify_empty_file(hunk))
        .or_else(|| classify_whitespace(hunk))
        .or_else(|| classify_line_length(hunk))
        .or_else(|| classify_style(hunk))
        .or_else(|| classify_comments(hunk))
        .or_else(|| classify_type_annotations(hunk))
        .or_else(|| classify_imports(hunk))
}

// --- Rule 0: Move pair detection (cheapest: single field check) ---

fn classify_moved(hunk: &DiffHunk) -> Option<ClassificationResult> {
    if hunk.move_pair_id.is_some() {
        Some(ClassificationResult {
            label: vec!["move:code".to_owned()],
            reasoning: "Hunk is part of a move pair (identical content moved between files)"
                .to_owned(),
        })
    } else {
        None
    }
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

// --- Rule 2: New empty file detection ---

fn classify_empty_file(hunk: &DiffHunk) -> Option<ClassificationResult> {
    // Must be a new file (no old content)
    if hunk.old_count != 0 {
        return None;
    }

    // New file = only added lines (no context or removed lines)
    // Empty = no lines or all whitespace
    let all_added_or_empty = hunk.lines.iter().all(|l| l.line_type == LineType::Added);
    let all_whitespace = hunk.lines.iter().all(|l| l.content.trim().is_empty());

    if all_added_or_empty && all_whitespace {
        Some(ClassificationResult {
            label: vec!["file:added-empty".to_owned()],
            reasoning: "New empty file (no content or whitespace only)".to_owned(),
        })
    } else {
        None
    }
}

// --- Rule 3: Whitespace-only changes ---

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

// --- Rule 4: Line-length changes (line wrapping / unwrapping) ---

fn classify_line_length(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    // Must have both added and removed lines
    let has_added = changed_lines.iter().any(|l| l.line_type == LineType::Added);
    let has_removed = changed_lines
        .iter()
        .any(|l| l.line_type == LineType::Removed);
    if !has_added || !has_removed {
        return None;
    }

    // Join all removed lines into one string, join all added lines into one string
    let removed_joined: String = changed_lines
        .iter()
        .filter(|l| l.line_type == LineType::Removed)
        .map(|l| l.content.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let added_joined: String = changed_lines
        .iter()
        .filter(|l| l.line_type == LineType::Added)
        .map(|l| l.content.as_str())
        .collect::<Vec<_>>()
        .join(" ");

    // Collapse whitespace and compare
    let removed_normalized = collapse_whitespace(&removed_joined);
    let added_normalized = collapse_whitespace(&added_joined);

    if removed_normalized == added_normalized && !removed_normalized.is_empty() {
        Some(ClassificationResult {
            label: vec!["formatting:line-length".to_owned()],
            reasoning: "Code wrapped or unwrapped across lines (identical content after joining)"
                .to_owned(),
        })
    } else {
        None
    }
}

/// Collapse all whitespace runs to a single space and trim.
fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

// --- Rule 5: Style changes (semicolons, quotes, trailing commas) ---

fn classify_style(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    // Must have both added and removed lines
    let has_added = changed_lines.iter().any(|l| l.line_type == LineType::Added);
    let has_removed = changed_lines
        .iter()
        .any(|l| l.line_type == LineType::Removed);
    if !has_added || !has_removed {
        return None;
    }

    // Pair up removed and added lines in order
    let removed_lines: Vec<&str> = changed_lines
        .iter()
        .filter(|l| l.line_type == LineType::Removed)
        .map(|l| l.content.as_str())
        .collect();
    let added_lines: Vec<&str> = changed_lines
        .iter()
        .filter(|l| l.line_type == LineType::Added)
        .map(|l| l.content.as_str())
        .collect();

    // Must have the same number of removed and added lines to pair them
    if removed_lines.len() != added_lines.len() {
        return None;
    }

    // Each pair must normalize to the same content
    let all_match = removed_lines.iter().zip(added_lines.iter()).all(|(r, a)| {
        let rn = normalize_style(r);
        let an = normalize_style(a);
        rn == an && !rn.is_empty()
    });

    if all_match {
        Some(ClassificationResult {
            label: vec!["formatting:style".to_owned()],
            reasoning: "Only punctuation changed (semicolons, quote style, or trailing commas)"
                .to_owned(),
        })
    } else {
        None
    }
}

/// Normalize a line for style comparison:
/// - Strip trailing semicolons
/// - Normalize quotes (single ↔ double)
/// - Strip trailing commas
fn normalize_style(line: &str) -> String {
    let trimmed = line.trim();
    // Strip trailing semicolons
    let s = trimmed.trim_end_matches(';');
    // Strip trailing commas
    let s = s.trim_end_matches(',');
    // Normalize quotes: replace single quotes with double quotes
    let s = s.replace('\'', "\"");
    // Collapse whitespace for consistency
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

// --- Rule 6: Comment-only changes ---

/// Maps file extension to line-comment prefixes.
fn comment_prefixes(ext: &str) -> Option<&'static [&'static str]> {
    match ext {
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "mts" | "cjs" | "cts" | "rs" | "go" | "java"
        | "kt" | "kts" | "scala" | "swift" | "c" | "cc" | "cpp" | "cxx" | "h" | "hpp" | "cs"
        | "m" | "mm" | "zig" | "v" | "dart" | "groovy" | "gradle" | "css" => Some(&["//"]),
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

/// Maps file extension to block-comment delimiters (open, close).
fn block_comment_delimiters(ext: &str) -> Option<(&'static str, &'static str)> {
    match ext {
        // C-family block comments
        "js" | "jsx" | "ts" | "tsx" | "mjs" | "mts" | "cjs" | "cts" | "rs" | "go" | "java"
        | "kt" | "kts" | "scala" | "swift" | "c" | "cc" | "cpp" | "cxx" | "h" | "hpp" | "cs"
        | "m" | "mm" | "zig" | "v" | "dart" | "groovy" | "gradle" | "css" => Some(("/*", "*/")),
        // HTML/XML block comments
        "html" | "xml" | "svg" => Some(("<!--", "-->")),
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

/// Check if a line is part of a block comment.
/// `in_block` indicates whether we are currently inside a block comment.
/// Returns `(is_comment, new_in_block)`.
fn check_block_comment_line(
    content: &str,
    open: &str,
    close: &str,
    in_block: bool,
) -> (bool, bool) {
    let trimmed = content.trim();

    if trimmed.is_empty() {
        return (true, in_block); // Blank lines are fine
    }

    if in_block {
        // We're inside a block comment, check if it closes
        if trimmed.contains(close) {
            // Check if another block opens after the close
            let after_close = &trimmed[trimmed.find(close).unwrap() + close.len()..];
            let reopens = after_close.contains(open);
            return (true, reopens);
        }
        (true, true)
    } else {
        // Not in a block comment — check if one opens
        if trimmed.starts_with(open) || trimmed.starts_with('*') {
            // Could be a block comment start or continuation (e.g. ` * ...`)
            if trimmed.starts_with(open) {
                if trimmed.contains(close) {
                    // Single-line block comment like /* ... */
                    let after_close = &trimmed[trimmed.find(close).unwrap() + close.len()..];
                    let reopens = after_close.contains(open);
                    return (true, reopens);
                }
                return (true, true); // Block comment opened, not closed
            }
            // Line starts with * — likely a doc-comment continuation
            // Only count this if it looks like /** ... */ style
            (false, false)
        } else {
            (false, false)
        }
    }
}

fn classify_comments(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let ext = hunk.file_path.rsplit('.').next()?;
    let line_prefixes = comment_prefixes(ext);
    let block_delims = block_comment_delimiters(ext);

    // Must support at least one comment style
    if line_prefixes.is_none() && block_delims.is_none() {
        return None;
    }

    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    // Check if all changed lines are comments (line or block)
    let mut in_block_added = false;
    let mut in_block_removed = false;

    let all_comments = changed_lines.iter().all(|line| {
        let trimmed = line.content.trim();
        if trimmed.is_empty() {
            return true;
        }

        // Check line comments first
        if let Some(prefixes) = line_prefixes {
            if is_comment_line(&line.content, prefixes) {
                return true;
            }
        }

        // Check block comments
        if let Some((open, close)) = block_delims {
            let in_block = match line.line_type {
                LineType::Added => &mut in_block_added,
                LineType::Removed => &mut in_block_removed,
                LineType::Context => return false, // context lines not checked
            };
            let (is_comment, new_in_block) =
                check_block_comment_line(&line.content, open, close, *in_block);
            *in_block = new_in_block;
            if is_comment {
                return true;
            }
        }

        false
    });

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

// --- Rule 7: Type annotation changes ---

/// Strip Python type annotations from a line.
/// Handles `: type` after params and `-> type` return annotations.
fn strip_python_type_annotations(line: &str) -> String {
    let trimmed = line.trim();

    // Simple approach: strip `: <type>` patterns and `-> <type>` patterns
    // We work with the whole line and strip annotations conservatively.
    let mut result = String::new();
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut in_string = None; // Track string delimiters

    while i < len {
        let ch = chars[i];

        // Track string state to avoid stripping inside strings
        match in_string {
            Some(delim) if ch == delim => {
                // Check for escape
                if i == 0 || chars[i - 1] != '\\' {
                    in_string = None;
                }
                result.push(ch);
                i += 1;
                continue;
            }
            Some(_) => {
                result.push(ch);
                i += 1;
                continue;
            }
            None if ch == '"' || ch == '\'' => {
                in_string = Some(ch);
                result.push(ch);
                i += 1;
                continue;
            }
            None => {}
        }

        // Check for `->` return type annotation
        if ch == '-' && i + 1 < len && chars[i + 1] == '>' {
            // Trim trailing whitespace from result (the space before `->`)
            let trimmed_result = result.trim_end().to_owned();
            result = trimmed_result;
            // Skip everything until `:` (the colon starting the function body)
            // or end of line
            let rest = &trimmed[i..];
            if let Some(colon_pos) = rest.find(':') {
                // Skip the annotation, keep the colon
                i += colon_pos;
                continue;
            } else {
                // No colon found, skip to end
                break;
            }
        }

        // Check for `: <type>` annotation after a parameter
        if ch == ':' && i > 0 {
            // Look ahead to see if this looks like a type annotation
            // (not a dict literal, slice, or function body colon)
            let before = &trimmed[..i];
            let after_colon = &trimmed[i + 1..];

            // Skip if this is the final colon of a `def ...():` line
            let after_trimmed = after_colon.trim();
            if after_trimmed.is_empty() || after_trimmed == "\\" || after_trimmed.starts_with('#') {
                result.push(ch);
                i += 1;
                continue;
            }

            // Check if the character before the colon suggests a parameter name
            let prev_word_end = before.trim_end();
            if prev_word_end.ends_with(')') || prev_word_end.ends_with(']') {
                // After closing paren/bracket — likely dict/slice, keep it
                result.push(ch);
                i += 1;
                continue;
            }

            // This looks like a type annotation — skip until comma, closing paren, equals, or end
            let mut j = i + 1;
            let mut depth = 0i32;
            while j < len {
                let c2 = chars[j];
                if c2 == '[' || c2 == '(' {
                    depth += 1;
                } else if c2 == ']' || c2 == ')' {
                    if depth > 0 {
                        depth -= 1;
                    } else {
                        break;
                    }
                } else if depth == 0 && (c2 == ',' || c2 == '=') {
                    break;
                }
                j += 1;
            }
            // Insert space before `=` to maintain word boundary, but not
            // before `)`, `,`, or end-of-line where it would be extra
            if j < len && chars[j] == '=' {
                result.push(' ');
            }
            i = j;
            continue;
        }

        result.push(ch);
        i += 1;
    }

    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Strip TypeScript type annotations from a line.
/// Handles `: type` after variables/params.
fn strip_ts_type_annotations(line: &str) -> String {
    let trimmed = line.trim();
    let mut result = String::new();
    let chars: Vec<char> = trimmed.chars().collect();
    let len = chars.len();
    let mut i = 0;
    let mut in_string = None;

    while i < len {
        let ch = chars[i];

        // Track string state
        match in_string {
            Some(delim) if ch == delim => {
                if i == 0 || chars[i - 1] != '\\' {
                    in_string = None;
                }
                result.push(ch);
                i += 1;
                continue;
            }
            Some(_) => {
                result.push(ch);
                i += 1;
                continue;
            }
            None if ch == '"' || ch == '\'' || ch == '`' => {
                in_string = Some(ch);
                result.push(ch);
                i += 1;
                continue;
            }
            None => {}
        }

        // Check for `: <type>` annotation
        if ch == ':' && i > 0 {
            let after_colon = &trimmed[i + 1..];
            let after_trimmed = after_colon.trim_start();

            // Skip if this looks like an object literal value, ternary, etc.
            // A type annotation typically follows an identifier or closing paren
            let before = &trimmed[..i];
            let prev_word_end = before.trim_end();

            // Skip if before is a string end, or if we're in a ternary/object
            if prev_word_end.ends_with('}')
                || prev_word_end.ends_with('"')
                || prev_word_end.ends_with('\'')
                || prev_word_end.ends_with('`')
            {
                result.push(ch);
                i += 1;
                continue;
            }

            // Check if after looks like a type (starts with a letter, `{`, `(`, `[`, or `typeof`)
            if after_trimmed
                .starts_with(|c: char| c.is_alphabetic() || c == '{' || c == '(' || c == '[')
            {
                // Skip the type annotation until `=`, `,`, `)`, `{`, or end
                let mut j = i + 1;
                let mut depth = 0i32;
                while j < len {
                    let c2 = chars[j];
                    if c2 == '<' || c2 == '(' || c2 == '[' || c2 == '{' {
                        depth += 1;
                    } else if c2 == '>' || c2 == ')' || c2 == ']' || c2 == '}' {
                        if depth > 0 {
                            depth -= 1;
                        } else {
                            break;
                        }
                    } else if depth == 0 && (c2 == '=' || c2 == ',') {
                        break;
                    }
                    j += 1;
                }
                // Insert space to maintain word boundary after stripping
                result.push(' ');
                i = j;
                continue;
            }

            result.push(ch);
            i += 1;
            continue;
        }

        result.push(ch);
        i += 1;
    }

    result.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn classify_type_annotations(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let ext = hunk.file_path.rsplit('.').next()?;

    let strip_fn: fn(&str) -> String = match ext {
        "py" => strip_python_type_annotations,
        "ts" | "tsx" => strip_ts_type_annotations,
        _ => return None,
    };

    let changed_lines = get_changed_lines(&hunk.lines);
    if changed_lines.is_empty() {
        return None;
    }

    let has_added = changed_lines.iter().any(|l| l.line_type == LineType::Added);
    let has_removed = changed_lines
        .iter()
        .any(|l| l.line_type == LineType::Removed);

    // For added/removed only: strip annotations and check if resulting lines are empty/unchanged
    // For modified: pair removed/added lines and compare after stripping
    match (has_added, has_removed) {
        (true, true) => {
            // Both added and removed — pair them up and compare after stripping
            let removed_lines: Vec<&str> = changed_lines
                .iter()
                .filter(|l| l.line_type == LineType::Removed)
                .map(|l| l.content.as_str())
                .collect();
            let added_lines: Vec<&str> = changed_lines
                .iter()
                .filter(|l| l.line_type == LineType::Added)
                .map(|l| l.content.as_str())
                .collect();

            if removed_lines.len() != added_lines.len() {
                return None;
            }

            let all_match = removed_lines.iter().zip(added_lines.iter()).all(|(r, a)| {
                let rs = strip_fn(r);
                let as_ = strip_fn(a);
                rs == as_ && !rs.is_empty()
            });

            if all_match {
                Some(ClassificationResult {
                    label: vec!["type-annotations:modified".to_owned()],
                    reasoning: "Stripping type annotations leaves identical code".to_owned(),
                })
            } else {
                None
            }
        }
        (true, false) => {
            // Only additions — check if stripping annotations from added lines
            // would leave nothing new (i.e. only type annotations were added).
            // This is hard to detect reliably for pure additions without context,
            // so we're conservative and skip this case.
            None
        }
        (false, true) => {
            // Only removals — similarly conservative
            None
        }
        (false, false) => None,
    }
}

// --- Rule 8: Import-only changes ---

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

    // --- Move pair tests ---

    #[test]
    fn test_moved_hunk_with_move_pair_id() {
        let mut hunk = make_hunk("src/old.rs", vec![removed("fn foo() {}")]);
        hunk.move_pair_id = Some("src/new.rs:somehash".to_owned());
        let result = classify_single_hunk(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["move:code"]);
    }

    #[test]
    fn test_hunk_without_move_pair_id_not_moved() {
        let hunk = make_hunk("src/main.rs", vec![added("fn foo() {}")]);
        let result = classify_moved(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_moved_takes_priority_over_other_rules() {
        // A lockfile hunk with a move_pair_id should be classified as moved
        let mut hunk = make_hunk("package-lock.json", vec![added("{}")]);
        hunk.move_pair_id = Some("other:hash".to_owned());
        let result = classify_single_hunk(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["move:code"]);
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

    // --- Empty file tests ---

    #[test]
    fn test_empty_file_completely_empty() {
        // New file with no lines at all
        let hunk = make_hunk("__init__.py", vec![]);
        let result = classify_empty_file(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["file:added-empty"]);
    }

    #[test]
    fn test_empty_file_whitespace_only() {
        // New file with only blank lines
        let mut hunk = make_hunk("__init__.py", vec![added(""), added("   "), added("")]);
        hunk.old_count = 0; // Ensure it's treated as a new file
        let result = classify_empty_file(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["file:added-empty"]);
    }

    #[test]
    fn test_empty_file_not_new() {
        // Existing file modified to be empty should NOT match
        let mut hunk = make_hunk("some_file.py", vec![removed("old content")]);
        hunk.old_count = 1; // Had content before
        let result = classify_empty_file(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_empty_file_with_content() {
        // New file with actual content should NOT match
        let mut hunk = make_hunk("__init__.py", vec![added("# some comment")]);
        hunk.old_count = 0;
        let result = classify_empty_file(&hunk);
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

    // --- Line-length tests ---

    #[test]
    fn test_line_length_wrap() {
        // Single line wrapped to two lines
        let hunk = make_hunk(
            "src/app.ts",
            vec![
                removed("const result = foo(bar, baz, qux);"),
                added("const result ="),
                added("  foo(bar, baz, qux);"),
            ],
        );
        let result = classify_line_length(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["formatting:line-length"]);
    }

    #[test]
    fn test_line_length_unwrap() {
        // Two lines joined into one
        let hunk = make_hunk(
            "src/app.ts",
            vec![
                removed("const result ="),
                removed("  foo(bar, baz);"),
                added("const result = foo(bar, baz);"),
            ],
        );
        let result = classify_line_length(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["formatting:line-length"]);
    }

    #[test]
    fn test_line_length_different_content() {
        // Content actually changed, not just wrapping
        let hunk = make_hunk(
            "src/app.ts",
            vec![
                removed("const result = foo(bar, baz);"),
                added("const result = foo(bar, qux);"),
            ],
        );
        let result = classify_line_length(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_line_length_additions_only() {
        // Only additions, no removals — not a line-length change
        let hunk = make_hunk("src/app.ts", vec![added("const x = 1;")]);
        let result = classify_line_length(&hunk);
        assert!(result.is_none());
    }

    // --- Style tests ---

    #[test]
    fn test_style_semicolon_added() {
        let hunk = make_hunk(
            "src/app.ts",
            vec![removed("const x = 1"), added("const x = 1;")],
        );
        let result = classify_style(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["formatting:style"]);
    }

    #[test]
    fn test_style_quote_change() {
        let hunk = make_hunk(
            "src/app.js",
            vec![removed("const x = 'hello'"), added("const x = \"hello\"")],
        );
        let result = classify_style(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["formatting:style"]);
    }

    #[test]
    fn test_style_trailing_comma() {
        let hunk = make_hunk(
            "src/app.ts",
            vec![removed("  foo: 'bar'"), added("  foo: 'bar',")],
        );
        let result = classify_style(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["formatting:style"]);
    }

    #[test]
    fn test_style_real_change() {
        // Content actually changed
        let hunk = make_hunk(
            "src/app.ts",
            vec![removed("const x = 1;"), added("const x = 2;")],
        );
        let result = classify_style(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_style_additions_only() {
        // Only additions, not a style change
        let hunk = make_hunk("src/app.ts", vec![added("const x = 1;")]);
        let result = classify_style(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_style_different_line_count() {
        // Different number of removed and added lines
        let hunk = make_hunk(
            "src/app.ts",
            vec![
                removed("const x = 1"),
                added("const x = 1;"),
                added("const y = 2;"),
            ],
        );
        let result = classify_style(&hunk);
        assert!(result.is_none());
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

    // --- Block comment tests ---

    #[test]
    fn test_block_comment_added_js() {
        let hunk = make_hunk("app.js", vec![added("/* This is a block comment */")]);
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:added"]);
    }

    #[test]
    fn test_block_comment_multiline_added_js() {
        let hunk = make_hunk(
            "app.js",
            vec![
                added("/* Start of comment"),
                added("   middle of comment"),
                added("   end of comment */"),
            ],
        );
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:added"]);
    }

    #[test]
    fn test_block_comment_removed_css() {
        let hunk = make_hunk("styles.css", vec![removed("/* Old CSS comment */")]);
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:removed"]);
    }

    #[test]
    fn test_block_comment_html() {
        let hunk = make_hunk(
            "index.html",
            vec![added("<!-- This is an HTML comment -->")],
        );
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:added"]);
    }

    #[test]
    fn test_block_comment_multiline_html() {
        let hunk = make_hunk(
            "index.html",
            vec![
                added("<!-- Start"),
                added("     middle"),
                added("     end -->"),
            ],
        );
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:added"]);
    }

    #[test]
    fn test_block_comment_xml() {
        let hunk = make_hunk("config.xml", vec![removed("<!-- Old XML comment -->")]);
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:removed"]);
    }

    #[test]
    fn test_block_comment_svg() {
        let hunk = make_hunk("icon.svg", vec![added("<!-- SVG comment -->")]);
        let result = classify_comments(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["comments:added"]);
    }

    #[test]
    fn test_block_comment_mixed_with_code() {
        let hunk = make_hunk(
            "app.js",
            vec![added("/* comment */"), added("const x = 1;")],
        );
        let result = classify_comments(&hunk);
        assert!(result.is_none());
    }

    // --- Type annotation tests ---

    #[test]
    fn test_type_annotation_python_added() {
        let hunk = make_hunk(
            "app.py",
            vec![removed("def greet(name):"), added("def greet(name: str):")],
        );
        let result = classify_type_annotations(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["type-annotations:modified"]);
    }

    #[test]
    fn test_type_annotation_python_return_type() {
        let hunk = make_hunk(
            "app.py",
            vec![
                removed("def greet(name):"),
                added("def greet(name) -> str:"),
            ],
        );
        let result = classify_type_annotations(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["type-annotations:modified"]);
    }

    #[test]
    fn test_type_annotation_ts_added() {
        let hunk = make_hunk(
            "app.ts",
            vec![removed("const x = 1"), added("const x: number = 1")],
        );
        let result = classify_type_annotations(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["type-annotations:modified"]);
    }

    #[test]
    fn test_type_annotation_not_supported_extension() {
        // .rs files are not supported for type annotation stripping
        let hunk = make_hunk(
            "app.rs",
            vec![removed("let x = 1;"), added("let x: i32 = 1;")],
        );
        let result = classify_type_annotations(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_type_annotation_real_change() {
        // Actual code change, not just type annotations
        let hunk = make_hunk(
            "app.py",
            vec![removed("def greet(name):"), added("def hello(name: str):")],
        );
        let result = classify_type_annotations(&hunk);
        assert!(result.is_none());
    }

    #[test]
    fn test_type_annotation_additions_only() {
        // Only additions — conservative, returns None
        let hunk = make_hunk("app.py", vec![added("def greet(name: str) -> str:")]);
        let result = classify_type_annotations(&hunk);
        assert!(result.is_none());
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
}
