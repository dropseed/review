//! Static hunk classifier using rule-based pattern matching.
//!
//! Detects easily-identifiable patterns (lockfiles, whitespace-only changes,
//! comment additions, import additions, etc.) without any external calls.
//!
//! Every rule is **default-deny**: it recognizes one specific trivial shape and
//! returns `None` for everything else, so an unrecognized change is shown,
//! never hidden. That bias is load-bearing here — a fresh review trusts every
//! pattern in the taxonomy, so a wrong label silently counts a real change as
//! reviewed.

use crate::classify::annotations::annotation_delta;
use crate::classify::delta::{
    paired_changed_lines, prepare_pairs, token_delta, PreparedPair, Side,
};
use crate::classify::linescan::{
    bracket_delta, code_bracket_balance, collapse_ws, collapse_ws_outside_strings, consume_string,
    find_line_comment, has_line_comment, has_unterminated_string, join_crosses_string,
    leading_indent, scan_string, slice_text, strip_inline_comment,
};
use crate::classify::tokens::{
    is_close_bracket, matching_close, tokens_differ, Dialect, Token, TokenKind, OPEN_BRACKETS,
};
use crate::classify::{ClassificationResult, ClassifyResponse};
use crate::diff::parser::{DiffHunk, DiffLine, LineType};
use std::borrow::Cow;
use std::cell::OnceCell;
use std::collections::{BTreeSet, HashMap};

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
///
/// Order matters: cheapest / most-specific first, first match wins.
/// Default-deny keeps the rules from fighting — each declines anything outside
/// its shape — but ordering still resolves the few honest overlaps.
/// `classify_whitespace` precedes `classify_line_length`/`classify_style` (a
/// blank-only change is not a wrap or a quote swap), and style/spacing precede
/// comments (a line whose code differs only in a quote and whose comment also
/// changed reads as style; a comment-only change token-matches under both,
/// declines, and falls through). Style and spacing are disjoint — style needs
/// token texts to differ, spacing needs them equal — so their relative order is
/// free.
fn classify_single_hunk(hunk: &DiffHunk) -> Option<ClassificationResult> {
    let ctx = HunkContext::new(hunk);
    classify_moved(&ctx)
        .or_else(|| classify_lockfile(&ctx))
        .or_else(|| classify_empty_file(&ctx))
        .or_else(|| classify_whitespace(&ctx))
        .or_else(|| classify_line_length(&ctx))
        .or_else(|| classify_style(&ctx))
        .or_else(|| classify_spacing(&ctx))
        .or_else(|| classify_comments(&ctx))
        .or_else(|| classify_type_annotations(&ctx))
        .or_else(|| classify_imports(&ctx))
}

// --- The per-hunk context ---

/// Everything the rule chain derives from a hunk, derived at most once.
///
/// Half the chain wants the same few things — the changed lines split by side,
/// the changed lines paired up, those pairs tokenized — and recomputing them
/// per rule meant walking and lexing the same hunk up to four times. The line
/// splits are cheap enough to take eagerly; the pairing and tokenizing are not,
/// and stay lazy so a hunk the earlier (cheaper) rules already claimed never
/// pays for them.
struct HunkContext<'a> {
    hunk: &'a DiffHunk,
    /// the file's extension, without the dot
    ext: &'a str,
    /// which lexer the dialect-gated rules read this file under
    dialect: Dialect,
    changed: Vec<&'a DiffLine>,
    added: Vec<&'a DiffLine>,
    removed: Vec<&'a DiffLine>,
    pairs: OnceCell<Option<Vec<(&'a DiffLine, &'a DiffLine)>>>,
    prepared: OnceCell<Option<Vec<PreparedPair<'a>>>>,
    open_string: OnceCell<bool>,
}

impl<'a> HunkContext<'a> {
    fn new(hunk: &'a DiffHunk) -> Self {
        let mut changed = Vec::new();
        let mut added = Vec::new();
        let mut removed = Vec::new();
        for line in &hunk.lines {
            match line.line_type {
                LineType::Added => {
                    changed.push(line);
                    added.push(line);
                }
                LineType::Removed => {
                    changed.push(line);
                    removed.push(line);
                }
                LineType::Context => {}
            }
        }
        let ext = extension(&hunk.file_path);
        Self {
            hunk,
            ext,
            dialect: dialect_for(ext),
            changed,
            added,
            removed,
            pairs: OnceCell::new(),
            prepared: OnceCell::new(),
            open_string: OnceCell::new(),
        }
    }

    /// True when any line in the hunk — CONTEXT INCLUDED — ends inside a string
    /// literal that never closes.
    ///
    /// Then the hunk may sit inside a multi-line string whose opening delimiter
    /// is on a context line or above the hunk entirely, and the "code" the
    /// trivial-shape rules are reading is really string CONTENT. Respacing
    /// `Total:   42` to `Total: 42` inside a template literal changes the
    /// value; so does a blank line inside a docstring. No rule here can tell
    /// that from the same edit made to real code, so they all decline.
    fn spans_open_string(&self) -> bool {
        *self.open_string.get_or_init(|| {
            let prefixes = comment_prefixes(self.ext).unwrap_or(&[]);
            let quotes = string_quotes(self.ext);
            self.hunk
                .lines
                .iter()
                .any(|l| has_unterminated_string(&l.content, prefixes, quotes))
        })
    }

    /// The changed lines aligned into (old, new) pairs, or `None` if they don't
    /// align. Shared by every paired rule, tokenizing or not — so the
    /// open-string guard lives here, covering style, spacing, type-annotations,
    /// and the inline-comment fallback in one place.
    fn pairs(&self) -> Option<&[(&'a DiffLine, &'a DiffLine)]> {
        self.pairs
            .get_or_init(|| {
                if self.spans_open_string() {
                    return None;
                }
                paired_changed_lines(self.hunk)
            })
            .as_deref()
    }

    /// The pairs with the shared lexical gates applied and both sides
    /// tokenized, or `None` if the pairing or any gate declined.
    ///
    /// Every rule that reaches for this is gated to a language `dialect_for`
    /// maps exactly — Python, or the JS/TS family — so one dialect per hunk
    /// serves all of them.
    fn prepared(&self) -> Option<&[PreparedPair<'a>]> {
        self.prepared
            .get_or_init(|| prepare_pairs(self.pairs()?, self.dialect))
            .as_deref()
    }

    fn has_added(&self) -> bool {
        !self.added.is_empty()
    }

    fn has_removed(&self) -> bool {
        !self.removed.is_empty()
    }
}

// --- Shared helpers ---

/// The JS/TS family and the C family, named once. Several tables group these
/// languages together, and re-listing eight extensions per table is how the
/// lists drift apart.
const JS_TS_EXTS: &[&str] = &["js", "jsx", "ts", "tsx", "mjs", "mts", "cjs", "cts"];
const C_EXTS: &[&str] = &["c", "cc", "cpp", "cxx", "h", "hpp", "m", "mm"];

/// The deeply-tested core the content rules share: the JS/TS family + Python.
/// These have free-form whitespace (so a reflow is neutral) and use
/// `'`/`"`/`;`/`,` interchangeably enough for the style rule — and they're the
/// ones the corpus actually validates. Other brace languages (Go, Rust, Java,
/// C, …) are plausible but unverified per-language — add them here only with
/// test coverage. Data/markup (csv, tsv, yaml, md, …) stays out entirely: there
/// a newline, comma, or quote can be semantic, so these rules would hide real
/// changes.
fn is_core_content_language(ext: &str) -> bool {
    JS_TS_EXTS.contains(&ext) || ext == "py"
}

/// Formats whose extension carries a comment syntax but whose blank lines can
/// still be content — a line inside a YAML block scalar is part of the string.
const DATA_FORMATS: &[&str] = &["yml", "yaml", "toml"];

/// True for a file we read as CODE, where a blank line is inert. Having a
/// comment syntax is the proxy: prose and data (Markdown, JSON, CSV, plain
/// text) have none, so they never qualify, and the config formats that do are
/// excluded by name. Wider than [`is_core_content_language`] on purpose —
/// adding or removing a blank line means nothing in any language we can
/// recognize as code, whereas a reflow or a quote swap needs per-language
/// validation.
fn is_code_file(ext: &str) -> bool {
    (comment_prefixes(ext).is_some() || block_comment_delimiters(ext).is_some())
        && !DATA_FORMATS.contains(&ext)
}

/// The file's extension, without the dot. A dotfile with no stem (`.gitignore`)
/// has no extension.
fn extension(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => ext,
        _ => "",
    }
}

fn dialect_for(ext: &str) -> Dialect {
    if ext == "py" {
        Dialect::Py
    } else {
        Dialect::Ts
    }
}

/// `added`, `removed`, or `modified` based on which sides changed.
fn change_suffix(has_added: bool, has_removed: bool) -> Option<&'static str> {
    match (has_added, has_removed) {
        (true, true) => Some("modified"),
        (true, false) => Some("added"),
        (false, true) => Some("removed"),
        (false, false) => None,
    }
}

/// Wrapped in `Some` because every rule returns it straight out as its match.
#[allow(
    clippy::unnecessary_wraps,
    reason = "every caller returns this directly as a rule's Option result"
)]
fn labeled(label: &str, reasoning: &str) -> Option<ClassificationResult> {
    Some(ClassificationResult {
        label: vec![label.to_owned()],
        reasoning: reasoning.to_owned(),
    })
}

// --- Rule 0: Move pair detection (cheapest: single field check) ---

fn classify_moved(ctx: &HunkContext) -> Option<ClassificationResult> {
    if ctx.hunk.move_pair_id.is_some() {
        labeled(
            "move:code",
            "Hunk is part of a move pair (identical content moved between files)",
        )
    } else {
        None
    }
}

// --- Rule 1: Lockfile detection (path-based) ---

