//! Type-annotation span detection for the `type-annotations:modified` rule.
//!
//! Telling a type-annotation `:` from a suite / dict / ternary / lambda /
//! object-value / case-label colon is a lexing question, so we tokenize the line
//! (see `tokens.rs`) and reason about token *roles*, not bytes.
//!
//! The rule uses a **delta** model: rather than erasing the "trivial" part and
//! hoping the rest matches, it compares the two sides' token sequences and
//! trusts only when *every* changed token is flagged as part of an annotation —
//! default-deny, so an unrecognized change is never hidden. Token roles come
//! from the span detectors (`py_spans`/`ts_spans`), which flag a token only when
//! it is *definitely* inside an annotation.

use super::delta::Side;
use super::tokens::{is_close_bracket, is_open_bracket, tokens_differ, Dialect, Token, TokenKind};

/// A `[start, end)` char range covering an annotation.
type Span = (usize, usize);

fn is_op(token: &Token, text: &str) -> bool {
    token.kind == TokenKind::Op && token.text == text
}

fn is_word(token: &Token, text: &str) -> bool {
    token.kind == TokenKind::Word && token.text == text
}

/// Span from just before `tokens[colon]` (the `:`/`->`) to the end of the type
/// that follows — the type ends at a top-level token in `stops`, at the closer
/// of the bracket it sits inside, or at the line's end. Shared by every
/// annotation context (Python params/returns/vars, TS params/vars).
fn type_span_to(tokens: &[Token], colon: usize, stops: &[&str]) -> Span {
    let start = tokens[colon - 1].end;
    let mut depth = 0i32;
    let mut type_end = tokens[colon].end;
    for token in &tokens[colon + 1..] {
        let is_op_token = token.kind == TokenKind::Op;
        if depth == 0 && is_op_token && stops.contains(&token.text.as_str()) {
            break;
        }
        if is_op_token && is_open_bracket(&token.text) {
            depth += 1;
        } else if is_op_token && is_close_bracket(&token.text) {
            if depth == 0 {
                break;
            }
            depth -= 1;
        }
        type_end = token.end;
    }
    (start, type_end)
}

// --- Python ---

/// Every name `keyword.iskeyword` reports for Python 3. The soft keywords
/// (`match`, `case`, `type`, `_`) are deliberately absent, matching it.
const PY_KEYWORDS: &[&str] = &[
    "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue",
    "def", "del", "elif", "else", "except", "finally", "for", "from", "global", "if", "import",
    "in", "is", "lambda", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while",
    "with", "yield",
];

/// The `: TYPE` span of a `NAME: TYPE = value` annotated ASSIGNMENT.
///
/// Requires a top-level `=`: a bare `NAME: X` (no assignment) is ambiguous — a
/// statement-level type declaration vs a dict/keyed entry whose `{` opened on an
/// earlier line — and stripping a dict value would hide a real data change, so
/// we leave a bare colon alone. The span runs from just after NAME to the end of
/// the last type token before the `=`.
fn py_var_spans(tokens: &[Token]) -> Vec<Span> {
    let mut depth = 0i32;
    for i in 2..tokens.len() {
        let token = &tokens[i];
        if token.kind != TokenKind::Op {
            continue;
        }
        if is_open_bracket(&token.text) {
            depth += 1;
        } else if is_close_bracket(&token.text) {
            depth -= 1;
        } else if depth == 0 && token.text == "=" {
            return vec![(tokens[0].end, tokens[i - 1].end)];
        }
    }
    Vec::new() // no top-level '=' -> bare/ambiguous annotation, leave it
}

/// The param (`a: T`) and return (`-> T`) annotation spans of a def line.
///
/// A parameter type runs to the next top-level `,` or the closing `)`; a return
/// type runs to the suite `:`. Bails (flags nothing) if the signature contains a
/// `lambda`, whose body colon would otherwise read as a param annotation. Colons
/// only count as parameter annotations INSIDE the parameter parens: once they
/// close, a depth-1 colon is in some other bracket on the line (a dict or slice
/// in a one-line def body, e.g. `def f(): return {"timeout": 30}`) and must stay
/// unflagged so a value change there is never trusted.
fn py_def_spans(tokens: &[Token]) -> Vec<Span> {
    if tokens.iter().any(|t| is_word(t, "lambda")) {
        return Vec::new();
    }
    let mut spans = Vec::new();
    let mut depth = 0i32;
    let mut params_closed = false;
    for (i, token) in tokens.iter().enumerate() {
        if token.kind != TokenKind::Op {
            continue;
        }
        if token.text == ":" && depth == 1 && !params_closed {
            // a parameter annotation — stop at the next param `,`, the closing
            // `)`, or a default-value `=` (else the default would be swallowed)
            spans.push(type_span_to(tokens, i, &[",", "="]));
        } else if token.text == "->" && depth == 0 && i > 0 {
            spans.push(type_span_to(tokens, i, &[":"])); // the return annotation
        } else if is_open_bracket(&token.text) {
            depth += 1;
        } else if is_close_bracket(&token.text) {
            depth -= 1;
            if depth == 0 {
                params_closed = true; // the def's parameter list has ended
            }
        }
    }
    spans
}

fn py_spans(tokens: &[Token]) -> Vec<Span> {
    let Some(first) = tokens.first() else {
        return Vec::new();
    };
    if is_word(first, "def") || is_word(first, "async") {
        return py_def_spans(tokens);
    }
    // An annotated assignment `NAME: TYPE`: a leading identifier (not a keyword,
    // so not `if`/`for`/`lambda`/…) immediately followed by a colon.
    if first.kind == TokenKind::Word
        && !PY_KEYWORDS.contains(&first.text.as_str())
        && tokens.get(1).is_some_and(|t| is_op(t, ":"))
    {
        return py_var_spans(tokens);
    }
    Vec::new()
}

