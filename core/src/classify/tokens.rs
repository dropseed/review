//! Minimal source tokenizer for the token-delta trust rules.
//!
//! The rules have to tell a stylistic token from a semantic one — a trailing
//! `;` from an ASI-load-bearing one, a quote delimiter from a string's
//! contents, a moved space from a regrouped operator. That is a lexing
//! question, so rather than scan bytes with ever-more special cases the rules
//! tokenize the line first and reason about token *roles*.
//!
//! Deliberately conservative and NOT a full parser: a line it can't cleanly
//! tokenize — an unterminated string or block comment, or brackets left open,
//! i.e. part of a multi-line construct it can't judge in isolation — yields
//! `None`, and the rule then declines to label rather than guess. Only the two
//! dialects the content rules support (Python, and TypeScript standing in for
//! the whole JS family) are modeled.

use super::linescan::{chars_find, chars_start_with, scan_string, slice_text, QUOTES};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    /// identifier or keyword
    Word,
    /// a punctuation/operator token (`:`, `->`, `(`, `,`, `=`, …)
    Op,
    /// a whole string literal, delimiters included
    Str,
    Number,
}

/// Which lexical rules a line is read under. Python and the JS family can't
/// share one dialect: `//` is a line comment in JS but floor DIVISION in Python
/// (tokenizing `x // 2` as `Ts` would drop `// 2` as a comment and hide a
/// divisor change).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Dialect {
    Py,
    Ts,
}

impl Dialect {
    /// (line-comment prefix, block-comment delimiters) for this dialect.
    fn comments(self) -> (&'static str, Option<(&'static str, &'static str)>) {
        match self {
            Dialect::Py => ("#", None),
            Dialect::Ts => ("//", Some(("/*", "*/"))),
        }
    }
}

#[derive(Debug, Clone)]
pub struct Token {
    pub kind: TokenKind,
    pub text: String,
    /// char offset of the token in its source line
    pub start: usize,
    /// char offset just past the token
    pub end: usize,
}

/// The bracket vocabulary, shared by everything that tracks depth — the
/// tokenizer, the annotation span-walker, `linescan::bracket_delta`, and the
/// import continuation scanner — so no two of them can disagree about what
/// opens or closes a nesting level.
pub const OPEN_BRACKETS: [char; 3] = ['(', '[', '{'];
pub const CLOSE_BRACKETS: [char; 3] = [')', ']', '}'];

/// The closer that matches `open`, or `None` if it isn't an opening bracket.
pub fn matching_close(open: char) -> Option<char> {
    OPEN_BRACKETS
        .iter()
        .position(|&c| c == open)
        .map(|i| CLOSE_BRACKETS[i])
}

/// True if `text` is a whole opening-bracket token.
pub fn is_open_bracket(text: &str) -> bool {
    let mut chars = text.chars();
    matches!((chars.next(), chars.next()), (Some(c), None) if OPEN_BRACKETS.contains(&c))
}

/// True if `text` is a whole closing-bracket token.
pub fn is_close_bracket(text: &str) -> bool {
    let mut chars = text.chars();
    matches!((chars.next(), chars.next()), (Some(c), None) if CLOSE_BRACKETS.contains(&c))
}

/// True if the two token sequences differ in their texts. Compared as
/// iterators — the rules ask this per line pair, and materializing two `Vec`s
/// each time to answer a boolean is pure overhead.
pub fn tokens_differ(old: &[Token], new: &[Token]) -> bool {
    old.len() != new.len() || old.iter().zip(new).any(|(a, b)| a.text != b.text)
}

/// Tokenize a single source line, or `None` if it can't be judged in isolation.
///
/// Returns `None` on an unterminated string/block comment or unbalanced
/// brackets — all signs the line is part of a multi-line construct — so callers
/// stay conservative (no label) instead of guessing at a fragment.
pub fn tokenize(chars: &[char], dialect: Dialect) -> Option<Vec<Token>> {
    let (line_prefix, block) = dialect.comments();
    let mut tokens: Vec<Token> = Vec::new();
    let mut depth: i32 = 0;
    let mut i = 0;
    let n = chars.len();

    while i < n {
        let ch = chars[i];
        if ch.is_whitespace() {
            i += 1;
            continue;
        }
        if chars_start_with(chars, i, line_prefix) {
            break; // rest of the line is a comment
        }
        if let Some((open, close)) = block {
            if chars_start_with(chars, i, open) {
                // unterminated block comment -> multi-line
                let end = chars_find(chars, i + open.len(), close)?;
                i = end + close.len();
                continue;
            }
        }
        if QUOTES.contains(&ch) {
            let close = scan_string(chars, i)?; // unterminated string -> multi-line
            tokens.push(Token {
                kind: TokenKind::Str,
                text: slice_text(chars, i, close),
                start: i,
                end: close,
            });
            i = close;
            continue;
        }
        if ch.is_alphabetic() || ch == '_' {
            let mut j = i + 1;
            while j < n && (chars[j].is_alphanumeric() || chars[j] == '_') {
                j += 1;
            }
            tokens.push(Token {
                kind: TokenKind::Word,
                text: slice_text(chars, i, j),
                start: i,
                end: j,
            });
            i = j;
            continue;
        }
        if ch.is_ascii_digit() {
            let mut j = i + 1;
            while j < n && (chars[j].is_alphanumeric() || chars[j] == '.' || chars[j] == '_') {
                j += 1;
            }
            tokens.push(Token {
                kind: TokenKind::Number,
                text: slice_text(chars, i, j),
                start: i,
                end: j,
            });
            i = j;
            continue;
        }
        if chars_start_with(chars, i, "->") {
            tokens.push(Token {
                kind: TokenKind::Op,
                text: "->".to_owned(),
                start: i,
                end: i + 2,
            });
            i += 2;
            continue;
        }
        if OPEN_BRACKETS.contains(&ch) {
            depth += 1;
        } else if CLOSE_BRACKETS.contains(&ch) {
            depth -= 1;
            if depth < 0 {
                return None; // more closers than openers -> can't be a whole line
            }
        }
        tokens.push(Token {
            kind: TokenKind::Op,
            text: ch.to_string(),
            start: i,
            end: i + 1,
        });
        i += 1;
    }

    if depth != 0 {
        return None; // brackets left open -> part of a multi-line construct
    }
    Some(tokens)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texts(line: &str, dialect: Dialect) -> Option<Vec<String>> {
        let chars: Vec<char> = line.chars().collect();
        tokenize(&chars, dialect).map(|ts| ts.into_iter().map(|t| t.text).collect())
    }

    #[test]
    fn python_slash_slash_is_division_not_a_comment() {
        assert_eq!(
            texts("n = x // 2", Dialect::Py),
            Some(vec![
                "n".to_owned(),
                "=".to_owned(),
                "x".to_owned(),
                "/".to_owned(),
                "/".to_owned(),
                "2".to_owned()
            ])
        );
        assert_eq!(
            texts("n = x // 2", Dialect::Ts),
            Some(vec!["n".to_owned(), "=".to_owned(), "x".to_owned()])
        );
    }

    #[test]
    fn multi_line_fragments_decline() {
        assert_eq!(texts("import {", Dialect::Ts), None);
        assert_eq!(texts("x = 'unterminated", Dialect::Py), None);
        assert_eq!(texts("f(/* open", Dialect::Ts), None);
    }
}