/// Package-manager lockfiles: regenerated by tooling, not hand-edited.
///
/// `go.sum` is the tool-generated checksum lock; `go.mod` is the editable
/// manifest (dependencies, replace directives, module path) — reviewer-relevant,
/// so it is deliberately absent.
///
/// NOTE: `filters::SKIP_PATTERNS` names four of these too, for a different
/// purpose — see the cross-reference there before changing either list.
const LOCKFILE_NAMES: &[&str] = &[
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "Cargo.lock",
    "Gemfile.lock",
    "poetry.lock",
    "go.sum",
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

fn classify_lockfile(ctx: &HunkContext) -> Option<ClassificationResult> {
    let path = &ctx.hunk.file_path;
    let filename = path.rsplit('/').next().unwrap_or(path);
    if LOCKFILE_NAMES.contains(&filename) {
        labeled("generated:lockfile", "File is a package manager lockfile")
    } else {
        None
    }
}

// --- Rule 2: New empty file detection ---

fn classify_empty_file(ctx: &HunkContext) -> Option<ClassificationResult> {
    // A brand-new file's hunk is `@@ -0,0 +1,N @@` in real git output: both the
    // old length AND the old line anchor are 0. A mid-file pure insertion (a
    // `-U0` diff) has old_count 0 but a nonzero anchor, and must not read as a
    // brand-new empty file.
    if ctx.hunk.old_count != 0 || ctx.hunk.old_start != 0 {
        return None;
    }
    // A brand-new file's hunk is all additions, so "empty" is just "all blank".
    if ctx.hunk.lines.iter().all(|l| l.content.trim().is_empty()) {
        labeled(
            "file:added-empty",
            "New empty file (no content or whitespace only)",
        )
    } else {
        None
    }
}

// --- Rule 3: Whitespace-only changes ---

fn classify_whitespace(ctx: &HunkContext) -> Option<ClassificationResult> {
    // In prose and data a blank line is content — a Markdown paragraph break, a
    // line inside a YAML block scalar — so only code files qualify.
    if !is_code_file(ctx.ext) {
        return None;
    }
    // ...and a blank line inside a multi-line string literal is part of the
    // string's value, which `spans_open_string` is what catches.
    if ctx.spans_open_string() {
        return None;
    }
    if !ctx.changed.is_empty() && ctx.changed.iter().all(|l| l.content.trim().is_empty()) {
        labeled(
            "formatting:whitespace",
            "All changed lines are empty or whitespace-only",
        )
    } else {
        None
    }
}

// --- Rule 4: Line-length changes (line wrapping / unwrapping) ---

/// Operators a wrapped line may end on. Together with an open bracket or a
/// trailing `\`, these are what make a line "continue" to the next — never an
/// identifier, value, closer, or `;`. That separates a real reflow from two
/// statements joined (a Python suite boundary, a JS ASI point), where the
/// newline is semantic and joining changes meaning.
const CONTINUATION_OPERATORS: &str = "=+-*/%<>&|^~,.:?";

fn is_continuation_char(c: char) -> bool {
    CONTINUATION_OPERATORS.contains(c) || OPEN_BRACKETS.contains(&c)
}

/// True if `lines` is one statement wrapped across lines: every break (all but
/// the last) sits inside an open bracket, ends with `\`, or ends on a
/// continuation operator. Otherwise the join crosses a statement boundary and
/// the newline is not neutral.
fn is_reflow(lines: &[&DiffLine]) -> bool {
    let mut depth = 0;
    for line in &lines[..lines.len().saturating_sub(1)] {
        let stripped = line.content.trim_end();
        depth += bracket_delta(&line.content);
        let continues = depth > 0
            || stripped.ends_with('\\')
            || stripped.chars().last().is_some_and(is_continuation_char);
        if !continues {
            return false;
        }
    }
    true
}

/// True when the hunk's changed lines form ONE deletions-then-additions block
/// with no context line inside it. A reflow rewraps one statement in place;
/// deletions that bracket a context line mean code crossed a statement
/// boundary, and joining the sides would compare a reordering as if it were a
/// rewrap.
fn contiguous_replacement(hunk: &DiffHunk) -> bool {
    let mut seen_deletion = false;
    let mut seen_addition = false;
    let mut done = false;
    for line in &hunk.lines {
        if line.line_type == LineType::Context {
            if seen_deletion || seen_addition {
                done = true;
            }
            continue;
        }
        if done {
            return false; // a second changed block — not one replacement
        }
        if line.line_type == LineType::Removed {
            if seen_addition {
                return false; // deletions after additions — interleaved blocks
            }
            seen_deletion = true;
        } else {
            seen_addition = true;
        }
    }
    true
}

/// The raw text of each line on one side, for the scanners that work on text
/// rather than diff structure.
fn line_texts<'a>(side: &[&'a DiffLine]) -> Vec<&'a str> {
    side.iter().map(|l| l.content.as_str()).collect()
}

/// Code wrapped/unwrapped across lines: identical content after joining.
fn classify_line_length(ctx: &HunkContext) -> Option<ClassificationResult> {
    // In data/markup a newline separates records, so joining two lines isn't
    // neutral.
    if !is_core_content_language(ctx.ext) || ctx.spans_open_string() {
        return None;
    }
    let (added, removed) = (&ctx.added, &ctx.removed);
    if added.is_empty() || removed.is_empty() {
        return None;
    }
    // Wrapping/unwrapping changes the line count; an equal-count edit is a
    // same-shape change (the style rule's job), not a reflow.
    if added.len() == removed.len() {
        return None;
    }
    // The joined comparison below flattens line positions, so it's only sound
    // when the change is one contiguous replacement — deletions bracketing a
    // context line would let moved code read as a neutral rewrap.
    if !contiguous_replacement(ctx.hunk) {
        return None;
    }
    // A neutral reflow requires every break on BOTH sides to be a continuation
    // (inside brackets / `\` / an operator). A break anywhere at statement level
    // means the newline is semantic (a Python suite, a JS ASI point).
    if !is_reflow(added) || !is_reflow(removed) {
        return None;
    }
    let (added_text, removed_text) = (line_texts(added), line_texts(removed));
    // A break INSIDE a multi-line string means the join splices the string's
    // value (interior newline -> space).
    if join_crosses_string(&added_text) || join_crosses_string(&removed_text) {
        return None;
    }
    // Indentation is semantic in Python (block scope); a reflow that also shifts
    // the statement's own indent is a dedent/indent, not a neutral wrap. Only
    // the FIRST line carries the statement's indent (continuation lines are
    // naturally re-indented), and the collapse below strips leading space.
    if leading_indent(&added[0].content) != leading_indent(&removed[0].content) {
        return None;
    }
    // A line comment runs to end-of-line, so joining a commented line with the
    // next drags the next line's code INTO the comment (`foo(a, // why` + `b)`
    // joins to a line where `b)` is comment text). Even when the joined texts
    // compare equal, that join is never neutral. A comment on the LAST line is
    // fine (nothing is joined after it), and block comments are fine.
    // Every core content language has line comments, so the `else` is
    // unreachable — and declining is the safe direction if that ever changes.
    let prefixes = comment_prefixes(ctx.ext)?;
    let quotes = string_quotes(ctx.ext);
    for side in [&added_text, &removed_text] {
        if side[..side.len() - 1]
            .iter()
            .any(|text| has_line_comment(text, prefixes, quotes))
        {
            return None;
        }
    }
    // Collapse only the whitespace *between* tokens — preserving string
    // interiors so a real edit inside a literal can't masquerade as a reflow.
    let join = |side: &[&str]| collapse_ws_outside_strings(&side.join(" "));
    let joined_added = join(&added_text);
    if !joined_added.is_empty() && joined_added == join(&removed_text) {
        labeled(
            "formatting:line-length",
            "Code wrapped or unwrapped across lines (identical content after joining)",
        )
    } else {
        None
    }
}

// --- Rule 5: Style changes (semicolons, quotes, trailing commas) ---

/// The value of a `'`/`"` string literal, delimiter-agnostic — so `'a'` and
/// `"a"` compare equal but a change to the *contents* does not. Delimiter
/// escapes are normalized; a backtick template literal is returned verbatim (its
/// semantics aren't delimiter-style).
fn string_value(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let Some(&quote) = chars.first() else {
        return text.to_owned();
    };
    if quote != '"' && quote != '\'' {
        return text.to_owned();
    }
    let inner: String = chars[1..chars.len().saturating_sub(1)].iter().collect();
    inner.replace(&format!("\\{quote}"), &quote.to_string())
}

/// A token key in which only *stylistic* differences collapse: quote-delimiter
/// style (strings compare by decoded value), plus a trailing `,`/`;` when
/// `collapse_comma`/`collapse_semicolon` say it is stylistic here. Everything
/// else — identifiers, operators, numbers, string *contents* — is compared
/// verbatim, so a real change survives.
///
/// Trailing punctuation isn't always stylistic: a Python trailing comma builds a
/// tuple (`(x,)`, `x = a,`, `a[1,]`), and a JS/TS trailing semicolon can be
/// ASI-load-bearing. In those cases the flag is false and the punctuation stays
/// in the key, so the change is never hidden as style.
fn style_key(
    tokens: &[Token],
    collapse_comma: bool,
    collapse_semicolon: bool,
) -> Vec<(bool, Cow<'_, str>)> {
    let n = tokens.len();
    let mut key = Vec::new();
    for (i, tok) in tokens.iter().enumerate() {
        let is_op = tok.kind == TokenKind::Op;
        if collapse_semicolon && is_op && tok.text == ";" && i == n - 1 {
            continue; // trailing semicolon
        }
        if collapse_comma && is_op && tok.text == "," {
            // A line-final comma is treated as a trailing comma (stylistic in
            // JS/TS). The one shape that isn't — a comma-separated declaration
            // written one per line (`let a = 1,` / `b = 2`) — is caught before
            // this runs by `comma_splits_declaration`, which clears
            // `collapse_comma` for the whole hunk.
            let before_closer = tokens
                .get(i + 1)
                .is_some_and(|next| next.kind == TokenKind::Op && is_close_bracket(&next.text));
            if i == n - 1 || before_closer {
                continue;
            }
        }
        // Tag string values so a literal can't collide with an identifier of the
        // same text (a `'foo'` -> `foo` change must stay visible).
        if tok.kind == TokenKind::Str {
            key.push((true, Cow::Owned(string_value(&tok.text))));
        } else {
            key.push((false, Cow::Borrowed(tok.text.as_str())));
        }
    }
    key
}

/// Compare one line pair: `Some(true)` if it differs ONLY in style (semicolons /
/// trailing commas / quote delimiters), `Some(false)` if token-identical, `None`
/// to decline (a non-style difference remains).
fn style_delta(
    old_tokens: &[Token],
    new_tokens: &[Token],
    collapse_comma: bool,
    collapse_semicolon: bool,
) -> Option<bool> {
    if style_key(old_tokens, collapse_comma, collapse_semicolon)
        != style_key(new_tokens, collapse_comma, collapse_semicolon)
    {
        return None; // a non-style difference remains
    }
    // Style-only iff the tokens themselves differ (a quote delimiter or trailing
    // punctuation). If the raw tokens match, any remaining difference is in a
    // comment or whitespace the tokenizer drops — not this rule's job.
    Some(tokens_differ(old_tokens, new_tokens))
}

/// Line-leading characters that, under JS/TS Automatic Semicolon Insertion,
/// continue the previous statement rather than start a new one. A leading `/` is
/// also a continuation (regex literal or division) but is handled separately,
/// since `//` and `/*` start comments, not statements.
const ASI_LEADERS: [char; 5] = ['(', '[', '`', '+', '-'];

/// True if `text` begins with a token that, under JS/TS ASI, attaches to the
/// previous line instead of starting a new statement.
fn continues_previous_line(text: &str) -> bool {
    let stripped = text.trim_start();
    let Some(first) = stripped.chars().next() else {
        return false;
    };
    if ASI_LEADERS.contains(&first) {
        return true;
    }
    // A leading `/` is a regex literal or division that continues the line above
    // — unless it opens a comment (`//`, `/*`), which is inert.
    first == '/' && !stripped.starts_with("//") && !stripped.starts_with("/*")
}

/// True if the hunk's new-file side has a statement line that continues the
/// previous non-blank line under JS/TS Automatic Semicolon Insertion. There,
/// adding or removing a trailing `;` on the line above merges or splits two
/// statements — a real behavior change — so the style rule must not treat that
/// `;` as stylistic. ASI ignores blank lines, so we compare against the last
/// non-blank line, not the strictly-adjacent one.
///
/// When only blank lines are visible after the last changed line, the statement
/// ASI would merge with sits past the context window — the scan can't prove the
/// `;` inert, so that counts as a hazard too. A hunk that ENDS on the changed
/// line is different: git always emits trailing context when lines exist, so
/// that's the end of the file and there is nothing to merge with.
fn asi_hazard(hunk: &DiffHunk) -> bool {
    let mut prev_nonblank = "";
    let mut last_nonblank_changed = false;
    let mut blanks_after = false;
    for line in &hunk.lines {
        if line.line_type == LineType::Removed {
            continue;
        }
        if !prev_nonblank.is_empty() && continues_previous_line(&line.content) {
            return true;
        }
        if line.content.trim().is_empty() {
            blanks_after = true;
        } else {
            prev_nonblank = &line.content;
            last_nonblank_changed = line.line_type == LineType::Added;
            blanks_after = false;
        }
    }
    last_nonblank_changed && blanks_after
}

