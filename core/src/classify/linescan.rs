//! String-literal-aware scanning of a single source line.
//!
//! Every scanner here answers a question about raw text — where does a string
//! end, where does a comment start, how deep do the brackets go — without being
//! fooled by a quote's contents. They live apart from the rules so each rule
//! stays readable rather than mixing rules with char-scanners.
//!
//! Conservative by design: [`collapse_ws_outside_strings`] leaves string
//! interiors intact, so a real edit inside a literal can't masquerade as a
//! harmless reflow.
//!
//! Everything here works on `&[char]` rather than `&str`: the scanners index by
//! position constantly, and char positions keep that indexing honest for
//! non-ASCII source without byte-boundary bookkeeping.

use super::tokens::{CLOSE_BRACKETS, OPEN_BRACKETS};

pub const QUOTES: [char; 3] = ['"', '\'', '`'];

/// Collapse all whitespace runs to single spaces and trim.
pub fn collapse_ws(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// True if `chars[i..]` starts with `pat`.
pub fn chars_start_with(chars: &[char], i: usize, pat: &str) -> bool {
    let mut k = i;
    for c in pat.chars() {
        if k >= chars.len() || chars[k] != c {
            return false;
        }
        k += 1;
    }
    true
}

/// The first position at or after `from` where `pat` occurs.
pub fn chars_find(chars: &[char], from: usize, pat: &str) -> Option<usize> {
    (from..=chars.len()).find(|&i| chars_start_with(chars, i, pat))
}

pub fn slice_text(chars: &[char], start: usize, end: usize) -> String {
    chars[start..end].iter().collect()
}

/// Index just past the string opened at `chars[i]`, or `None` if it is never
/// closed. Escapes are skipped forward (`\` consumes the next char), so an
/// escaped quote or backslash right before the close can't end the string early.
/// This is the single place the escape rule lives.
pub fn scan_string(chars: &[char], i: usize) -> Option<usize> {
    let quote = chars[i];
    // A triple-quoted string (`'''…'''` / `"""…"""`) is one delimiter, not
    // three: pairwise scanning would close on the first apostrophe inside
    // (`'''don't'''`) and desync everything after it — a `#` later in the
    // literal would read as a comment. An unclosed triple continues on another
    // line, which a single-line scanner can't judge, so it stays `None`.
    if (quote == '"' || quote == '\'') && chars_start_with(chars, i, &quote.to_string().repeat(3)) {
        let triple = quote.to_string().repeat(3);
        return chars_find(chars, i + 3, &triple).map(|close| close + 3);
    }
    let mut j = i + 1;
    while j < chars.len() {
        if chars[j] == '\\' {
            j += 2; // skip an escaped char (e.g. \\ or \")
            continue;
        }
        if chars[j] == quote {
            return Some(j + 1);
        }
        j += 1;
    }
    None
}

/// Given `i` at an opening quote, the index just past its close, or the end of
/// the text if the string is unterminated — the form scanners want when they
/// treat an unterminated literal as running to end-of-line (vs the tokenizer,
/// which uses [`scan_string`] directly to bail on a `None`).
pub fn consume_string(chars: &[char], i: usize) -> usize {
    scan_string(chars, i).unwrap_or(chars.len())
}

/// Collapse whitespace runs, but leave the contents of string literals intact.
///
/// Used by wrap detection: re-wrapping code only moves whitespace *between*
/// tokens, never inside a string. Collapsing string interiors too would let a
/// real edit like `"a  b"` -> `"a b"` look like a harmless reflow.
pub fn collapse_ws_outside_strings(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let mut pending_space = false;
    while i < chars.len() {
        let ch = chars[i];
        if QUOTES.contains(&ch) {
            let close = consume_string(&chars, i);
            out.extend(&chars[i..close]);
            i = close;
            pending_space = false;
        } else if ch.is_whitespace() {
            if !out.is_empty() && !pending_space {
                out.push(' ');
                pending_space = true;
            }
            i += 1;
        } else {
            out.push(ch);
            pending_space = false;
            i += 1;
        }
    }
    out.trim_end().to_owned()
}

/// The leading-whitespace prefix of `text`. Indentation is semantic in Python (a
/// dedent moves a statement to another block), so rules that compare
/// whitespace-normalized lines must keep it, or an indent-only change would read
/// as trivial and be hidden.
pub fn leading_indent(text: &str) -> &str {
    &text[..text.len() - text.trim_start().len()]
}

/// Net bracket-depth change of `text`, ignoring brackets inside strings.
pub fn bracket_delta(text: &str) -> i32 {
    let chars: Vec<char> = text.chars().collect();
    let mut depth = 0;
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if QUOTES.contains(&ch) {
            i = consume_string(&chars, i);
            continue;
        }
        if OPEN_BRACKETS.contains(&ch) {
            depth += 1;
        } else if CLOSE_BRACKETS.contains(&ch) {
            depth -= 1;
        }
        i += 1;
    }
    depth
}

