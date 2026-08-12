//! The shared engine for the paired-line trust rules (style, spacing,
//! type-annotations, and the inline-comment fallback).
//!
//! Those rules answer the same question — "do these paired lines differ *only*
//! in a way I recognize as trivial?" — and must apply the same default-deny
//! gates to answer it safely. If any gate is centralized inconsistently, a rule
//! can start hiding real changes, so the gates live here, once, and each rule
//! supplies only its distinct comparison of one line pair.
//!
//! The work splits in two, because the rules need different amounts of it:
//!
//! - [`paired_changed_lines`] aligns the hunk's changed lines into (old, new)
//!   pairs, or declines. Every paired rule needs this, including the
//!   inline-comment fallback, which compares raw strings because comments span
//!   far more languages than the tokenizer models.
//! - [`prepare_pairs`] then applies the gates that need a lexer — indentation
//!   unchanged, both sides tokenize cleanly, and the comments the tokenizer
//!   drops are unchanged — and hands back both sides' tokens. Only the
//!   dialect-gated rules need this.
//!
//! Both are computed at most once per hunk (see `HunkContext` in
//! `static_rules.rs`) and shared across the rule chain; [`token_delta`] then
//! runs a single rule's comparison over the already-prepared pairs.

use super::linescan::leading_indent;
use super::tokens::{tokenize, Dialect, Token};
use crate::diff::parser::{DiffHunk, DiffLine, LineType};

/// One side of a compared pair, with everything the gates already computed.
pub struct Side<'a> {
    pub line: &'a DiffLine,
    /// the trimmed line, as chars — what `tokens`' offsets index into
    pub stripped: Vec<char>,
    pub tokens: Vec<Token>,
}

/// A gated (old, new) pair, ready for any rule's comparison.
pub type PreparedPair<'a> = (Side<'a>, Side<'a>);

/// The hunk's changed lines as POSITIONALLY aligned (old, new) pairs, or `None`
/// when they don't align.
///
/// Pairing is per replacement block: each contiguous run of changes must be
/// deletions immediately followed by an equal number of additions, and the
/// pairs are taken within that block. Counting alone isn't enough — a line
/// moved across an intervening context line (a lone `-` here, its `+` after the
/// context) changes execution order, so blocks that don't pair up decline
/// rather than letting a positional shuffle read as a trivial delta.
pub fn paired_changed_lines(hunk: &DiffHunk) -> Option<Vec<(&DiffLine, &DiffLine)>> {
    let mut pairs: Vec<(&DiffLine, &DiffLine)> = Vec::new();
    let lines = &hunk.lines;
    let mut i = 0;
    while i < lines.len() {
        if lines[i].line_type == LineType::Context {
            i += 1;
            continue;
        }
        let start = i;
        while i < lines.len() && lines[i].line_type == LineType::Removed {
            i += 1;
        }
        let deletions = &lines[start..i];
        let additions_start = i;
        while i < lines.len() && lines[i].line_type == LineType::Added {
            i += 1;
        }
        let additions = &lines[additions_start..i];
        if deletions.is_empty() || deletions.len() != additions.len() {
            return None; // an unpaired block — an insertion, removal, or move
        }
        pairs.extend(deletions.iter().zip(additions.iter()));
    }
    if pairs.is_empty() {
        None
    } else {
        Some(pairs)
    }
}

/// The line's non-token text — the comments the tokenizer silently drops — with
/// all whitespace removed.
///
/// The tokenizer skips line and block comments, so two lines that differ ONLY
/// in a comment tokenize identically. Without this, a tool directive hidden in
/// a comment (`# noqa`, `# type: ignore[…]`, `/* eslint-disable no-eval */`)
/// could ride along invisibly behind a trivial token delta (a quote swap, an
/// annotation edit) and be hidden from review. A comment change belongs to the
/// comments rule (which declines tool directives), so the paired-line rules
/// must decline when this text changes. Whitespace is stripped so the spacing
/// rule's legitimate whitespace moves don't register.
fn non_token_text(stripped: &[char], tokens: &[Token]) -> String {
    let mut out = String::new();
    let mut pos = 0;
    for tok in tokens {
        out.extend(
            stripped[pos..tok.start]
                .iter()
                .filter(|c| !c.is_whitespace()),
        );
        pos = tok.end;
    }
    out.extend(stripped[pos..].iter().filter(|c| !c.is_whitespace()));
    out
}

/// Apply the gates every dialect-gated rule shares to all pairs, returning both
/// sides' stripped text and tokens, or `None` the moment a gate fails.
pub fn prepare_pairs<'a>(
    pairs: &[(&'a DiffLine, &'a DiffLine)],
    dialect: Dialect,
) -> Option<Vec<PreparedPair<'a>>> {
    pairs
        .iter()
        .map(|&(old, new)| {
            if leading_indent(&old.content) != leading_indent(&new.content) {
                return None; // indentation is semantic (Python) — a real change
            }
            let old_stripped: Vec<char> = old.content.trim().chars().collect();
            let new_stripped: Vec<char> = new.content.trim().chars().collect();
            // a multi-line fragment — can't judge in isolation
            let old_tokens = tokenize(&old_stripped, dialect)?;
            let new_tokens = tokenize(&new_stripped, dialect)?;
            if non_token_text(&old_stripped, &old_tokens)
                != non_token_text(&new_stripped, &new_tokens)
            {
                return None; // a dropped comment/directive changed — the comments rule's job
            }
            Some((
                Side {
                    line: old,
                    stripped: old_stripped,
                    tokens: old_tokens,
                },
                Side {
                    line: new,
                    stripped: new_stripped,
                    tokens: new_tokens,
                },
            ))
        })
        .collect()
}

/// True if the prepared pairs earn this rule's label: every pair differs only
/// in trivial tokens, with at least one that does.
///
/// `compare` returns `Some(true)` when the pair differs only in this rule's
/// trivial way, `Some(false)` when the rule sees no difference, and `None` to
/// decline. Returns false the moment `compare` declines a pair, so an
/// unrecognized change is never trusted.
pub fn token_delta<F>(prepared: &[PreparedPair], compare: F) -> bool
where
    F: Fn(&Side, &Side) -> Option<bool>,
{
    let mut any_changed = false;
    for (old, new) in prepared {
        match compare(old, new) {
            None => return false, // a non-trivial token changed — a real edit
            Some(changed) => any_changed = any_changed || changed,
        }
    }
    any_changed
}