/// Statement keywords whose header can be followed by an empty-statement body.
const CONTROL_FLOW_KEYWORDS: &[&str] = &["while", "if", "for", "else"];

/// True if the line's first word opens a control-flow statement.
///
/// A line-final `;` there is not punctuation, it is the BODY: `while (cond());`
/// spins doing nothing, while `while (cond())` makes the following line the
/// loop body. Dropping or adding that `;` rewrites control flow, so it is never
/// stylistic — cheap to check and worth declining the whole hunk over.
fn starts_control_flow(text: &str) -> bool {
    let word = text
        .trim_start()
        .split(|c: char| !(c.is_alphanumeric() || c == '_'))
        .next()
        .unwrap_or("");
    CONTROL_FLOW_KEYWORDS.contains(&word)
}

/// The first following line that exists on the new side of the file and isn't
/// blank — what a dropped line-final comma would (or wouldn't) absorb.
fn next_line_on_new_side<'a>(hunk: &'a DiffHunk, after: &DiffLine) -> Option<&'a str> {
    let idx = hunk.lines.iter().position(|l| std::ptr::eq(l, after))?;
    hunk.lines[idx + 1..]
        .iter()
        .filter(|l| l.line_type != LineType::Removed)
        .map(|l| l.content.as_str())
        .find(|content| !content.trim().is_empty())
}

/// True if `text` reads as the next declarator of a comma-separated
/// declaration: an identifier followed by `=` or `,`.
fn continues_declaration(text: &str) -> bool {
    let text = text.trim_start();
    let name_end = text
        .find(|c: char| !(c.is_alphanumeric() || c == '_' || c == '$'))
        .unwrap_or(text.len());
    if name_end == 0 {
        return false;
    }
    let rest = text[name_end..].trim_start();
    rest.starts_with(',')
        || (rest.starts_with('=') && !rest.starts_with("==") && !rest.starts_with("=>"))
}

/// True if a pair adds or drops a line-final `,` whose following line reads as
/// the next declarator of the same declaration.
///
/// `let a = 1,` / `b = 2;` declares both names; dropping the comma leaves `b =
/// 2` assigning to a global (or throwing in strict mode), and adding one pulls
/// `b` into the declaration. Either way the binding of `b` changed, so the
/// comma was never stylistic. The following line IS visible here — it's just
/// further along `hunk.lines` — so this is checked rather than assumed away.
fn comma_splits_declaration(hunk: &DiffHunk, prepared: &[PreparedPair]) -> bool {
    prepared.iter().any(|(old, new)| {
        let old_comma = old.line.content.trim_end().ends_with(',');
        let new_comma = new.line.content.trim_end().ends_with(',');
        old_comma != new_comma
            && next_line_on_new_side(hunk, new.line).is_some_and(continues_declaration)
    })
}

/// Paired lines that differ only in semicolons, quotes, or trailing commas.
fn classify_style(ctx: &HunkContext) -> Option<ClassificationResult> {
    // Elsewhere `;`/`,`/quotes may be semantic (data files, char literals).
    if !is_core_content_language(ctx.ext) {
        return None;
    }
    // The pairing and tokenizing gates run first, so the O(hunk-lines) ASI scan
    // below never runs for hunks those would reject anyway.
    let prepared = ctx.prepared()?;
    // A Python trailing comma builds a tuple. In JS/TS one is stylistic unless
    // dropping it would move the next declarator out of the declaration.
    let collapse_comma = ctx.ext != "py" && !comma_splits_declaration(ctx.hunk, prepared);
    // Python has no ASI, so its `;` is always stylistic; in JS/TS a trailing `;`
    // is only stylistic when no following line continues the statement. In
    // either language a `;` closing a control-flow header is the body, not
    // punctuation.
    let control_flow = prepared.iter().any(|(old, new)| {
        starts_control_flow(&old.line.content) || starts_control_flow(&new.line.content)
    });
    let collapse_semicolon = !control_flow && (ctx.ext == "py" || !asi_hazard(ctx.hunk));
    let matched = token_delta(prepared, |old, new| {
        style_delta(&old.tokens, &new.tokens, collapse_comma, collapse_semicolon)
    });
    if matched {
        labeled(
            "formatting:style",
            "Only punctuation changed (semicolons, quote style, or trailing commas)",
        )
    } else {
        None
    }
}

// --- Rule 6: Inter-token spacing ---

/// True if everything between consecutive tokens is whitespace. The tokenizer
/// silently skips block comments, so without this check a mid-line `/* … */`
/// edit would compare token-identical and read as a spacing change.
fn whitespace_gaps_only(stripped: &[char], tokens: &[Token]) -> bool {
    let mut pos = 0;
    for tok in tokens {
        if stripped[pos..tok.start].iter().any(|c| !c.is_whitespace()) {
            return false;
        }
        pos = tok.end;
    }
    true
}

/// The text after the last token — a trailing line comment, or empty.
fn line_tail(stripped: &[char], tokens: &[Token]) -> String {
    let start = tokens.last().map_or(0, |t| t.end);
    stripped[start..]
        .iter()
        .collect::<String>()
        .trim()
        .to_owned()
}

/// In JS/TS, spacing around `/`, `<`, and `>` decides how a line parses (regex
/// vs division, generic vs comparison), so a regrouping around them is never
/// just spacing.
fn is_js_ambiguous(text: &str) -> bool {
    matches!(text, "/" | "<" | ">")
}

/// Compare one line pair: `Some(true)` if only the whitespace between or after
/// the tokens moved, `Some(false)` if the lines are identical, `None` to decline
/// (something other than inter-token whitespace changed).
fn spacing_delta(old: &Side, new: &Side, dialect: Dialect) -> Option<bool> {
    if tokens_differ(&old.tokens, &new.tokens) {
        return None; // a token changed — not a whitespace-only edit
    }
    if !whitespace_gaps_only(&old.stripped, &old.tokens)
        || !whitespace_gaps_only(&new.stripped, &new.tokens)
    {
        return None; // a mid-line block comment sits in a gap
    }
    if line_tail(&old.stripped, &old.tokens) != line_tail(&new.stripped, &new.tokens) {
        return None; // the trailing comment changed — the comments rule's territory
    }
    for (o, n) in old.tokens.windows(2).zip(new.tokens.windows(2)) {
        let (o1, o2) = (&o[0], &o[1]);
        let (n1, n2) = (&n[0], &n[1]);
        if (o1.end == o2.start) == (n1.end == n2.start) {
            continue; // this pair's grouping didn't change
        }
        if (o1.kind == TokenKind::Op) == (o2.kind == TokenKind::Op) {
            return None; // regrouped punctuation / word+string — semantic
        }
        if dialect == Dialect::Ts && (is_js_ambiguous(&o1.text) || is_js_ambiguous(&o2.text)) {
            return None; // regex / generic ambiguity — spacing decides the parse
        }
    }
    Some(old.line.content != new.line.content)
}

/// Paired lines whose tokens are identical and only the whitespace between or
/// after them moved — `x=1` -> `x = 1`, `f( a )` -> `f(a)`, trailing-whitespace
/// trims, alignment shifts.
///
/// Whitespace inside a string literal is a value change and never qualifies
/// (string tokens compare verbatim). Two default-deny guards beyond the shared
/// gates: regrouping punctuation is semantic even with identical token texts
/// (`a + +b` vs `a ++ b`, `a ** b` vs `a * * b`), as is gluing a word to a
/// string (`f "x"` vs f-string `f"x"`); and the text the tokenizer drops (a
/// trailing comment, an interior block comment) must be unchanged, or a comment
/// edit would read as spacing.
fn classify_spacing(ctx: &HunkContext) -> Option<ClassificationResult> {
    if !is_core_content_language(ctx.ext) {
        return None;
    }
    let prepared = ctx.prepared()?;
    let matched = token_delta(prepared, |old, new| spacing_delta(old, new, ctx.dialect));
    if matched {
        labeled(
            "formatting:spacing",
            "Tokens are identical; only the whitespace between them moved",
        )
    } else {
        None
    }
}

// --- Rule 7: Comment-only changes ---

/// Maps file extension to line-comment prefixes.
///
/// CSS is deliberately absent — it has no `//` line comment (only `/* */`), and
/// a `//` in a CSS value (a protocol-relative `url(//cdn/…)`) would otherwise
/// read as a comment and hide a real value change.
fn comment_prefixes(ext: &str) -> Option<&'static [&'static str]> {
    if JS_TS_EXTS.contains(&ext) || C_EXTS.contains(&ext) {
        return Some(&["//"]);
    }
    match ext {
        "rs" | "go" | "java" | "kt" | "kts" | "scala" | "swift" | "cs" | "zig" | "v" | "dart"
        | "groovy" | "gradle" => Some(&["//"]),
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
    if JS_TS_EXTS.contains(&ext) || C_EXTS.contains(&ext) {
        return Some(("/*", "*/"));
    }
    match ext {
        // The rest of the C-family block-comment languages, plus CSS.
        "rs" | "go" | "java" | "kt" | "kts" | "scala" | "swift" | "cs" | "zig" | "v" | "dart"
        | "groovy" | "gradle" | "css" => Some(("/*", "*/")),
        // HTML/XML block comments
        "html" | "xml" | "svg" => Some(("<!--", "-->")),
        _ => None,
    }
}

/// Languages whose strings can be backtick-delimited (JS/TS template literals,
/// Go raw strings) — without this a `//` inside one reads as a comment.
fn string_quotes(ext: &str) -> &'static str {
    if JS_TS_EXTS.contains(&ext) || ext == "go" {
        "\"'`"
    } else {
        "\"'"
    }
}

/// Comments that DIRECT TOOLS rather than inform readers: linter suppressions,
/// type-checker escapes, formatter/coverage toggles, compiler and bundler
/// pragmas. Changing one changes how tools treat the surrounding code — a real
/// edit, not comment churn — so a changed comment containing any of these is
/// never trusted. Matched case-insensitively as substrings, deliberately loose:
/// a prose comment that merely *mentions* a marker declines too, which only
/// costs coverage (the hunk is shown), never hides a change.
const DIRECTIVE_MARKERS: &[&str] = &[
    // Python
    "noqa",         // flake8/ruff suppression
    "pylint:",      // pylint suppression/config
    "nopep8",       // pep8/autopep8 suppression
    "skipcq",       // DeepSource suppression
    "type: ignore", // mypy/pyright escape
    "pragma:",      // coverage.py (pragma: no cover)
    "doctest:",     // doctest directive (e.g. doctest: +SKIP)
    "fmt:",         // black/ruff formatter toggles (fmt: off/on/skip)
    "yapf:",        // yapf formatter toggle
    "ruff:",
    "mypy:",
    "pyright:",
    "pyre-",   // Meta's Pyre type checker (pyre-ignore/pyre-fixme)
    "pytype:", // Google's pytype type checker
    "isort:",
    "nosec",   // bandit
    "coding:", // PEP 263 encoding declaration
    "coding=",
    // JS/TS
    "eslint-", // eslint-disable / -enable / -disable-next-line / -disable-line
    "@ts-",    // @ts-ignore / @ts-expect-error / @ts-nocheck / @ts-check
    "prettier-ignore",
    "biome-ignore",
    "istanbul ignore",
    "c8 ignore",
    "v8 ignore",
    "sourcemappingurl", // //# sourceMappingURL=…
    "webpack",          // webpack magic comments (webpackChunkName, webpackMode)
    // Go
    "go:build",
    "go:generate",
    "go:embed",
    "+build",
    "nolint", // golangci-lint; also covers clang-tidy's NOLINT
    // Ruby
    "rubocop:",
    "frozen_string_literal",
    "typed:", // sorbet
    // Shell
    "shellcheck",
    // C/C++
    "clang-format",
];