/// Net depth change for ONE bracket pair, counting only this line's CODE:
/// brackets inside a string literal or after a line comment don't count.
///
/// The distinction matters wherever a depth is used to decide that following
/// lines are a continuation. A bracket in a comment (`import os  # see issue (`)
/// would otherwise open a continuation that never closes, and every line under
/// it would inherit the exemption that depth buys.
pub fn code_bracket_balance(
    text: &str,
    open: char,
    close: char,
    prefixes: &[&str],
    quotes: &str,
) -> i32 {
    let chars: Vec<char> = text.chars().collect();
    let end = find_line_comment(&chars, prefixes, quotes, false).unwrap_or(chars.len());
    let mut depth = 0;
    let mut i = 0;
    while i < end {
        let ch = chars[i];
        if quotes.contains(ch) {
            i = consume_string(&chars, i).min(end);
            continue;
        }
        if ch == open {
            depth += 1;
        } else if ch == close {
            depth -= 1;
        }
        i += 1;
    }
    depth
}

/// True if `text` ends inside a string literal that never closes.
///
/// Such a line opens a multi-line string — a template literal, a docstring, a
/// heredoc — so the lines under it are string CONTENT, not code: whitespace,
/// quotes, and comment markers there are all just characters in a value. Line
/// comments are skipped first, so an apostrophe in prose does not read as an
/// opening quote.
pub fn has_unterminated_string(text: &str, prefixes: &[&str], quotes: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let end = find_line_comment(&chars, prefixes, quotes, false).unwrap_or(chars.len());
    let mut i = 0;
    while i < end {
        if quotes.contains(chars[i]) {
            match scan_string(&chars, i) {
                None => return true,
                Some(close) => i = close,
            }
        } else {
            i += 1;
        }
    }
    false
}

/// The position where a line comment starts, ignoring prefixes inside string
/// literals, or `None` if the line has no comment.
///
/// `require_space` selects between the two callers' rules. When true (stripping
/// a trailing comment to compare the code before it), a prefix only starts a
/// comment at line-start or after whitespace — glued to a preceding token it is
/// part of a value, not a comment (YAML/shell treat it that way, and a URL
/// fragment `url: https://x/#frag` must not read as a `#` comment). That is
/// conservative: it can only *miss* a space-less comment like `x=1#c`, never
/// hide a real change. When false (asking whether a join would be swallowed by
/// a comment), a glued comment (`foo()// note`) swallows the join just the
/// same, so no whitespace is required.
pub fn find_line_comment(
    chars: &[char],
    prefixes: &[&str],
    quotes: &str,
    require_space: bool,
) -> Option<usize> {
    let mut i = 0;
    while i < chars.len() {
        if quotes.contains(chars[i]) {
            i = consume_string(chars, i);
        } else if prefixes.iter().any(|p| chars_start_with(chars, i, p))
            && (!require_space || i == 0 || chars[i - 1].is_whitespace())
        {
            return Some(i);
        } else {
            i += 1;
        }
    }
    None
}

