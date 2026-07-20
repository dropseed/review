//! Inline-comment subcommands: `comment add|edit|resolve|unresolve|delete`
//! and `comments` (list).
//!
//! Comments are line-level annotations on a comparison. Unlike `note`, which
//! is a single free-form blob, comments are individually addressable and
//! carry an author so a human, an agent, and (eventually) imported PR review
//! comments can coexist in the same review.

use std::cell::Cell;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::Command;

use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};

use crate::review::state::{now_iso8601, AnnotationSide, LineAnnotation, ReviewState, Source};
use crate::review::storage;

use super::common::{
    line_range, load_for_mutation, mutate_review, print_json, resolve_review_arg, resolve_source,
    ReviewTarget,
};
use super::get_repo_path;

#[derive(Debug, Args)]
pub struct CommentsArgs {
    #[command(subcommand)]
    pub action: Option<CommentsAction>,
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Filter to a file-path glob (e.g. "src/*.rs")
    #[arg(long)]
    pub file: Option<String>,
    /// Only show unresolved comments
    #[arg(long, conflicts_with = "resolved")]
    pub unresolved: bool,
    /// Only show resolved comments
    #[arg(long, conflicts_with = "unresolved")]
    pub resolved: bool,
    /// Filter by author name (exact match)
    #[arg(long)]
    pub author: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Subcommand)]
pub enum CommentsAction {
    /// Add many comments at once from a JSON array (FILE, or stdin)
    Submit(CommentsSubmitArgs),
}

#[derive(Debug, Args)]
pub struct CommentsSubmitArgs {
    /// JSON file to read — an array of comments (defaults to stdin; "-" too)
    pub file: Option<String>,
    /// Override the author for every comment (default: $REVIEW_AUTHOR or git user)
    #[arg(long)]
    pub author: Option<String>,
    /// Override the source for every comment (default: $REVIEW_SOURCE or `cli`)
    #[arg(long)]
    pub source: Option<SourceArg>,
    /// Print a ready-to-edit JSON skeleton and exit, writing nothing
    #[arg(long)]
    pub example: bool,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct CommentArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    #[command(subcommand)]
    pub action: CommentAction,
}

#[derive(Debug, Subcommand)]
pub enum CommentAction {
    /// Leave a new comment on a file:line (or file:start-end range)
    Add(AddArgs),
    /// Replace the content of an existing comment
    Edit(EditArgs),
    /// Mark a comment as resolved
    Resolve(ResolveArgs),
    /// Clear the resolved state of a comment
    Unresolve(IdArgs),
    /// Delete a comment
    Delete(IdArgs),
}