fn has_directive(text: &str) -> bool {
    let lowered = text.to_lowercase();
    DIRECTIVE_MARKERS
        .iter()
        .any(|marker| lowered.contains(marker))
}

/// A `#!` interpreter line at file line 1 — execution semantics, not a comment
/// (deeper in a file, `#!` is just comment text).
fn is_shebang(line: &DiffLine) -> bool {
    line.content.starts_with("#!")
        && (line.old_line_number == Some(1) || line.new_line_number == Some(1))
}

/// Whether *all* of `text` is block comment, and the new in-block state.
///
/// Walks the line so that code trailing a closed comment (`/* note */ run()`) is
/// recognized as code, not swallowed by the comment.
fn block_comment_step(text: &str, delimiters: (&str, &str), in_block: bool) -> (bool, bool) {
    let (open, close) = delimiters;
    let mut text = text.trim();
    let mut in_block = in_block;
    loop {
        if in_block {
            match text.find(close) {
                None => return (true, true), // comment runs on to the next line
                Some(end) => {
                    text = text[end + close.len()..].trim();
                    in_block = false;
                }
            }
        } else if text.is_empty() {
            return (true, false); // nothing but comment(s) on this line
        } else if let Some(rest) = text.strip_prefix(open) {
            text = rest;
            in_block = true;
        } else {
            return (false, false); // real code on this line
        }
    }
}

/// True if every changed, non-blank line on ONE side of the file is a line or
/// block comment.
///
/// `changed` names that side: the walk reads the hunk as that side's file
/// (context lines plus that side's changes, in order), so block-comment state
/// is tracked the way the file actually reads.
///
/// A block comment opened on a changed line must close before the next context
/// line: if it's still open there, the unchanged code on that context line is
/// now INSIDE the comment — code commented out is a semantic change, not comment
/// churn. The same reasoning closes the bottom of the hunk.
fn all_comment_lines(
    lines: &[DiffLine],
    changed: &LineType,
    prefixes: Option<&[&str]>,
    block: Option<(&str, &str)>,
) -> bool {
    let mut in_block = false;
    for line in lines {
        if line.line_type != *changed {
            if line.line_type != LineType::Context {
                continue; // the other side's line — not in this side's file at all
            }
            if in_block {
                return false; // a changed `/*` swallows this unchanged code
            }
            continue;
        }
        let text = line.content.trim();
        if text.is_empty() {
            continue;
        }
        if !in_block {
            if let Some(prefixes) = prefixes {
                if prefixes.iter().any(|p| text.starts_with(p)) {
                    continue;
                }
            }
        }
        if let Some(delimiters) = block {
            let (is_comment, next_in_block) = block_comment_step(text, delimiters, in_block);
            in_block = next_in_block;
            if is_comment {
                continue;
            }
        }
        return false;
    }
    !in_block
}

/// Label hunks where paired lines differ only in their inline comments.
///
/// Raw-string based rather than tokenized: comments span ~40 languages the
/// tokenizer doesn't model, so this shares only the pairing gate.
fn inline_comment_change(
    ctx: &HunkContext,
    prefixes: &[&str],
    quotes: &str,
) -> Option<ClassificationResult> {
    let mut old_has_comment = false;
    let mut new_has_comment = false;
    for (old, new) in ctx.pairs()? {
        let old_code = strip_inline_comment(&old.content, prefixes, quotes);
        let new_code = strip_inline_comment(&new.content, prefixes, quotes);
        // Compare the code and its leading indentation (semantic in Python), so
        // a re-indent of a commented line isn't mistaken for a comment-only
        // edit. `strip_inline_comment` trims, so the code can't begin with
        // whitespace and the two comparisons can't trade off against each other.
        if old_code.is_empty()
            || old_code != new_code
            || leading_indent(&old.content) != leading_indent(&new.content)
        {
            return None; // the code (or its indentation) changed, not just a comment
        }
        // The comment remainders (whatever strip_inline_comment dropped). A tool
        // directive in either one means tool behavior changed, not prose.
        let old_comment = &old.content.trim()[old_code.len()..];
        let new_comment = &new.content.trim()[new_code.len()..];
        if has_directive(old_comment) || has_directive(new_comment) {
            return None;
        }
        old_has_comment = old_has_comment || !old_comment.is_empty();
        new_has_comment = new_has_comment || !new_comment.is_empty();
    }
    let label = format!(
        "comments:{}",
        change_suffix(new_has_comment, old_has_comment)?
    );
    labeled(&label, "Only inline comments changed; code is identical")
}

fn classify_comments(ctx: &HunkContext) -> Option<ClassificationResult> {
    let prefixes = comment_prefixes(ctx.ext);
    let block = block_comment_delimiters(ctx.ext);
    if prefixes.is_none() && block.is_none() {
        return None;
    }
    // A comment marker inside a multi-line string is string content, not a
    // comment — and a `/*` there opens nothing.
    if ctx.spans_open_string() {
        return None;
    }
    if ctx.changed.is_empty() {
        return None;
    }
    // Blank lines carry no comment. Without this a blank-line-only change in a
    // language outside the whitespace rule's gate would fall through to here and
    // read as "comments:added", naming something that isn't there.
    if ctx.changed.iter().all(|l| l.content.trim().is_empty()) {
        return None;
    }
    // A shebang selects the interpreter the file runs under — an execution
    // change that happens to be spelled in comment syntax.
    if ctx.changed.iter().any(|l| is_shebang(l)) {
        return None;
    }

    let lines = &ctx.hunk.lines;
    if all_comment_lines(lines, &LineType::Added, prefixes, block)
        && all_comment_lines(lines, &LineType::Removed, prefixes, block)
    {
        // Every changed line is a comment, so scan them whole for directives.
        if ctx.changed.iter().any(|l| has_directive(&l.content)) {
            return None;
        }
        let label = format!(
            "comments:{}",
            change_suffix(ctx.has_added(), ctx.has_removed())?
        );
        return labeled(&label, "All changed lines are comments");
    }

    // Fallback: paired lines whose only difference is a trailing inline comment.
    prefixes.and_then(|prefixes| inline_comment_change(ctx, prefixes, string_quotes(ctx.ext)))
}

// --- Rule 8: Type annotation changes ---

/// Paired lines whose entire token-level delta is type annotations.
///
/// Narrower than the style/reflow core: only the languages the tokenizer models
/// with an annotation grammar (see `annotations.rs` for the span detectors).
fn classify_type_annotations(ctx: &HunkContext) -> Option<ClassificationResult> {
    if !matches!(ctx.ext, "py" | "ts" | "tsx") {
        return None;
    }
    let prepared = ctx.prepared()?;
    let matched = token_delta(prepared, |old, new| annotation_delta(old, new, ctx.dialect));
    if matched {
        labeled(
            "type-annotations:modified",
            "Every changed token lies inside a type annotation",
        )
    } else {
        None
    }
}

// --- Rule 9: Import-only changes ---

/// Everything the import scanners need to read one language's lines: the
/// statement prefixes, the bracket pair a multi-line import spans (`None` for
/// single-line-only languages), and that language's comment/string syntax —
/// without which a bracket in a comment or a string would be counted as real.
struct ImportSyntax {
    prefixes: &'static [&'static str],
    bracket: Option<(char, char)>,
    comments: &'static [&'static str],
    quotes: &'static str,
}

/// `export { … }` is intentionally absent from the JS/TS entry: adding or
/// removing an export changes the module's public API and must stay visible for
/// review, unlike an import.
fn import_config(ext: &str) -> Option<ImportSyntax> {
    let (prefixes, open): (&'static [&'static str], Option<char>) = if JS_TS_EXTS.contains(&ext) {
        (&["import ", "import{"], Some('{'))
    } else if C_EXTS.contains(&ext) {
        (&["#include"], None)
    } else {
        match ext {
            "py" => (&["import ", "from "], Some('(')),
            "go" => (&["import "], Some('(')),
            "rs" => (&["use "], Some('{')),
            "java" | "kt" | "kts" | "scala" | "groovy" | "gradle" | "swift" | "dart" => {
                (&["import "], None)
            }
            "rb" => (&["require ", "require_relative "], None),
            "cs" => (&["using "], None),
            _ => return None,
        }
    };
    Some(ImportSyntax {
        prefixes,
        // Every bracket the tables name is a real one, so the `None` is unreachable.
        bracket: open.and_then(|o| matching_close(o).map(|c| (o, c))),
        comments: comment_prefixes(ext).unwrap_or(&[]),
        quotes: string_quotes(ext),
    })
}

impl ImportSyntax {
    /// This line with any trailing comment removed — what the bracket and shape
    /// checks below reason about.
    fn code_of<'t>(&self, text: &'t str) -> &'t str {
        let chars: Vec<char> = text.chars().collect();
        match find_line_comment(&chars, self.comments, self.quotes, false) {
            // The comment start is a char index; map it back to a byte index by
            // counting the same prefix.
            Some(i) => text[..chars[..i].iter().map(|c| c.len_utf8()).sum::<usize>()].trim_end(),
            None => text,
        }
    }

    fn balance(&self, text: &str) -> i32 {
        match self.bracket {
            Some((open, close)) => {
                code_bracket_balance(text, open, close, self.comments, self.quotes)
            }
            None => 0,
        }
    }
}

/// True if a `;` separates more code, e.g. `import x; doThing()`.
///
/// A lone import ends at most with a trailing `;`; anything after the first one
/// is a second statement we must not hide as import churn.
fn has_trailing_statement(text: &str) -> bool {
    match text.find(';') {
        Some(idx) => !text[idx + 1..].trim().is_empty(),
        None => false,
    }
}

/// A JS/TS dynamic `import(...)` call — `import` followed (after optional space)
/// by `(`. It's executable code (lazy/conditional loading), not a static import
/// declaration, so it must not be hidden as import churn.
fn is_dynamic_import(text: &str) -> bool {
    text.strip_prefix("import")
        .is_some_and(|rest| rest.trim_start().starts_with('('))
}

fn is_import_line(content: &str, prefixes: &[&str]) -> bool {
    let stripped = content.trim();
    !stripped.is_empty()
        && prefixes.iter().any(|p| stripped.starts_with(p))
        && !has_trailing_statement(stripped)
        && !is_dynamic_import(stripped)
}

/// Inside a multi-line import's brackets, a line must still READ as part of an
/// import list — a member, an alias, a quoted spec (Go), a nested group, or the
/// closer. No import list in any configured language contains an assignment or a
/// call, so either one means executable code that must not be hidden as import
/// churn. A line that is nothing but a comment is fine.
fn is_import_continuation(code: &str, quotes: &str) -> bool {
    let code = code.trim();
    if code.is_empty() {
        return true; // a comment-only line inside the brackets
    }
    let starts_like_a_member = code.starts_with(|c: char| {
        c.is_alphanumeric() || matches!(c, '_' | '*' | ',' | '"' | '\'' | '{' | '}' | '(' | ')')
    });
    if !starts_like_a_member {
        return false;
    }
    let chars: Vec<char> = code.chars().collect();
    let mut i = 0;
    let mut after_name = false;
    while i < chars.len() {
        let ch = chars[i];
        if quotes.contains(ch) {
            i = consume_string(&chars, i);
            after_name = false;
            continue;
        }
        if ch == '=' {
            return false; // an assignment or a default value
        }
        if ch == '(' && after_name {
            return false; // a call
        }
        after_name = ch.is_alphanumeric() || ch == '_';
        i += 1;
    }
    true
}