/// True if `text` starts a line comment outside a string literal.
pub fn has_line_comment(text: &str, prefixes: &[&str], quotes: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    find_line_comment(&chars, prefixes, quotes, false).is_some()
}

/// `text`, trimmed, with any trailing line-comment dropped.
pub fn strip_inline_comment(text: &str, prefixes: &[&str], quotes: &str) -> String {
    let chars: Vec<char> = text.trim().chars().collect();
    match find_line_comment(&chars, prefixes, quotes, true) {
        Some(i) => slice_text(&chars, 0, i).trim_end().to_owned(),
        None => chars.iter().collect(),
    }
}

/// True if a join between these lines lands INSIDE a multi-line string literal
/// (a `"""…"""` body, a `` `…` `` template literal spanning lines).
///
/// The line-length rule joins the lines with a space to compare the reflow.
/// When a break sits inside a string, that space replaces a real interior
/// newline, so the string's *value* changes (`"SELECT a,\nb"` -> `"SELECT a,
/// b"`) yet both sides join to the same text — the change would be hidden.
pub fn join_crosses_string(lines: &[&str]) -> bool {
    let mut open_delim: Option<String> = None; // delimiter of a string still open at line end
    for line in &lines[..lines.len().saturating_sub(1)] {
        let chars: Vec<char> = line.chars().collect();
        let mut i = 0;
        if let Some(delim) = open_delim.take() {
            // continuing a string opened on an earlier line
            match chars_find(&chars, 0, &delim) {
                None => return true, // still open across this join
                Some(close) => i = close + delim.chars().count(),
            }
        }
        while i < chars.len() {
            if QUOTES.contains(&chars[i]) {
                let quote = chars[i];
                let triple = quote.to_string().repeat(3);
                let delim = if chars_start_with(&chars, i, &triple) {
                    triple
                } else {
                    quote.to_string()
                };
                match scan_string(&chars, i) {
                    // opens a string that runs past end-of-line
                    None => {
                        open_delim = Some(delim);
                        break;
                    }
                    Some(close) => i = close,
                }
            } else {
                i += 1;
            }
        }
        if open_delim.is_some() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn chars(s: &str) -> Vec<char> {
        s.chars().collect()
    }

    #[test]
    fn scan_string_handles_escapes_and_triples() {
        assert_eq!(scan_string(&chars(r#""a\"b" x"#), 0), Some(6));
        assert_eq!(scan_string(&chars("'''don't # c''' rest"), 0), Some(15));
        assert_eq!(scan_string(&chars("'unterminated"), 0), None);
    }

    #[test]
    fn collapse_preserves_string_interiors() {
        assert_eq!(collapse_ws_outside_strings("x  =  'a  b'"), "x = 'a  b'");
        assert_eq!(collapse_ws_outside_strings("  a   b  "), "a b");
    }

    #[test]
    fn unterminated_strings_are_detected_past_comments() {
        assert!(has_unterminated_string("const msg = `", &["//"], "\"'`"));
        assert!(has_unterminated_string(r#"doc = """"#, &["#"], "\"'"));
        assert!(!has_unterminated_string("x = \"a\"", &["#"], "\"'"));
        // An apostrophe in prose is not an opening quote.
        assert!(!has_unterminated_string("# don't", &["#"], "\"'"));
        assert!(!has_unterminated_string(r"x = '''a # b'''", &["#"], "\"'"));
    }

    #[test]
    fn line_comments_respect_strings_and_the_space_rule() {
        // A `#` glued to a value is a URL fragment, not a comment...
        assert_eq!(
            strip_inline_comment("url: x/#frag", &["#"], "\"'"),
            "url: x/#frag"
        );
        // ...but the reflow check doesn't require the space.
        assert!(has_line_comment("foo()// note", &["//"], "\"'`"));
        // A prefix inside a string is never a comment.
        assert_eq!(
            strip_inline_comment("x = \"a # b\"  # c", &["#"], "\"'"),
            "x = \"a # b\""
        );
    }
}