// --- TypeScript ---

/// The `: TYPE` span of a `const/let/var NAME: TYPE` declaration.
///
/// The span stops at a top-level `,` as well as `=`: in a multi-declarator
/// statement (`let x: number, other: string`) the comma ends the first
/// declarator, and running past it would flag the NEXT declarator's name as
/// annotation — letting a rename hide as a type change.
fn ts_var_span(tokens: &[Token]) -> Vec<Span> {
    let declares = tokens
        .first()
        .is_some_and(|t| is_word(t, "const") || is_word(t, "let") || is_word(t, "var"));
    if !declares {
        return Vec::new();
    }
    let mut depth = 0i32;
    for (i, token) in tokens.iter().enumerate() {
        if token.kind != TokenKind::Op {
            continue;
        }
        if is_open_bracket(&token.text) {
            depth += 1;
        } else if is_close_bracket(&token.text) {
            depth -= 1;
        } else if depth == 0 && token.text == "=" {
            return Vec::new(); // a value assignment reached before any annotation
        } else if depth == 0 && token.text == ":" && i > 0 {
            return vec![type_span_to(tokens, i, &["=", ","])];
        }
    }
    Vec::new()
}

/// The `a: T` param annotation spans of a `function` signature.
///
/// Bails on any `?` in the line — an optional marker (`a?: T`) or a ternary in a
/// default value — rather than risk mistaking a ternary colon for an annotation.
fn ts_param_spans(tokens: &[Token]) -> Vec<Span> {
    if tokens.iter().any(|t| is_op(t, "?")) {
        return Vec::new();
    }
    let mut spans = Vec::new();
    let mut stack: Vec<&str> = Vec::new();
    for (i, token) in tokens.iter().enumerate() {
        if token.kind != TokenKind::Op {
            continue;
        }
        if is_open_bracket(&token.text) {
            stack.push(&token.text);
        } else if is_close_bracket(&token.text) {
            stack.pop();
        } else if token.text == ":" && stack.last() == Some(&"(") && i > 0 {
            spans.push(type_span_to(tokens, i, &[",", "="]));
        }
    }
    spans
}

fn ts_spans(tokens: &[Token]) -> Vec<Span> {
    let var_span = ts_var_span(tokens);
    if !var_span.is_empty() {
        return var_span;
    }
    if tokens.iter().any(|t| is_word(t, "function")) {
        return ts_param_spans(tokens);
    }
    Vec::new()
}

// --- Delta classifier ---

/// Does this annotation span contain a call — `NAME(`, `)(`, or `](`?
///
/// An annotation is trusted on the premise that it is runtime-inert (erasable
/// type info). That premise breaks when the type region contains a call: an
/// `Annotated[User, Depends(require_admin)]` dependency, a Pydantic
/// `Field(gt=0, le=1000)`, a `Query(max_length=50)` validator. Their arguments
/// ARE runtime behavior, so a change inside them (`require_admin` ->
/// `require_login`, `le=1000` -> `le=100000`) is a real change, not a type edit
/// — the span must not be trusted.
fn span_has_call(tokens: &[Token], (start, end): Span) -> bool {
    let in_span: Vec<&Token> = tokens
        .iter()
        .filter(|t| start <= t.start && t.end <= end)
        .collect();
    in_span.windows(2).any(|pair| {
        let (prev, cur) = (pair[0], pair[1]);
        is_op(cur, "(") && (prev.kind == TokenKind::Word || is_op(prev, ")") || is_op(prev, "]"))
    })
}

/// Per token: does it lie within a type-annotation span (the `:`/`->` plus the
/// type that follows)? A token is flagged only when it is *definitely* part of
/// an annotation, so an unflagged token that changed always defeats the rule.
fn annotation_token_flags(tokens: &[Token], dialect: Dialect) -> Vec<bool> {
    let spans = match dialect {
        Dialect::Py => py_spans(tokens),
        Dialect::Ts => ts_spans(tokens),
    };
    // Drop any span containing a call — its arguments are runtime-active, so a
    // change there is a real behavior change, not an erasable type edit.
    let spans: Vec<Span> = spans
        .into_iter()
        .filter(|&span| !span_has_call(tokens, span))
        .collect();
    tokens
        .iter()
        .map(|tok| {
            spans
                .iter()
                .any(|&(start, end)| start <= tok.start && tok.end <= end)
        })
        .collect()
}

/// The tokens NOT inside any annotation span, as their texts.
fn unflagged_texts(tokens: &[Token], dialect: Dialect) -> Vec<&str> {
    annotation_token_flags(tokens, dialect)
        .into_iter()
        .zip(tokens)
        .filter(|(flagged, _)| !flagged)
        .map(|(_, tok)| tok.text.as_str())
        .collect()
}

/// Compare one line pair: `Some(true)` if it differs ONLY in type-annotation
/// tokens, `Some(false)` if token-identical, `None` if a non-annotation token
/// changed.
///
/// The invariant is the Python's — every changed token, on either side, must
/// fall inside a flagged annotation span — but it is checked directly rather
/// than through a diff alignment: drop each side's flagged tokens and require
/// what remains to be identical. That is the same condition without depending on
/// which alignment a diff algorithm happens to pick, and it can only accept when
/// the unflagged code is literally unchanged.
pub fn annotation_delta(old: &Side, new: &Side, dialect: Dialect) -> Option<bool> {
    if unflagged_texts(&old.tokens, dialect) != unflagged_texts(&new.tokens, dialect) {
        return None; // a non-annotation token changed — a real edit
    }
    Some(tokens_differ(&old.tokens, &new.tokens))
}