/// True if this side is entirely import statements (handling multi-line).
fn imports_only(lines: &[&DiffLine], syntax: &ImportSyntax) -> bool {
    let Some(_) = syntax.bracket else {
        return lines
            .iter()
            .all(|l| l.content.trim().is_empty() || is_import_line(&l.content, syntax.prefixes));
    };

    let mut depth = 0i32;
    for line in lines {
        let text = line.content.trim();
        if text.is_empty() {
            continue;
        }
        // A JS/TS dynamic `import(...)` call is executable code, not a static
        // import. Skipped for `(`-bracket languages (Go), where `import (` opens
        // a grouped import rather than a call.
        if syntax.bracket != Some(('(', ')')) && is_dynamic_import(text) {
            return false;
        }
        // No import line — including the one that closes a multi-line import
        // (which starts at depth > 0) — may carry a trailing statement, or the
        // executable code after the `;` would be hidden as import churn.
        if has_trailing_statement(text) {
            return false;
        }
        let code = syntax.code_of(text);
        if depth == 0 {
            // Outside a bracketed block, every line must start a new import.
            if !syntax.prefixes.iter().any(|p| text.starts_with(p)) {
                return false;
            }
        } else if !is_import_continuation(code, syntax.quotes) {
            // Inside one, it must still look like an import list.
            return false;
        }
        depth += syntax.balance(text);
        if depth < 0 {
            return false;
        }
    }
    depth == 0
}

/// The full import statements on this side, sorted — a bracket-spanned
/// multi-line import is joined into one string so it compares by its complete
/// text (members included), not just its opening line.
fn sorted_imports(lines: &[&DiffLine], syntax: &ImportSyntax) -> Vec<String> {
    let mut statements: Vec<String> = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    let mut depth = 0i32;
    for line in lines {
        let text = line.content.trim();
        if text.is_empty() {
            continue;
        }
        current.push(text);
        depth += syntax.balance(text);
        if depth <= 0 {
            // statement complete (single-line, or the closing bracket)
            statements.push(collapse_ws(&current.join(" ")));
            current.clear();
            depth = 0;
        }
    }
    if !current.is_empty() {
        // an unclosed trailing group (defensive; shouldn't occur)
        statements.push(collapse_ws(&current.join(" ")));
    }
    statements.sort();
    statements
}

/// A JS/TS side-effect import — `import 'spec';` — binds no names. Unlike
/// `import x from 'spec'`, its only purpose is running the module's top-level
/// code, so two of them can depend on running in a particular order even though
/// the *set* of specifiers is unchanged.
fn is_side_effect_import(statement: &str) -> bool {
    statement
        .strip_prefix("import")
        .is_some_and(|rest| rest.trim_start().starts_with(['\'', '"']))
}

/// A Go blank import — `_ "pkg"` — imports a package purely to run its `init()`.
/// Like a JS side-effect import, its position relative to other blank imports
/// can be load-bearing.
fn is_go_blank_import(statement: &str) -> bool {
    let bytes = statement.as_bytes();
    statement.match_indices('_').any(|(idx, _)| {
        let standalone =
            idx == 0 || !(bytes[idx - 1].is_ascii_alphanumeric() || bytes[idx - 1] == b'_');
        standalone && statement[idx + 1..].trim_start().starts_with(['"', '`'])
    })
}

/// Whether reordering these (already-confirmed-identical-as-a-set) import
/// statements is trustworthy, by language.
///
/// An allowlist, not a denylist: reordering imports is only inert where we have
/// actually reasoned about the language's semantics, and the default for
/// everything else is to show the change — the same posture
/// `same_import_sources` takes on languages it can't parse.
///
/// - Python: trusted. Import order is inert, and isort churn is the bread-and-
///   butter case for this label.
/// - JS/TS: trusted unless a bare side-effect import is among the reordered
///   lines.
/// - Go: trusted unless a blank import (`_ "pkg"`) is among them.
/// - C/C++/Obj-C `#include`: never — an include can define macros or drive
///   conditional compilation that a later one depends on.
/// - Everything else (Ruby `require`, Rust `use`, Java, C#, …): declined. A Ruby
///   `require` executes the target file, and we have not verified the rest.
fn reorder_is_trivial(statements: &[String], ext: &str) -> bool {
    if ext == "py" {
        return true;
    }
    if JS_TS_EXTS.contains(&ext) {
        return !statements.iter().any(|s| is_side_effect_import(s));
    }
    if ext == "go" {
        return !statements.iter().any(|s| is_go_blank_import(s));
    }
    false
}

/// Every `NAME as ALIAS` binding in an import statement, sorted.
///
/// An alias names what the import binds LOCALLY, so `import numpy as np` ->
/// `import numpy as pd` rebinds every use of `np` in the file even though the
/// module is untouched. Splitting on the punctuation that separates specifiers
/// works for both Python and JS/TS name lists.
fn alias_bindings(statement: &str) -> Vec<String> {
    let words: Vec<&str> = statement
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | '(' | ')' | '{' | '}' | ';'))
        .filter(|w| !w.is_empty())
        .collect();
    let mut bindings: Vec<String> = words
        .windows(3)
        .filter(|w| w[1] == "as")
        .map(|w| format!("{} as {}", w[0], w[2]))
        .collect();
    bindings.sort();
    bindings
}

/// Every module a Python import statement pulls from. `import os, sys` names
/// two, and comparing only the first would call a swap of the second trivial.
fn py_modules(statement: &str) -> Option<Vec<String>> {
    if let Some(rest) = statement.strip_prefix("from ") {
        let module = match rest.find(" import") {
            Some(idx) => &rest[..idx],
            None => rest,
        };
        let module = module.trim();
        return (!module.is_empty()).then(|| vec![module.to_owned()]);
    }
    let rest = statement.strip_prefix("import ")?;
    let mut modules: Vec<String> = rest
        .split(',')
        .filter_map(|item| {
            item.trim()
                .trim_end_matches(';')
                .split_whitespace()
                .next()
                .map(str::to_owned)
        })
        .filter(|m| !m.is_empty())
        .collect();
    modules.sort();
    (!modules.is_empty()).then_some(modules)
}

/// The module path a JS/TS import resolves.
fn js_import_module(statement: &str) -> Option<String> {
    if let Some(source) = quoted_after(statement, "from") {
        return Some(source);
    }
    // No `from` clause: a bare side-effect import, where the quoted spec itself
    // IS the source (`import 'spec';`).
    quoted_at_start(statement.strip_prefix("import")?.trim_start())
}

/// A canonical identity for one import statement, or `None` when we can't
/// confidently parse it (fail safe: an unparsed statement must not be treated as
/// matching another one).
///
/// The key covers everything except WHICH NAMES are pulled in — the modules, the
/// local aliases, and for JS/TS whether the import is type-only. Two statements
/// with the same key differ at most in their name list, which is the one edit
/// `imports:modified` exists to describe.
fn import_key(statement: &str, ext: &str) -> Option<String> {
    let aliases = alias_bindings(statement).join(",");
    if ext == "py" {
        return Some(format!("{}|{aliases}", py_modules(statement)?.join(",")));
    }
    if JS_TS_EXTS.contains(&ext) {
        // A type-only import erases at compile time; flipping the flag changes
        // whether the module is required at runtime at all.
        let kind = if statement.starts_with("import type ") || statement.starts_with("export type ")
        {
            "type"
        } else {
            "value"
        };
        return Some(format!("{kind}|{}|{aliases}", js_import_module(statement)?));
    }
    if C_EXTS.contains(&ext) {
        let start = statement.find(['"', '<'])?;
        let rest = &statement[start + 1..];
        let end = rest.find(['"', '>'])?;
        return (end > 0).then(|| rest[..end].to_owned());
    }
    None
}

/// The contents of the first quoted string that follows an occurrence of
/// `keyword` (optional whitespace between).
fn quoted_after(statement: &str, keyword: &str) -> Option<String> {
    let mut search = 0;
    while let Some(rel) = statement[search..].find(keyword) {
        let at = search + rel;
        if let Some(found) = quoted_at_start(statement[at + keyword.len()..].trim_start()) {
            return Some(found);
        }
        search = at + 1;
    }
    None
}

/// The DECODED contents of a quoted string starting at position 0 of `text`.
///
/// Scanned with the shared string scanner so an escaped delimiter can't end the
/// literal early: `'a\'b'` is one source named `a'b`, not the fragment `a\`.
/// Truncating there would make two different sources compare equal, and a
/// module swap between them would be trusted as import churn.
fn quoted_at_start(text: &str) -> Option<String> {
    let chars: Vec<char> = text.chars().collect();
    let quote = *chars.first()?;
    if quote != '\'' && quote != '"' {
        return None;
    }
    let close = scan_string(&chars, 0)?;
    Some(string_value(&slice_text(&chars, 0, close)))
}

/// True only if every added and removed import statement resolves to the same
/// set of import keys — i.e. the hunk adds/removes NAMES within an unchanged set
/// of modules, aliases, and type flags, rather than swapping any of those.
fn same_import_bindings(added: &[String], removed: &[String], ext: &str) -> bool {
    // Languages `import_key` can parse. For the rest we can't tell a name-only
    // edit from a module swap — e.g. Ruby `require 'safe'` -> `require 'evil'`,
    // which executes a different file — so decline (show it) rather than trust
    // the swap blindly. Pure add/remove/reorder still label via their own paths.
    if ext != "py" && !JS_TS_EXTS.contains(&ext) && !C_EXTS.contains(&ext) {
        return false;
    }
    let keys = |statements: &[String]| -> Option<BTreeSet<String>> {
        // A statement we couldn't parse is a hard stop — fail safe, don't trust.
        statements.iter().map(|s| import_key(s, ext)).collect()
    };
    match (keys(added), keys(removed)) {
        (Some(a), Some(r)) => a == r,
        _ => false,
    }
}