#[derive(Debug, Args)]
pub struct AddArgs {
    /// Location: `path/to/file:LINE` or `path/to/file:START-END`
    pub location: String,
    /// Comment body
    pub content: String,
    /// Which side of the diff to attach to (default: new)
    #[arg(long, default_value = "new")]
    pub side: SideArg,
    /// Override the author (default: $REVIEW_AUTHOR or `git config user.name`)
    #[arg(long)]
    pub author: Option<String>,
    /// Override the source (default: $REVIEW_SOURCE or `cli`)
    #[arg(long)]
    pub source: Option<SourceArg>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct EditArgs {
    /// Comment ID (from `review comments`)
    pub id: String,
    /// New content
    pub content: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ResolveArgs {
    /// Comment ID
    pub id: String,
    /// Override who resolved it (default: $REVIEW_AUTHOR or git user)
    #[arg(long)]
    pub by: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct IdArgs {
    /// Comment ID
    pub id: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Clone, Copy, clap::ValueEnum)]
pub enum SideArg {
    Old,
    New,
    File,
}

impl From<SideArg> for AnnotationSide {
    fn from(value: SideArg) -> Self {
        match value {
            SideArg::Old => AnnotationSide::Old,
            SideArg::New => AnnotationSide::New,
            SideArg::File => AnnotationSide::File,
        }
    }
}

impl SideArg {
    fn as_str(self) -> &'static str {
        match self {
            SideArg::Old => "old",
            SideArg::New => "new",
            SideArg::File => "file",
        }
    }
}

#[derive(Debug, Clone, Copy, clap::ValueEnum)]
pub enum SourceArg {
    Ui,
    Cli,
    Agent,
    Github,
    Gitlab,
}

impl From<SourceArg> for Source {
    fn from(value: SourceArg) -> Self {
        match value {
            SourceArg::Ui => Source::Ui,
            SourceArg::Cli => Source::Cli,
            SourceArg::Agent => Source::Agent,
            SourceArg::Github => Source::Github,
            SourceArg::Gitlab => Source::Gitlab,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommentsJson<'a> {
    comparison: String,
    total: usize,
    comments: Vec<&'a LineAnnotation>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommentResultJson {
    comparison: String,
    action: &'static str,
    id: String,
    version: u64,
}

/// `review comments` — list comments on a comparison.
pub fn run_comments(args: CommentsArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let review = resolve_review_arg(&repo, args.target.spec.as_deref())?;
    let comparison = &review.comparison;
    let state = storage::load_review_state(&repo, &review.ref_name).map_err(|e| e.to_string())?;

    let file_filter = match &args.file {
        Some(glob) => {
            Some(glob::Pattern::new(glob).map_err(|e| format!("Invalid --file pattern: {e}"))?)
        }
        None => None,
    };
    let author_filter = args.author.as_deref();

    let filtered: Vec<&LineAnnotation> = state
        .annotations
        .iter()
        .filter(|a| {
            if let Some(pattern) = &file_filter {
                if !pattern.matches(&a.file_path) {
                    return false;
                }
            }
            if args.unresolved && a.resolved_at.is_some() {
                return false;
            }
            if args.resolved && a.resolved_at.is_none() {
                return false;
            }
            if let Some(name) = author_filter {
                if a.author.as_deref() != Some(name) {
                    return false;
                }
            }
            true
        })
        .collect();

    let mut sorted = filtered.clone();
    // Group by file_path so `print_comments_human` doesn't print the same
    // file header twice for interleaved annotations.
    sorted.sort_by(|a, b| {
        a.file_path
            .cmp(&b.file_path)
            .then(a.line_number.cmp(&b.line_number))
            .then(a.created_at.cmp(&b.created_at))
    });

    if args.json {
        print_json(&CommentsJson {
            comparison: comparison.key.clone(),
            total: sorted.len(),
            comments: sorted,
        });
    } else {
        print_comments_human(&comparison.key, state.annotations.len(), &sorted);
    }
    Ok(())
}

fn print_comments_human(comparison: &str, total: usize, rows: &[&LineAnnotation]) {
    if rows.is_empty() {
        if total == 0 {
            println!("(no comments on {comparison})");
        } else {
            println!("(no comments match the filter; {total} total on {comparison})");
        }
        return;
    }
    let resolved_count = rows.iter().filter(|a| a.resolved_at.is_some()).count();
    let open_count = rows.len() - resolved_count;
    println!(
        "{} comment(s) on {comparison} · {} open · {} resolved\n",
        rows.len(),
        open_count,
        resolved_count
    );
    let mut current_file = "";
    for row in rows {
        if row.file_path.as_str() != current_file {
            println!("{}", row.file_path);
            current_file = row.file_path.as_str();
        }
        let range = line_range(row.line_number, row.end_line_number);
        let author = row.author.as_deref().unwrap_or("?");
        let resolved = if row.resolved_at.is_some() {
            " [resolved]"
        } else {
            ""
        };
        println!("  :{range:<8}  {}  by {author}{resolved}", row.id);
        for line in row.content.lines() {
            println!("      {line}");
        }
    }
}

/// `review comment add` — leave a comment on a file:line.
pub fn run_add(target: ReviewTarget, args: AddArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let (file_path, line_number, end_line_number) = parse_location(&args.location)?;

    let author = args
        .author
        .or_else(|| std::env::var("REVIEW_AUTHOR").ok())
        .or_else(|| default_git_user(&repo));
    let source = super::common::resolve_source(args.source)?;

    let side: AnnotationSide = args.side.into();
    let side_str = args.side.as_str();
    let created_at = now_iso8601();
    let id = new_annotation_id(&file_path, line_number, side_str);

    let new_annotation = LineAnnotation {
        id: id.clone(),
        file_path,
        line_number,
        end_line_number,
        side,
        content: args.content,
        created_at,
        author,
        source: Some(source),
        updated_at: None,
        resolved_at: None,
        resolved_by: None,
    };

    let (review, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;
    let comparison = &review.comparison;
    let to_push = new_annotation.clone();
    let state = mutate_review(&repo, &review.ref_name, &hunks, |state| {
        state.annotations.push(to_push.clone());
        true
    })?;

    if args.json {
        print_json(&CommentResultJson {
            comparison: comparison.key.clone(),
            action: "add",
            id: id.clone(),
            version: state.version,
        });
    } else {
        println!(
            "Added comment {id} on {} (review v{})",
            comparison.key, state.version
        );
    }
    Ok(())
}

/// One comment in a `review comments submit` batch. `line` is 1-based (like
/// `comment add`); `side` defaults to `new`.
#[derive(Debug, Deserialize)]
struct CommentInput {
    path: String,
    line: u32,
    #[serde(default, rename = "endLine")]
    end_line: Option<u32>,
    #[serde(default)]
    side: AnnotationSide,
    content: String,
}

/// A ready-to-edit skeleton for `review comments submit --example`.
const COMMENTS_EXAMPLE: &str = r#"[
  {
    "path": "src/auth.rs",
    "line": 142,
    "side": "new",
    "content": "Why compare against Date.now() here rather than the token's issued-at?"
  },
  {
    "path": "src/cache.rs",
    "line": 57,
    "endLine": 60,
    "content": "This range reads clean now — leaving a note for the human reviewer."
  }
]
"#;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommentsSubmitJson {
    comparison: String,
    added: usize,
    ids: Vec<String>,
    version: u64,
}

/// `review comments submit` — add many comments in a single mutation, so a
/// batch of review notes doesn't race the store one write at a time.
pub fn run_submit_comments(target: ReviewTarget, args: CommentsSubmitArgs) -> Result<(), String> {
    if args.example {
        print!("{COMMENTS_EXAMPLE}");
        return Ok(());
    }

    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let raw = read_stdin_or_file(args.file.as_deref())?;
    let inputs: Vec<CommentInput> = serde_json::from_str(&raw)
        .map_err(|e| format!("Invalid comments JSON (expected an array): {e}"))?;
    if inputs.is_empty() {
        return Err("No comments to submit (the array is empty).".to_owned());
    }

    let author = args
        .author
        .or_else(|| std::env::var("REVIEW_AUTHOR").ok())
        .or_else(|| default_git_user(&repo));
    let source = resolve_source(args.source)?;
    let created_at = now_iso8601();

    // Build every annotation up front so IDs are stable across mutate retries.
    let mut annotations: Vec<LineAnnotation> = Vec::with_capacity(inputs.len());
    for (index, input) in inputs.into_iter().enumerate() {
        validate_comment_input(&input).map_err(|e| format!("comment[{index}]: {e}"))?;
        let side_str = input.side.as_str();
        // Drop a redundant end == start, matching `parse_location`.
        let end_line = input.end_line.filter(|e| *e != input.line);
        annotations.push(LineAnnotation {
            id: new_annotation_id(&input.path, input.line, side_str),
            file_path: input.path,
            line_number: input.line,
            end_line_number: end_line,
            side: input.side,
            content: input.content,
            created_at: created_at.clone(),
            author: author.clone(),
            source: Some(source),
            updated_at: None,
            resolved_at: None,
            resolved_by: None,
        });
    }

    let ids: Vec<String> = annotations.iter().map(|a| a.id.clone()).collect();
    let (review, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;
    let comparison = &review.comparison;
    let state = mutate_review(&repo, &review.ref_name, &hunks, |state| {
        state.annotations.extend(annotations.iter().cloned());
        true
    })?;

    if args.json {
        print_json(&CommentsSubmitJson {
            comparison: comparison.key.clone(),
            added: ids.len(),
            ids,
            version: state.version,
        });
    } else {
        println!(
            "Added {} comment(s) on {} (review v{})",
            ids.len(),
            comparison.key,
            state.version
        );
    }
    Ok(())
}

/// Validate a batch comment: line numbers are 1-based and ranges non-inverted,
/// matching `parse_location`'s rules for the single-comment path.
fn validate_comment_input(input: &CommentInput) -> Result<(), String> {
    if input.path.is_empty() {
        return Err("empty path".to_owned());
    }
    if input.content.trim().is_empty() {
        return Err("empty content".to_owned());
    }
    if input.line == 0 {
        return Err("line 0 is invalid (line numbers are 1-based)".to_owned());
    }
    if let Some(end) = input.end_line {
        if end < input.line {
            return Err(format!(
                "end line {end} is before start line {}",
                input.line
            ));
        }
    }
    Ok(())
}

fn read_stdin_or_file(file: Option<&str>) -> Result<String, String> {
    match file {
        None | Some("-") => {
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| format!("Could not read comments from stdin: {e}"))?;
            Ok(buf)
        }
        Some(path) => {
            std::fs::read_to_string(path).map_err(|e| format!("Could not read '{path}': {e}"))
        }
    }
}

/// `review comment edit` — replace the content of an existing comment.
pub fn run_edit(target: ReviewTarget, args: EditArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let (review, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;
    let comparison = &review.comparison;

    let id = args.id.clone();
    let new_content = args.content.clone();
    let outcome = Cell::new(MutationOutcome::NotFound);
    let state = mutate_review(
        &repo,
        &review.ref_name,
        &hunks,
        |state| match find_annotation_mut(state, &id) {
            Some(a) if a.content == new_content => {
                outcome.set(MutationOutcome::NoOp);
                false
            }
            Some(a) => {
                a.content.clone_from(&new_content);
                a.updated_at = Some(now_iso8601());
                outcome.set(MutationOutcome::Changed);
                true
            }
            None => {
                outcome.set(MutationOutcome::NotFound);
                false
            }
        },
    )?;

    finish_mutation(
        &args.id,
        &comparison.key,
        state.version,
        outcome.get(),
        "edit",
        "Edited",
        "No change",
        args.json,
    )
}

/// `review comment resolve` — mark a comment as resolved.
pub fn run_resolve(target: ReviewTarget, args: ResolveArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let (review, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;
    let comparison = &review.comparison;

    let by = args
        .by
        .or_else(|| std::env::var("REVIEW_AUTHOR").ok())
        .or_else(|| default_git_user(&repo));
    let id = args.id.clone();
    let by_for_apply = by.clone();
    let outcome = Cell::new(MutationOutcome::NotFound);
    let state = mutate_review(&repo, &review.ref_name, &hunks, |state| {
        match find_annotation_mut(state, &id) {
            Some(a) if a.resolved_at.is_some() => {
                // Already resolved — keep the prior resolver's attribution
                // and timestamp. Idempotent no-op.
                outcome.set(MutationOutcome::NoOp);
                false
            }
            Some(a) => {
                a.resolved_at = Some(now_iso8601());
                a.resolved_by = by_for_apply.clone();
                outcome.set(MutationOutcome::Changed);
                true
            }
            None => {
                outcome.set(MutationOutcome::NotFound);
                false
            }
        }
    })?;

    finish_mutation(
        &args.id,
        &comparison.key,
        state.version,
        outcome.get(),
        "resolve",
        "Resolved",
        "Already resolved",
        args.json,
    )
}

/// `review comment unresolve` — clear the resolved state.
pub fn run_unresolve(target: ReviewTarget, args: IdArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let (review, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;
    let comparison = &review.comparison;

    let id = args.id.clone();
    let outcome = Cell::new(MutationOutcome::NotFound);
    let state = mutate_review(
        &repo,
        &review.ref_name,
        &hunks,
        |state| match find_annotation_mut(state, &id) {
            Some(a) if a.resolved_at.is_none() => {
                outcome.set(MutationOutcome::NoOp);
                false
            }
            Some(a) => {
                a.resolved_at = None;
                a.resolved_by = None;
                outcome.set(MutationOutcome::Changed);
                true
            }
            None => {
                outcome.set(MutationOutcome::NotFound);
                false
            }
        },
    )?;

    finish_mutation(
        &args.id,
        &comparison.key,
        state.version,
        outcome.get(),
        "unresolve",
        "Unresolved",
        "Already unresolved",
        args.json,
    )
}

/// `review comment delete` — remove a comment.
pub fn run_delete(target: ReviewTarget, args: IdArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let (review, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;
    let comparison = &review.comparison;

    let id = args.id.clone();
    let outcome = Cell::new(MutationOutcome::NotFound);
    let state = mutate_review(&repo, &review.ref_name, &hunks, |state| {
        let before = state.annotations.len();
        state.annotations.retain(|a| a.id != id);
        if state.annotations.len() == before {
            outcome.set(MutationOutcome::NotFound);
            false
        } else {
            outcome.set(MutationOutcome::Changed);
            true
        }
    })?;

    finish_mutation(
        &args.id,
        &comparison.key,
        state.version,
        outcome.get(),
        "delete",
        "Deleted",
        "Already deleted",
        args.json,
    )
}

#[derive(Debug, Clone, Copy)]
enum MutationOutcome {
    Changed,
    NoOp,
    NotFound,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommentNoopJson<'a> {
    comparison: &'a str,
    action: &'a str,
    id: &'a str,
    note: &'a str,
    version: u64,
}

#[allow(clippy::too_many_arguments)]
fn finish_mutation(
    id: &str,
    comparison: &str,
    version: u64,
    outcome: MutationOutcome,
    action: &'static str,
    success_verb: &'static str,
    noop_label: &'static str,
    json: bool,
) -> Result<(), String> {
    match outcome {
        MutationOutcome::NotFound => Err(format!(
            "Comment {id} not found in {comparison} (may have been deleted concurrently)"
        )),
        MutationOutcome::NoOp => {
            if json {
                print_json(&CommentNoopJson {
                    comparison,
                    action,
                    id,
                    note: noop_label,
                    version,
                });
            } else {
                println!("{noop_label}: comment {id} on {comparison} (review v{version})");
            }
            Ok(())
        }
        MutationOutcome::Changed => {
            if json {
                print_json(&CommentResultJson {
                    comparison: comparison.to_owned(),
                    action,
                    id: id.to_owned(),
                    version,
                });
            } else {
                println!("{success_verb} comment {id} on {comparison} (review v{version})");
            }
            Ok(())
        }
    }
}

fn find_annotation_mut<'a>(state: &'a mut ReviewState, id: &str) -> Option<&'a mut LineAnnotation> {
    state.annotations.iter_mut().find(|a| a.id == id)
}

/// Parse `path/to/file:42` or `path/to/file:10-15` into `(file, start, end?)`.
/// Line numbers are 1-based; line 0 is rejected to match the desktop renderer.
fn parse_location(raw: &str) -> Result<(String, u32, Option<u32>), String> {
    let (file, range) = raw.rsplit_once(':').ok_or_else(|| {
        format!("Invalid location '{raw}': expected 'path:LINE' or 'path:START-END'")
    })?;
    if file.is_empty() {
        return Err(format!("Invalid location '{raw}': empty file path"));
    }
    let (start_str, end_str) = match range.split_once('-') {
        Some((s, e)) => (s, Some(e)),
        None => (range, None),
    };
    let start: u32 = start_str
        .parse()
        .map_err(|_| format!("Invalid start line '{start_str}' in '{raw}'"))?;
    if start == 0 {
        return Err(format!(
            "Invalid line number 0 in '{raw}': line numbers are 1-based"
        ));
    }
    let end: Option<u32> = match end_str {
        Some(e) => Some(
            e.parse()
                .map_err(|_| format!("Invalid end line '{e}' in '{raw}'"))?,
        ),
        None => None,
    };
    if let Some(end_val) = end {
        if end_val < start {
            return Err(format!(
                "Invalid range '{range}': end {end_val} is before start {start}"
            ));
        }
    }
    // Drop redundant end_line_number when it matches the start, matching what
    // the UI's `addAnnotation` does — keeps round-tripped IDs and JSON clean.
    let end = end.filter(|e| *e != start);
    Ok((file.to_owned(), start, end))
}

pub(super) fn parse_source_str(value: &str) -> Option<Source> {
    match value.to_ascii_lowercase().as_str() {
        "ui" => Some(Source::Ui),
        "cli" => Some(Source::Cli),
        "agent" => Some(Source::Agent),
        "github" => Some(Source::Github),
        "gitlab" => Some(Source::Gitlab),
        _ => None,
    }
}

pub(super) fn default_git_user(repo: &Path) -> Option<String> {
    // Pass `-C <repo>` so the lookup respects the target repository's
    // per-repo `user.name`, not whatever cwd the CLI happens to run in.
    let output = Command::new("git")
        .args(["-C"])
        .arg(repo.as_os_str())
        .args(["config", "user.name"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let name = String::from_utf8(output.stdout).ok()?.trim().to_owned();
    if name.is_empty() {
        None
    } else {
        Some(name)
    }
}

/// Build a unique annotation ID. The trailing segment is `t{epoch_ms}-{counter}`;
/// the `t` prefix means `parse_hunk_target`'s all-hex heuristic never mistakes
/// a comment ID for a hunk hash, and the per-process counter guarantees
/// uniqueness across rapid creations within the same millisecond.
fn new_annotation_id(file_path: &str, line_number: u32, side: &str) -> String {
    format!(
        "{file_path}:{line_number}:{side}:{}",
        super::common::new_id_suffix()
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_location_single_line() {
        let (f, s, e) = parse_location("src/foo.rs:42").unwrap();
        assert_eq!(f, "src/foo.rs");
        assert_eq!(s, 42);
        assert_eq!(e, None);
    }

    #[test]
    fn parse_location_range() {
        let (f, s, e) = parse_location("a/b.rs:10-15").unwrap();
        assert_eq!(f, "a/b.rs");
        assert_eq!(s, 10);
        assert_eq!(e, Some(15));
    }

    #[test]
    fn parse_location_rejects_inverted_range() {
        assert!(parse_location("a:10-5").is_err());
    }

    #[test]
    fn parse_location_requires_colon() {
        assert!(parse_location("no-colon").is_err());
    }

    #[test]
    fn parse_location_rejects_non_numeric() {
        assert!(parse_location("a:abc").is_err());
    }

    #[test]
    fn parse_location_rejects_line_zero() {
        // Line numbers are 1-based to match the UI renderer.
        assert!(parse_location("a:0").is_err());
    }

    #[test]
    fn parse_location_strips_redundant_end_line() {
        // end == start is the same as no end — keep state clean.
        let (_, s, e) = parse_location("a:5-5").unwrap();
        assert_eq!(s, 5);
        assert_eq!(e, None);
    }

    #[test]
    fn new_annotation_id_has_non_hex_prefix() {
        // Comment IDs must not collide with `parse_hunk_target`'s all-hex
        // heuristic. The `t` prefix on the trailing segment guarantees that.
        let id = new_annotation_id("src/foo.rs", 42, "new");
        let trailing = id.rsplit_once(':').unwrap().1;
        assert!(trailing.starts_with('t'));
        assert!(!trailing.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn new_annotation_id_unique_within_process() {
        // Rapid creates within the same millisecond must still produce
        // unique IDs.
        let a = new_annotation_id("f.rs", 1, "new");
        let b = new_annotation_id("f.rs", 1, "new");
        assert_ne!(a, b);
    }

    #[test]
    fn comments_example_parses_as_batch_input() {
        // The `comments submit --example` skeleton must be valid batch input.
        let inputs: Vec<CommentInput> = serde_json::from_str(COMMENTS_EXAMPLE).unwrap();
        assert_eq!(inputs.len(), 2);
        for input in &inputs {
            assert!(validate_comment_input(input).is_ok());
        }
    }

    #[test]
    fn comment_input_defaults_side_to_new() {
        let input: CommentInput =
            serde_json::from_str(r#"{ "path": "a.rs", "line": 1, "content": "hi" }"#).unwrap();
        assert!(matches!(input.side, AnnotationSide::New));
        assert_eq!(input.end_line, None);
    }

    #[test]
    fn validate_comment_input_rejects_bad_lines() {
        let zero = CommentInput {
            path: "a.rs".into(),
            line: 0,
            end_line: None,
            side: AnnotationSide::New,
            content: "x".into(),
        };
        assert!(validate_comment_input(&zero).is_err());

        let inverted = CommentInput {
            path: "a.rs".into(),
            line: 10,
            end_line: Some(5),
            side: AnnotationSide::New,
            content: "x".into(),
        };
        assert!(validate_comment_input(&inverted).is_err());

        let empty = CommentInput {
            path: "a.rs".into(),
            line: 1,
            end_line: None,
            side: AnnotationSide::New,
            content: "   ".into(),
        };
        assert!(validate_comment_input(&empty).is_err());
    }

    #[test]
    fn parse_source_str_rejects_unknown() {
        assert!(parse_source_str("agnet").is_none());
        assert_eq!(
            parse_source_str("AGENT"),
            Some(crate::review::state::Source::Agent),
        );
    }
}