fn classify_imports(ctx: &HunkContext) -> Option<ClassificationResult> {
    let syntax = import_config(ctx.ext)?;
    let (added, removed) = (&ctx.added, &ctx.removed);
    if added.is_empty() && removed.is_empty() {
        return None;
    }
    // A blank-line-only change names no import. Without this the all-lines-are-
    // imports checks below pass vacuously and a bare blank line reads as
    // `imports:added`.
    if ctx.changed.iter().all(|l| l.content.trim().is_empty()) {
        return None;
    }
    // `from __future__ import …` is a compiler directive, not a plain import:
    // adding one changes the whole module's semantics, and moving one below
    // another import is a SyntaxError — never trivial, so decline the hunk.
    if ctx.changed.iter().any(|l| l.content.contains("__future__")) {
        return None;
    }
    if !imports_only(added, &syntax) || !imports_only(removed, &syntax) {
        return None;
    }

    // Both sides non-empty is exactly the "modified" case, and the only one that
    // needs the statements parsed out — so they're built once, here.
    if !added.is_empty() && !removed.is_empty() {
        let added_statements = sorted_imports(added, &syntax);
        let removed_statements = sorted_imports(removed, &syntax);
        if !added_statements.is_empty() && added_statements == removed_statements {
            // Same statements, different order. Whether that's trustworthy
            // depends on the language — if not, decline outright rather than
            // falling through to the binding check below, which would trivially
            // pass a same-statement reorder.
            if !reorder_is_trivial(&added_statements, ctx.ext) {
                return None;
            }
            return labeled(
                "imports:reordered",
                "Import statements were reordered (same set of imports)",
            );
        }
        // A "modified" hunk is only trustworthy when it adds/removes names
        // within the same modules, aliases, and type flags.
        if !same_import_bindings(&added_statements, &removed_statements, ctx.ext) {
            return None;
        }
        return labeled(
            "imports:modified",
            "All changed lines are import statements",
        );
    }

    let suffix = change_suffix(ctx.has_added(), ctx.has_removed())?;
    labeled(
        &format!("imports:{suffix}"),
        "All changed lines are import statements",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_hunk(file_path: &str, lines: Vec<DiffLine>) -> DiffHunk {
        DiffHunk {
            id: format!("{file_path}:testhash"),
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

    // --- Table-driven harness ---
    //
    // Each row is `(path, lines, expected)`. `lines` uses a one-char prefix
    // DSL: `+` added, `-` removed, a leading space for context. Rows run
    // through the whole rule chain, so a row also pins down which rule wins.

    /// A brand-new file's hunk is `@@ -0,0 +1,N @@` in real git output: both
    /// the old length and the old line anchor are 0.
    fn hunk_from(path: &str, lines: &[&str], new_file: bool) -> DiffHunk {
        let mut hunk = make_hunk(path, Vec::new());
        if new_file {
            hunk.old_start = 0;
            hunk.old_count = 0;
        } else {
            hunk.old_start = 1;
            hunk.old_count = 1;
        }
        for spec in lines {
            let (marker, content) = spec.split_at(1);
            hunk.lines.push(match marker {
                "+" => added(content),
                "-" => removed(content),
                _ => context(content),
            });
        }
        hunk
    }

    #[track_caller]
    fn check(path: &str, lines: &[&str], expected: Option<&str>) {
        check_file(path, lines, false, expected);
    }

    #[track_caller]
    fn check_file(path: &str, lines: &[&str], new_file: bool, expected: Option<&str>) {
        let hunk = hunk_from(path, lines, new_file);
        let label = classify_single_hunk(&hunk).map(|r| r.label[0].clone());
        assert_eq!(
            label.as_deref(),
            expected,
            "\n  path: {path}\n  lines: {lines:?}"
        );
    }

    // --- generated:lockfile (path-based) ---

    #[test]
    fn lockfiles() {
        check("uv.lock", &["+foo = 1"], Some("generated:lockfile"));
        check("a/b/yarn.lock", &["+x"], Some("generated:lockfile"));
        check("Cargo.lock", &["+[[package]]"], Some("generated:lockfile"));
        check("package-lock.json", &["+{}"], Some("generated:lockfile"));
        // A lockfile with comment-like lines is still a lockfile.
        check(
            "Cargo.lock",
            &["+# version info"],
            Some("generated:lockfile"),
        );
        check("src/main.py", &["+x = 1"], None);
        // go.mod is the editable manifest (not a generated lockfile); go.sum is.
        check("go.mod", &["+\trequire example.com/foo v1.2.3"], None);
        check(
            "go.sum",
            &["+example.com/foo v1.2.3 h1:abcdef="],
            Some("generated:lockfile"),
        );
    }

    // --- file:added-empty ---

    #[test]
    fn empty_files() {
        check_file("pkg/__init__.py", &[], true, Some("file:added-empty"));
        check_file(
            "pkg/__init__.py",
            &["+", "+   ", "+"],
            true,
            Some("file:added-empty"),
        );
        check_file(
            "pkg/__init__.py",
            &["+# a comment"],
            true,
            Some("comments:added"),
        );
        check("a.py", &["-old content"], None);
    }

    #[test]
    fn mid_file_insertion_is_whitespace_not_empty_file() {
        // A pure insertion into an EXISTING file (`@@ -5,0 +6,2 @@`, e.g. a -U0
        // diff) has old_count 0 but a nonzero old anchor — it must not read as a
        // brand-new empty file.
        let mut hunk = make_hunk("main.py", vec![added(""), added("")]);
        hunk.old_start = 5;
        hunk.old_count = 0;
        assert_eq!(
            classify_single_hunk(&hunk).map(|r| r.label[0].clone()),
            Some("formatting:whitespace".to_owned())
        );
    }

    // --- formatting:whitespace ---

    #[test]
    fn whitespace_only() {
        check(
            "src/main.py",
            &["+", "+   ", "-  "],
            Some("formatting:whitespace"),
        );
        check(
            "src/main.py",
            &[" x = 1", "+  ", "+"],
            Some("formatting:whitespace"),
        );
        check("src/main.py", &["+", "+x = 1"], None);
        // Blank lines are semantic in markup/data, and unvalidated elsewhere —
        // no whitespace label outside the core content languages.
        check("README.md", &["-", " text"], None);
        check("config.yml", &["+"], None);
        check(
            "src/main.rs",
            &["+", "+   ", "-  "],
            Some("formatting:whitespace"),
        );
    }

    // --- formatting:line-length (wrap / unwrap) ---

    #[test]
    fn line_length() {
        check(
            "app.ts",
            &[
                "-const result = foo(bar, baz, qux);",
                "+const result =",
                "+  foo(bar, baz, qux);",
            ],
            Some("formatting:line-length"),
        );
        check(
            "app.ts",
            &[
                "-const result =",
                "-  foo(bar, baz);",
                "+const result = foo(bar, baz);",
            ],
            Some("formatting:line-length"),
        );
        check(
            "app.ts",
            &[
                "-const result = foo(bar, baz);",
                "+const result = foo(bar, qux);",
            ],
            None,
        );
        // A wrap that ALSO edits content is not a neutral reflow.
        check(
            "app.ts",
            &[
                "-const result = foo(bar, baz);",
                "+const result =",
                "+  foo(bar, qux);",
            ],
            None,
        );
        check("app.ts", &["+const x = 1;"], None);
        // A newline is a record separator in data formats.
        check("data.csv", &["-a,b,", "-c,d", "+a,b, c,d"], None);
        // A reflow that ALSO dedents is a Python block-scope change.
        check(
            "app.py",
            &["-        x = foo(a, b)", "+    x = foo(a,", "+        b)"],
            None,
        );
        // Joining two statements across a newline is not a reflow — the newline
        // is semantic (Python suite, JS ASI).
        check(
            "app.py",
            &["-    return", "-    value", "+    return value"],
            None,
        );
        check(
            "app.js",
            &["-  return", "-  value", "+  return value"],
            None,
        );
        // Deletions bracketing a context line is a move, not a reflow.
        check(
            "app.py",
            &["-x = f(a,", " ctx()", "-    b)", "+x = f(a, b)"],
            None,
        );
    }

    #[test]
    fn line_length_must_not_splice_strings() {
        check(
            "q.py",
            &[
                "-query = \"\"\"SELECT name,",
                "-email FROM users\"\"\"",
                "+query = \"\"\"SELECT name, email FROM users\"\"\"",
            ],
            None,
        );
        check(
            "a.ts",
            &[
                "-const s = `Dear user, code 12345`;",
                "+const s = `Dear user,",
                "+code 12345`;",
            ],
            None,
        );
    }

    #[test]
    fn line_length_must_not_join_into_a_line_comment() {
        // Unwrapping moves `baz)` INTO the `// why` comment: the joined texts
        // compare equal, but the new line comments the argument out.
        check(
            "app.js",
            &["-foo(bar, // why", "-    baz);", "+foo(bar, // why baz);"],
            None,
        );
        check(
            "app.py",
            &["-foo(bar,  # why", "-    baz)", "+foo(bar,  # why baz)"],
            None,
        );
        // A comment on the FINAL line swallows nothing — still a neutral reflow.
        check(
            "app.js",
            &["-foo(bar,", "-    baz); // note", "+foo(bar, baz); // note"],
            Some("formatting:line-length"),
        );
        // A `//` inside a string is not a comment — the reflow stays neutral.
        check(
            "app.js",
            &[
                "-const u = fetch('http://x',",
                "-    opts);",
                "+const u = fetch('http://x', opts);",
            ],
            Some("formatting:line-length"),
        );
    }

    // --- formatting:style ---

    #[test]
    fn style_basics() {
        check(
            "app.ts",
            &["-const x = 1", "+const x = 1;"],
            Some("formatting:style"),
        );
        check(
            "app.js",
            &["-const x = 'hello'", "+const x = \"hello\""],
            Some("formatting:style"),
        );
        check(
            "app.ts",
            &["-  foo: 'bar'", "+  foo: 'bar',"],
            Some("formatting:style"),
        );
        check("app.ts", &["-const x = 1;", "+const x = 2;"], None);
        check("app.ts", &["+const x = 1;"], None);
        check(
            "app.ts",
            &["-const x = 1", "+const x = 1;", "+const y = 2;"],
            None,
        );
        // A trailing comma is stylistic in JS/TS (an array/arg list).
        check(
            "app.ts",
            &["-const a = [1, 2,]", "+const a = [1, 2]"],
            Some("formatting:style"),
        );
        // ...but a same-indent quote-style change is still trusted in Python.
        check(
            "app.py",
            &["-    x = 'a'", "+    x = \"a\""],
            Some("formatting:style"),
        );
        // A Python indentation (dedent) change is semantic, not a style edit.
        check("app.py", &["-        return 1", "+    return 1"], None);
        // Style rules don't run where `;`/`,`/quotes may be semantic.
        check("data.csv", &["-id,name,", "+id,name"], None);
        check("main.go", &["-const c = 'a'", "+const c = \"a\""], None);
    }

    #[test]
    fn python_trailing_comma_builds_a_tuple() {
        check("app.py", &["-x = 1,", "+x = 1"], None);
        check("app.py", &["-x = (a,)", "+x = (a)"], None);
        check("app.py", &["-d[k,]", "+d[k]"], None);
        check("app.py", &["-return a,", "+return a"], None);
    }

    #[test]
    fn style_semicolon_respects_asi() {
        // A trailing `;` is stylistic when the next line starts a fresh statement.
        check(
            "app.ts",
            &["-const x = 1", "+const x = 1;", " const y = 2;"],
            Some("formatting:style"),
        );
        // ...but NOT when the next line starts with `(`.
        check(
            "app.ts",
            &["-const value = foo", "+const value = foo;", " (bar).baz()"],
            None,
        );
        // A following regex/division line (leading `/`) is also a continuation.
        check("app.ts", &["-a = b;", "+a = b", " /hi/g.exec(c)"], None);
        // A following comment line is inert — the `;` stays stylistic.
        check(
            "app.ts",
            &["-const x = 1", "+const x = 1;", " // a comment"],
            Some("formatting:style"),
        );
        // ASI ignores blank lines, so a blank line before the `(` still merges.
        check(
            "app.ts",
            &[
                "-const handler = makeHandler;",
                "+const handler = makeHandler",
                " ",
                " (init())()",
            ],
            None,
        );
        // Only blank lines visible after the change: the follower sits past the
        // context window, so the `;` can't be proven inert.
        check(
            "app.ts",
            &[
                "-const a = getThing();",
                "+const a = getThing()",
                " ",
                " ",
                " ",
            ],
            None,
        );
    }

    #[test]
    fn style_must_not_hide_a_real_change() {
        // The tokenizer drops comments, so a directive change under cover of a
        // quote swap must be declined (left for the comments rule).
        check("a.py", &["-x = 'a'  # noqa: E501", "+x = \"a\""], None);
        check(
            "a.py",
            &[
                "-x = 'a'  # type: ignore[foo]",
                "+x = \"a\"  # type: ignore[bar]",
            ],
            None,
        );
        check(
            "a.ts",
            &[
                "-let x = 'a' /* eslint-disable no-eval */",
                "+let x = \"a\" /* eslint-disable */",
            ],
            None,
        );
        // `//` is floor division in Python, not a comment — a quote swap on the
        // same line must not let the ts lexer drop the divisor change.
        check(
            "app.py",
            &["-msg = 'hi'; n = x // 2", "+msg = \"hi\"; n = x // 4"],
            None,
        );
        // A quote *character* inside a string value flipping is semantic.
        check("app.ts", &["-const sep = '\"'", "+const sep = \"'\""], None);
        // An f-string interpolation change is a value change.
        check("app.py", &["-msg = f'{a}'", "+msg = f'{b}'"], None);
        // Whitespace inside a string literal is a value change.
        check("app.py", &["-x = \"a  b\"", "+x = \"a b\""], None);
        check("app.js", &["-x = 'a  b'", "+x = 'a b'"], None);
        // A regex literal must not be mislexed as a comment/style token.
        check("app.js", &["-const r = /a/g", "+const r = /a/i"], None);
        // A TypeScript `as` cast target change is semantic.
        check("app.ts", &["-const x = y as A", "+const x = y as B"], None);
        // Removing optional chaining changes null-handling behavior.
        check("app.ts", &["-a?.b", "+a.b"], None);
        // A statement MOVED across a context line plus a quote swap is not style.
        check(
            "app.py",
            &["-x = 'a'", " do_something()", "+x = \"a\""],
            None,
        );
    }

    // --- formatting:spacing ---

    #[test]
    fn spacing_basics() {
        check("app.py", &["-x=1", "+x = 1"], Some("formatting:spacing"));
        check(
            "app.py",
            &["-x = 1  ", "+x = 1"],
            Some("formatting:spacing"),
        );
        check(
            "app.ts",
            &["-const x = f( a, b );", "+const x = f(a, b);"],
            Some("formatting:spacing"),
        );
        // Whitespace before a trailing comment is still just spacing...
        check(
            "app.py",
            &["-x = 1  # note", "+x = 1 # note"],
            Some("formatting:spacing"),
        );
        // ...but a change to the comment itself is the comments rule's call.
        check(
            "app.py",
            &["-x = 1  # a", "+x = 1  # b"],
            Some("comments:modified"),
        );
        // Python `/` is always division — plain spacing.
        check(
            "app.py",
            &["-x = a/b", "+x = a / b"],
            Some("formatting:spacing"),
        );
        // Spacing rules don't run on data formats.
        check("data.csv", &["-a,b", "+a, b"], None);
    }

    #[test]
    fn spacing_declines_semantic_regroupings() {
        // Whitespace inside a string literal is a value change.
        check("app.py", &["-x = 'a  b'", "+x = 'a b'"], None);
        // Regrouping punctuation is semantic though the token texts match.
        check("app.js", &["-a + +b", "+a ++ b"], None);
        check("app.py", &["-a ** b", "+a * * b"], None);
        // Gluing a word to a string makes an f-string — not spacing.
        check("app.py", &["-f 'x'", "+f'x'"], None);
        // A mid-line block comment sits in a token gap — could be edited.
        check("app.ts", &["-f(/* a */ x)", "+f( /* a */x)"], None);
        // Respacing that also dedents is an indentation change.
        check("app.py", &["-    x=1", "+  x = 1"], None);
        // In JS/TS, spacing around `<`/`>`/`/` decides how the line parses.
        check("app.tsx", &["-f<T>(x)", "+f < T > (x)"], None);
        check("app.js", &["-f(a, /b/ x)", "+f(a, / b / x)"], None);
    }

    // --- comments:* ---

    #[test]
    fn comment_lines() {
        check("app.py", &["+# a", "+# b"], Some("comments:added"));
        check("main.rs", &["+// a", "+// b"], Some("comments:added"));
        check(
            "script.py",
            &["-# old", "-# older"],
            Some("comments:removed"),
        );
        check("app.js", &["-// old", "+// new"], Some("comments:modified"));
        check(
            "config.yml",
            &["+# Added config comment"],
            Some("comments:added"),
        );
        check("app.js", &["+// note", "+const x = 1;"], None);
        check("file.xyz", &["+// note"], None);
        // Prose comments are still comment churn.
        check(
            "app.py",
            &["-# helper", "+# helper for parsing"],
            Some("comments:modified"),
        );
        // A `#` in a YAML value fragment is not a comment marker.
        check(
            "config.yml",
            &["-url: https://x/#old", "+url: https://x/#new"],
            None,
        );
    }

    #[test]
    fn block_comments() {
        check("app.js", &["+/* block */"], Some("comments:added"));
        check(
            "app.js",
            &["+/* start", "+   mid", "+   end */"],
            Some("comments:added"),
        );
        check("styles.css", &["-/* old */"], Some("comments:removed"));
        check("index.html", &["+<!-- note -->"], Some("comments:added"));
        check(
            "index.html",
            &["+<!-- start", "+   mid", "+   end -->"],
            Some("comments:added"),
        );
        check("config.xml", &["-<!-- old -->"], Some("comments:removed"));
        check("icon.svg", &["+<!-- svg -->"], Some("comments:added"));
        check("app.js", &["+/* c */", "+const x = 1;"], None);
        // Opening a `/*` that never closes comments out the code BELOW the hunk.
        check("app.js", &["+/* disabling this"], None);
        // Commenting OUT live context code: the block opened on an added line
        // swallows the unchanged statement between the added lines.
        check(
            "app.js",
            &["+/* start", " existingCode();", "+end */"],
            None,
        );
        // Code trailing a closed block comment is code, not comment.
        check("app.js", &["+/* note */ doThing()"], None);
        // CSS has no `//` line comment: a protocol-relative url() is real value.
        check(
            "styles.css",
            &[
                "-  background: url(//cdn.old/logo.png);",
                "+  background: url(//cdn.new/logo.png);",
            ],
            None,
        );
    }

    #[test]
    fn inline_comments() {
        check(
            "app.py",
            &["-    x = get_value()", "+    x = get_value()  # TODO"],
            Some("comments:added"),
        );
        check(
            "app.py",
            &["-    foo()  # obvious note", "+    foo()"],
            Some("comments:removed"),
        );
        check(
            "app.js",
            &["-const x = 1; // old reason", "+const x = 1; // new reason"],
            Some("comments:modified"),
        );
        // A real inline comment on a kept CODE language (shell) is comment-only.
        check(
            "deploy.sh",
            &["-echo a  # old", "+echo a  # new"],
            Some("comments:modified"),
        );
        check(
            "app.py",
            &["-    x = \"foo # bar\"", "+    x = \"foo # baz\""],
            None,
        );
        check(
            "app.py",
            &["-    x = old_value()  # comment", "+    x = new_value()"],
            None,
        );
        // A dedent of a commented code line is a real (indent) change.
        check(
            "app.py",
            &["-        do()  # note", "+    do()  # note"],
            None,
        );
        // A change to a triple-quoted string's VALUE is not a comment change —
        // the apostrophe inside must not desync the scanner.
        check(
            "app.py",
            &["-x = '''don't # old'''", "+x = '''don't # new'''"],
            None,
        );
        // A template literal is a value, not a comment.
        check(
            "app.js",
            &[
                "-const url = `http://old.com`;",
                "+const url = `http://new.com`;",
            ],
            None,
        );
    }

    #[test]
    fn tool_directives_are_never_comment_churn() {
        for marker in [
            "# type: ignore",
            "# noqa: E501",
            "# pylint: disable=no-member",
            "# nopep8",
            "# skipcq: PYL-W0612",
            "# pyre-ignore[6]",
            "# pyre-fixme[6]",
            "# pytype: disable=attribute-error",
            "# yapf: disable",
            "# doctest: +SKIP",
        ] {
            check(
                "app.py",
                &[&format!("-    foo()  {marker}"), "+    foo()"],
                None,
            );
        }
        check(
            "app.py",
            &[
                "-x = f()  # type: ignore",
                "+x = f()  # type: ignore[arg-type]",
            ],
            None,
        );
        check("app.ts", &["+// @ts-ignore", " broken();"], None);
        check(
            "app.ts",
            &["-// eslint-disable-next-line no-eval", " eval(x);"],
            None,
        );
        check("app.py", &["-# pragma: no cover", " def f():"], None);
        check(
            "main.go",
            &["+//go:generate mockgen", " package main"],
            None,
        );
    }

    #[test]
    fn shebangs_are_execution_not_comments() {
        check("run.sh", &["-#!/bin/bash", "+#!/bin/sh"], None);
        check(
            "run.py",
            &["-#!/usr/bin/env python2", "+#!/usr/bin/env python3"],
            None,
        );
    }

    #[test]
    fn hashbang_mid_file_is_still_a_comment() {
        // `#!` only means "interpreter" on line 1; deeper in a file it's
        // ordinary comment text.
        let mut hunk = make_hunk(
            "run.py",
            vec![
                removed("#!/bin/bash is required here"),
                added("#!/bin/sh is required here"),
            ],
        );
        hunk.lines[0].old_line_number = Some(5);
        hunk.lines[1].new_line_number = Some(5);
        assert_eq!(
            classify_single_hunk(&hunk).map(|r| r.label[0].clone()),
            Some("comments:modified".to_owned())
        );
    }

    // --- imports:* ---

    #[test]
    fn imports_added_and_removed() {
        check(
            "app.ts",
            &["+import { Foo } from './foo';"],
            Some("imports:added"),
        );
        check(
            "main.py",
            &["-import os", "-from sys import argv"],
            Some("imports:removed"),
        );
        check(
            "lib.rs",
            &["+use std::collections::HashMap;"],
            Some("imports:added"),
        );
        check("main.c", &["+#include <stdio.h>"], Some("imports:added"));
        check(
            "app.ts",
            &["+import { Foo } from './foo';", "+const x = new Foo();"],
            None,
        );
        // A dynamic `import(...)` call is executable code, not a static import.
        check("app.ts", &["+import (\"./setup\");"], None);
        // A trailing statement after the `;` is executable code.
        check("app.js", &["+import x from \"x\"; doThing()"], None);
        check("app.py", &["+import os; do_thing()"], None);
        check(
            "app.ts",
            &["+import {", "+  foo,", "+} from './foo'; doThing();"],
            None,
        );
        // A bare export list is a public-API change, not import churn.
        check(
            "app.ts",
            &["-export { Foo };", "+export { Foo, Bar };"],
            None,
        );
    }

    #[test]
    fn imports_multiline() {
        check(
            "main.py",
            &[
                "+from plain.models import (",
                "+    query_utils,",
                "+    sql,",
                "+)",
            ],
            Some("imports:added"),
        );
        check(
            "app.tsx",
            &[
                "+import {",
                "+  useState,",
                "+  useEffect,",
                "+} from \"react\";",
            ],
            Some("imports:added"),
        );
        check(
            "lib.rs",
            &[
                "+use std::collections::{",
                "+    HashMap,",
                "+    HashSet,",
                "+};",
            ],
            Some("imports:added"),
        );
        check(
            "main.go",
            &["+import (", "+    \"fmt\"", "+    \"os\"", "+)"],
            Some("imports:added"),
        );
        check(
            "main.py",
            &[
                "-from plain.models import (",
                "-    query_utils,",
                "-    sql,",
                "-    transaction,",
                "-)",
                "+from plain.models import query_utils, transaction",
            ],
            Some("imports:modified"),
        );
        check(
            "main.py",
            &[
                "+from os import (",
                "+    path,",
                "+)",
                "+x = path.join('a', 'b')",
            ],
            None,
        );
        // A multi-line import whose members CHANGE is modified, not reordered.
        check(
            "app.ts",
            &[
                "-import {",
                "-  A,",
                "-} from './x';",
                "+import {",
                "+  B,",
                "+} from './x';",
            ],
            Some("imports:modified"),
        );
    }

    #[test]
    fn imports_modified_only_within_the_same_source() {
        check(
            "index.js",
            &["-import { a } from './a';", "+import { a, b } from './a';"],
            Some("imports:modified"),
        );
        check(
            "src/main.tsx",
            &[
                "-import React from \"react\";",
                "+import React, { useEffect } from \"react\";",
            ],
            Some("imports:modified"),
        );
        // A source swap is a different module, not import churn.
        check(
            "index.js",
            &["-import { a } from './a';", "+import { b } from './b';"],
            None,
        );
        check(
            "main.py",
            &["-from foo import bar", "+from evil import bar"],
            None,
        );
        check(
            "main.c",
            &["-#include \"config.h\"", "+#include \"evil.h\""],
            None,
        );
        // `require` executes the target file, and Ruby can't be split into
        // module-vs-names, so a paired modification is never trusted.
        check("app.rb", &["-require 'safe'", "+require 'evil'"], None);
        // An escaped delimiter inside the source must not truncate it: `a\'b`
        // and `a\'c` are different modules, and a scanner that stopped at the
        // escaped quote would read both as `a\` and trust the swap.
        check(
            "app.js",
            &["-import x from 'a\\'b';", "+import x from 'a\\'c';"],
            None,
        );
        // ...while a name-only edit against the same escaped source still labels.
        check(
            "app.js",
            &[
                "-import { a } from 'a\\'b';",
                "+import { a, c } from 'a\\'b';",
            ],
            Some("imports:modified"),
        );
    }

    #[test]
    fn imports_reordered() {
        check(
            "index.js",
            &[
                "-import { b } from './b';",
                "-import { a } from './a';",
                "+import { a } from './a';",
                "+import { b } from './b';",
            ],
            Some("imports:reordered"),
        );
        // #include order can be load-bearing for macros/conditional compilation.
        check(
            "main.c",
            &[
                "-#include \"a.h\"",
                "-#include \"b.h\"",
                "+#include \"b.h\"",
                "+#include \"a.h\"",
            ],
            None,
        );
        // A bare side-effect import's only purpose is running top-level code.
        check(
            "index.js",
            &[
                "-import './b';",
                "-import './a';",
                "+import './a';",
                "+import './b';",
            ],
            None,
        );
        // Reordering a __future__ import breaks the module at import time.
        check(
            "app.py",
            &[
                "-from __future__ import annotations",
                "-import os",
                "+import os",
                "+from __future__ import annotations",
            ],
            None,
        );
    }

    // --- unclassified ---

    #[test]
    fn real_code_is_never_labeled() {
        check("src/main.py", &[" just context"], None);
        check("src/main.py", &["+def real():", "+    return 1"], None);
        check("src/main.rs", &["+fn main() {}"], None);
    }

    // --- type-annotations:modified (ported from the Python annotation corpus) ---

    #[test]
    fn type_annotations_trusted_shapes() {
        check(
            "app.py",
            &["-def greet(name):", "+def greet(name: str):"],
            Some("type-annotations:modified"),
        );
        check(
            "app.py",
            &["-def greet(name):", "+def greet(name) -> str:"],
            Some("type-annotations:modified"),
        );
        check(
            "app.ts",
            &["-const x = 1", "+const x: number = 1"],
            Some("type-annotations:modified"),
        );
        check(
            "app.py",
            &["-x: Dict[str, int] = {}", "+x: Dict[str, str] = {}"],
            Some("type-annotations:modified"),
        );
        check(
            "app.ts",
            &["-function f(a: number) {}", "+function f(a: string) {}"],
            Some("type-annotations:modified"),
        );
        // Changing only the TYPE (default unchanged) IS a trusted edit.
        check(
            "app.py",
            &["-def f(a: int = 1):", "+def f(a: str = 1):"],
            Some("type-annotations:modified"),
        );
    }

    #[test]
    fn a_colon_is_not_always_an_annotation() {
        // Dict / object-literal entries: the colon is key:value, not param:type.
        check("app.py", &["-d = {KEY: old}", "+d = {KEY: new}"], None);
        check(
            "app.py",
            &["-    KEY: old_value,", "+    KEY: new_value,"],
            None,
        );
        check("app.ts", &["-  enabled: false,", "+  enabled: true,"], None);
        check("app.ts", &["-  enabled: false", "+  enabled: true"], None);
        check(
            "app.ts",
            &[
                "-const o = { enabled: false }",
                "+const o = { enabled: true }",
            ],
            None,
        );
        check(
            "app.py",
            &[
                "-            DB_NAMESPACE: db.settings_dict.get(\"NAME\"),",
                "+            DB_NAMESPACE: db.settings_dict.get(\"DATABASE\"),",
            ],
            None,
        );
        check(
            "app.py",
            &["-    \"key\": old_value,", "+    \"key\": new_value,"],
            None,
        );
        check(
            "app.py",
            &[
                "-config = {",
                "-    KEY: old_value,",
                "-}",
                "+config = {",
                "+    KEY: new_value,",
                "+}",
            ],
            None,
        );
        // A ternary's false branch, a lambda body, a suite, a case label.
        check(
            "app.ts",
            &["-const v = flag ? a : b", "+const v = flag ? a : c"],
            None,
        );
        check(
            "app.py",
            &["-f = lambda x: old_value", "+f = lambda x: new_value"],
            None,
        );
        check(
            "app.py",
            &[
                "-sorted(xs, key=lambda x: x.a)",
                "+sorted(xs, key=lambda x: x.b)",
            ],
            None,
        );
        check(
            "app.py",
            &["-if flag: return old", "+if flag: return new"],
            None,
        );
        check(
            "app.py",
            &["-while cond: step(old)", "+while cond: step(new)"],
            None,
        );
        check(
            "app.ts",
            &["-case Foo: return old", "+case Foo: return new"],
            None,
        );
        // `:=` (walrus) is not a type-annotation colon.
        check("app.py", &["-if (n := f()):", "+if (m := f()):"], None);
        // A one-line def body: the dict colon is NOT a param annotation (the
        // params already closed).
        check(
            "config.py",
            &[
                "-def default(): return {\"timeout\": 30}",
                "+def default(): return {\"timeout\": 60}",
            ],
            None,
        );
        // A bare `NAME: X` (no `=`) is ambiguous — a type decl vs a dict entry
        // whose `{` opened on a prior line — so it is never flagged.
        check(
            "app.py",
            &[
                "-    retries: DEFAULT_RETRIES",
                "+    retries: FALLBACK_RETRIES",
            ],
            None,
        );
        // A TS interface/type member (`timeout: number;`) is the same ambiguous
        // shape as an object-literal entry, and the enclosing `interface` is
        // usually above the hunk. Declining costs coverage on a genuinely
        // erasable edit, but the shape alone can't prove it is one.
        check(
            "src/api.ts",
            &["-  timeout: number;", "+  timeout: number | undefined;"],
            None,
        );
    }

    #[test]
    fn annotation_spans_must_not_swallow_real_changes() {
        // A parameter DEFAULT-value change is outside the annotation span.
        check(
            "app.py",
            &[
                "-def connect(timeout: int = 30):",
                "+def connect(timeout: int = 5):",
            ],
            None,
        );
        check(
            "app.ts",
            &[
                "-function f(a: number = 1) {}",
                "+function f(a: number = 2) {}",
            ],
            None,
        );
        // The second declarator's name is not part of the first's span.
        check(
            "app.ts",
            &[
                "-let x: number, oldName: string",
                "+let x: number, newName: string",
            ],
            None,
        );
        // A runtime-active annotation (a call: Depends / Field / validators) is
        // not an erasable type edit — its arguments ARE behavior.
        check(
            "v.py",
            &[
                "-def f(u: Annotated[User, Depends(require_admin)]): pass",
                "+def f(u: Annotated[User, Depends(require_login)]): pass",
            ],
            None,
        );
        check(
            "m.py",
            &[
                "-limit: Annotated[int, Field(le=1000)] = 100",
                "+limit: Annotated[int, Field(le=100000)] = 100",
            ],
            None,
        );
        // A rename alongside an annotation is a real change.
        check(
            "app.py",
            &["-def greet(name):", "+def hello(name: str):"],
            None,
        );
        // Pure additions can't be judged without the other side.
        check("app.py", &["+def greet(name: str) -> str:"], None);
        // Not a language the tokenizer models with an annotation grammar.
        check("app.rs", &["-let x = 1;", "+let x: i32 = 1;"], None);
    }

    // --- verified bug-hunt regressions ---

    #[test]
    fn imports_bracket_counting_is_comment_and_string_aware() {
        // A `(` inside a trailing comment must not open a phantom continuation
        // that exempts the NEXT line from the import-prefix check.
        check(
            "a.py",
            &["+import os  # see issue (", "+shutil.rmtree(p))"],
            None,
        );
        // Inside a genuine multi-line import, a line must still read as an
        // import list — an assignment or a call there is smuggled code.
        check(
            "a.py",
            &["+from os import (", "+    path,", "+    x = evil(),", "+)"],
            None,
        );
        // ...while a comment among the members is fine.
        check(
            "a.py",
            &["+from os import (", "+    # keep", "+    path,", "+)"],
            Some("imports:added"),
        );
    }

    #[test]
    fn imports_modified_compares_the_whole_binding() {
        // An `as` alias renames what the import binds locally.
        check(
            "app.py",
            &["-import numpy as np", "+import numpy as pd"],
            None,
        );
        // A TS `import type` flag flip changes whether the import emits code.
        check(
            "app.ts",
            &["-import type { A } from 'm'", "+import { A } from 'm'"],
            None,
        );
        // Every comma-separated module counts, not just the first.
        check("app.py", &["-import os, sys", "+import os, requests"], None);
    }

    #[test]
    fn control_flow_semicolon_is_never_stylistic() {
        // `while (cond());` loops doing nothing; `while (cond())` makes the
        // next line the body.
        check(
            "app.ts",
            &["-while (cond());", "+while (cond())", " doThing();"],
            None,
        );
    }

    #[test]
    fn edits_inside_a_multiline_string_are_never_trivial() {
        // The literal opens on a context line, so the changed lines are string
        // CONTENT — respacing them changes the value.
        check(
            "app.ts",
            &[" const msg = `", "-  Total:   42", "+  Total: 42"],
            None,
        );
        check(
            "app.py",
            &[" doc = \"\"\"", "-  Total:   42", "+  Total: 42"],
            None,
        );
    }

    #[test]
    fn reorders_are_trusted_only_where_verified() {
        // Ruby `require` executes the target; order can be load-bearing.
        check(
            "app.rb",
            &[
                "-require 'b'",
                "-require 'a'",
                "+require 'a'",
                "+require 'b'",
            ],
            None,
        );
        // A Go blank import exists only for its init() side effects.
        check(
            "main.go",
            &[
                "-import \"fmt\"",
                "-import _ \"github.com/lib/pq\"",
                "+import _ \"github.com/lib/pq\"",
                "+import \"fmt\"",
            ],
            None,
        );
        // ...but an ordinary Go reorder is still gofmt churn.
        check(
            "main.go",
            &[
                "-import \"os\"",
                "-import \"fmt\"",
                "+import \"fmt\"",
                "+import \"os\"",
            ],
            Some("imports:reordered"),
        );
    }

    #[test]
    fn blank_lines_are_whitespace_not_imports() {
        // A blank-line-only hunk names no import (and no comment).
        check("src/lib.rs", &["+"], Some("formatting:whitespace"));
    }

    #[test]
    fn dropped_trailing_comma_must_not_split_a_declaration() {
        // `let a = 1,` / `b = 2;` declares both; dropping the comma moves `b`
        // out of the declaration entirely.
        check("app.js", &["-let a = 1,", "+let a = 1", " b = 2;"], None);
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
    fn test_moved_takes_priority_over_other_rules() {
        // A lockfile hunk with a move_pair_id should be classified as moved
        let mut hunk = make_hunk("package-lock.json", vec![added("{}")]);
        hunk.move_pair_id = Some("other:hash".to_owned());
        let result = classify_single_hunk(&hunk);
        assert!(result.is_some());
        assert_eq!(result.unwrap().label, vec!["move:code"]);
    }

    // --- Type annotation tests ---

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
}
