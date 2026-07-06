//! Findings subcommands: `findings submit`, `findings` (list), `finding
//! show|resolve|reopen`, and `runs`.
//!
//! A `submit` records one [`ReviewRun`] plus its [`Finding`]s in a single
//! transaction — an agent's proof that a review pass ran, and the issues it
//! raised. Findings carry an append-only disposition log; `resolve`/`reopen`
//! append to it rather than mutating a status field, and the current status is
//! derived from the last event.

use std::cell::Cell;
use std::collections::HashMap;
use std::io::Read;
use std::path::PathBuf;

use clap::{Args, Subcommand};
use serde::{Deserialize, Serialize};

use crate::diff::parser::DiffHunk;
use crate::review::state::{
    now_iso8601, AnnotationSide, DispositionAction, DispositionEvent, Evidence, EvidenceKind,
    Finding, FindingAnchor, FindingConfidence, FindingKind, FindingSeverity, ReviewRun,
    ReviewState,
};
use crate::review::storage;

use super::comments::default_git_user;
use super::common::{
    line_range, load_for_mutation, mutate_review, print_json, resolve_comparison_arg,
    resolve_source, ReviewTarget,
};
use super::get_repo_path;

// ---------------------------------------------------------------------------
// Argument structs
// ---------------------------------------------------------------------------

/// `review findings` — either `submit` a run, or list findings with filters
/// (when no subcommand is given).
#[derive(Debug, Args)]
pub struct FindingsArgs {
    #[command(subcommand)]
    pub action: Option<FindingsAction>,

    // Filters for the bare `review findings` listing (ignored when a subcommand
    // is present).
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Only show open findings
    #[arg(long, conflicts_with = "resolved")]
    pub open: bool,
    /// Only show resolved findings
    #[arg(long, conflicts_with = "open")]
    pub resolved: bool,
    /// Filter by kind (bug, risk, question, improvement)
    #[arg(long)]
    pub kind: Option<KindArg>,
    /// Filter by severity (high, medium, low)
    #[arg(long)]
    pub severity: Option<SeverityArg>,
    /// Filter to a run ID
    #[arg(long)]
    pub run: Option<String>,
    /// Filter to a file-path glob (e.g. "src/*.rs")
    #[arg(long)]
    pub file: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Subcommand)]
pub enum FindingsAction {
    /// Submit a review run and its findings from JSON (FILE, or stdin)
    Submit(SubmitArgs),
}

#[derive(Debug, Args)]
pub struct SubmitArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// JSON file to read (defaults to stdin; "-" also reads stdin)
    pub file: Option<String>,
    /// Override the author (default: $REVIEW_AUTHOR or `git config user.name`)
    #[arg(long)]
    pub author: Option<String>,
    /// Override the source (default: $REVIEW_SOURCE or `cli`)
    #[arg(long)]
    pub source: Option<super::comments::SourceArg>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// `review finding <id> …` — operate on a single finding.
#[derive(Debug, Args)]
pub struct FindingArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    #[command(subcommand)]
    pub action: FindingAction,
}

#[derive(Debug, Subcommand)]
pub enum FindingAction {
    /// Show a finding's full detail and event log
    Show(ShowArgs),
    /// Append a disposition event resolving the finding
    Resolve(ResolveArgs),
    /// Append a Reopened event, returning the finding to open
    Reopen(ReopenArgs),
}

#[derive(Debug, Args)]
pub struct ShowArgs {
    /// Finding ID (from `review findings`)
    pub id: String,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ResolveArgs {
    /// Finding ID
    pub id: String,
    /// How the finding was disposed of
    #[arg(long = "as", value_name = "ACTION")]
    pub as_action: ResolveAsArg,
    /// Optional reason for the disposition
    #[arg(long)]
    pub reason: Option<String>,
    /// Optional free-text evidence (recorded as reasoning)
    #[arg(long)]
    pub evidence: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ReopenArgs {
    /// Finding ID
    pub id: String,
    /// Optional reason for reopening
    #[arg(long)]
    pub reason: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

/// `review runs` — list the recorded review passes.
#[derive(Debug, Args)]
pub struct RunsArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

// ---------------------------------------------------------------------------
// CLI value enums (filters + resolve action)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, clap::ValueEnum)]
pub enum KindArg {
    Bug,
    Risk,
    Question,
    Improvement,
}

impl From<KindArg> for FindingKind {
    fn from(value: KindArg) -> Self {
        match value {
            KindArg::Bug => FindingKind::Bug,
            KindArg::Risk => FindingKind::Risk,
            KindArg::Question => FindingKind::Question,
            KindArg::Improvement => FindingKind::Improvement,
        }
    }
}

#[derive(Debug, Clone, Copy, clap::ValueEnum)]
pub enum SeverityArg {
    High,
    Medium,
    Low,
}

impl From<SeverityArg> for FindingSeverity {
    fn from(value: SeverityArg) -> Self {
        match value {
            SeverityArg::High => FindingSeverity::High,
            SeverityArg::Medium => FindingSeverity::Medium,
            SeverityArg::Low => FindingSeverity::Low,
        }
    }
}

/// The dispositions a human can apply via `finding resolve --as`. Excludes
/// `Reopened`, which has its own `finding reopen` command.
#[derive(Debug, Clone, Copy, clap::ValueEnum)]
pub enum ResolveAsArg {
    Fixed,
    FalsePositive,
    AcceptedRisk,
    Deferred,
}

impl From<ResolveAsArg> for DispositionAction {
    fn from(value: ResolveAsArg) -> Self {
        match value {
            ResolveAsArg::Fixed => DispositionAction::Fixed,
            ResolveAsArg::FalsePositive => DispositionAction::FalsePositive,
            ResolveAsArg::AcceptedRisk => DispositionAction::AcceptedRisk,
            ResolveAsArg::Deferred => DispositionAction::Deferred,
        }
    }
}

// ---------------------------------------------------------------------------
// Submit input shape (distinct from the stored model — camelCase `path`/`line`)
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
struct SubmitInput {
    run: RunInput,
    #[serde(default)]
    findings: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
struct RunInput {
    tool: String,
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    summary: Option<String>,
}

#[derive(Debug, Deserialize)]
struct FindingInput {
    kind: FindingKind,
    severity: FindingSeverity,
    #[serde(default)]
    confidence: Option<FindingConfidence>,
    title: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    suggestion: Option<String>,
    anchor: AnchorInput,
    #[serde(default)]
    evidence: Vec<Evidence>,
    #[serde(default, rename = "producerId")]
    producer_id: Option<String>,
    #[serde(default)]
    resolution: Option<ResolutionInput>,
}

#[derive(Debug, Deserialize)]
struct AnchorInput {
    path: String,
    #[serde(default)]
    line: Option<u32>,
    #[serde(default, rename = "endLine")]
    end_line: Option<u32>,
    #[serde(default)]
    side: AnnotationSide,
}

#[derive(Debug, Deserialize)]
struct ResolutionInput {
    action: DispositionAction,
    #[serde(default)]
    reason: Option<String>,
    #[serde(default)]
    evidence: Option<Evidence>,
}

// ---------------------------------------------------------------------------
// JSON output shapes
// ---------------------------------------------------------------------------

/// A finding serialized with its derived status for `--json` output.
#[derive(Debug, Serialize)]
struct FindingJson<'a> {
    #[serde(flatten)]
    finding: &'a Finding,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolution: Option<&'static str>,
}

impl<'a> FindingJson<'a> {
    fn of(finding: &'a Finding) -> Self {
        let status = finding.derived_status();
        FindingJson {
            finding,
            status: status.label(),
            resolution: status.resolution(),
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FindingsListJson<'a> {
    comparison: String,
    total: usize,
    findings: Vec<FindingJson<'a>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmitResultJson<'a> {
    comparison: String,
    run: &'a ReviewRun,
    findings: Vec<FindingJson<'a>>,
    pre_resolved: usize,
    version: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FindingResultJson<'a> {
    comparison: &'a str,
    action: &'static str,
    id: &'a str,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolution: Option<&'static str>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    already: bool,
    version: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunJson<'a> {
    #[serde(flatten)]
    run: &'a ReviewRun,
    findings: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct RunsListJson<'a> {
    comparison: String,
    total: usize,
    runs: Vec<RunJson<'a>>,
}

// ---------------------------------------------------------------------------
// ID generation (annotation style: non-hex `t{epoch}-{counter}` suffix)
// ---------------------------------------------------------------------------

/// A unique ID of the form `{prefix}:t{epoch_ms}-{counter}`. The `t` prefix
/// keeps `parse_hunk_target`'s all-hex heuristic from mistaking it for a hunk
/// hash; the per-process counter guarantees uniqueness within a millisecond
/// (e.g. a run and its findings all created in one submit).
fn new_id(prefix: &str) -> String {
    format!("{prefix}:{}", super::common::new_id_suffix())
}

// ---------------------------------------------------------------------------
// Hunk anchoring (best-effort)
// ---------------------------------------------------------------------------

/// Find the current hunk on `file_path` whose range on the given side contains
/// `line` (1-based). Best-effort — anchoring never fails a submit.
fn anchor_hunk<'a>(
    hunks: &'a [DiffHunk],
    file_path: &str,
    line: u32,
    side: AnnotationSide,
) -> Option<&'a DiffHunk> {
    hunks.iter().find(|h| {
        h.file_path == file_path
            && match side {
                AnnotationSide::New => {
                    h.new_count > 0 && line >= h.new_start && line < h.new_start + h.new_count
                }
                AnnotationSide::Old => {
                    h.old_count > 0 && line >= h.old_start && line < h.old_start + h.old_count
                }
                AnnotationSide::File => false, // file-level: no line match
            }
    })
}

// ---------------------------------------------------------------------------
// submit
// ---------------------------------------------------------------------------

/// `review findings submit` — record a run and its findings in one transaction.
pub fn run_submit(args: SubmitArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let raw = read_input(args.file.as_deref())?;
    let input: SubmitInput =
        serde_json::from_str(&raw).map_err(|e| format!("Invalid findings JSON: {e}"))?;

    let author = args
        .author
        .or_else(|| std::env::var("REVIEW_AUTHOR").ok())
        .or_else(|| default_git_user(&repo));
    let source = resolve_source(args.source)?;

    let (comparison, hunks, _) = load_for_mutation(&repo, args.target.spec.as_deref())?;

    let now = now_iso8601();
    let run = ReviewRun {
        id: new_id("run"),
        tool: input.run.tool,
        model: input.run.model,
        summary: input.run.summary,
        author: author.clone(),
        source,
        created_at: now.clone(),
    };

    // Build findings up-front so IDs are stable across mutate_review retries.
    let mut findings: Vec<Finding> = Vec::with_capacity(input.findings.len());
    let mut pre_resolved = 0usize;
    for (index, value) in input.findings.into_iter().enumerate() {
        let parsed: FindingInput =
            serde_json::from_value(value).map_err(|e| format!("finding[{index}]: {e}"))?;
        let matched = parsed
            .anchor
            .line
            .and_then(|line| anchor_hunk(&hunks, &parsed.anchor.path, line, parsed.anchor.side));
        let hunk_id = matched.map(|h| h.id.clone());
        let stable_key = matched.map(|h| h.stable_hash());
        let events = match parsed.resolution {
            Some(res) => {
                if res.action == DispositionAction::Reopened {
                    return Err(format!(
                        "finding[{index}]: resolution.action cannot be \"reopened\" — a finding cannot be submitted already-reopened"
                    ));
                }
                pre_resolved += 1;
                vec![DispositionEvent {
                    action: res.action,
                    actor: author.clone(),
                    source,
                    at: now.clone(),
                    reason: res.reason,
                    evidence: res.evidence,
                }]
            }
            None => Vec::new(),
        };
        findings.push(Finding {
            id: new_id("finding"),
            producer_id: parsed.producer_id,
            run_id: Some(run.id.clone()),
            kind: parsed.kind,
            severity: parsed.severity,
            confidence: parsed.confidence,
            title: parsed.title,
            body: parsed.body,
            suggestion: parsed.suggestion,
            evidence: parsed.evidence,
            anchor: FindingAnchor {
                file_path: parsed.anchor.path,
                line_number: parsed.anchor.line,
                end_line_number: parsed.anchor.end_line,
                side: parsed.anchor.side,
                hunk_id,
                stable_key,
            },
            events,
            author: author.clone(),
            source,
            created_at: now.clone(),
        });
    }

    let state = mutate_review(&repo, &comparison, &hunks, |state| {
        state.runs.push(run.clone());
        state.findings.extend(findings.iter().cloned());
        true
    })?;

    if args.json {
        print_json(&SubmitResultJson {
            comparison: comparison.key.clone(),
            run: &run,
            findings: findings.iter().map(FindingJson::of).collect(),
            pre_resolved,
            version: state.version,
        });
    } else {
        println!(
            "Submitted run {} on {} — {} finding(s) created, {} pre-resolved (review v{})",
            run.id,
            comparison.key,
            findings.len(),
            pre_resolved,
            state.version
        );
    }
    Ok(())
}

fn read_input(file: Option<&str>) -> Result<String, String> {
    match file {
        None | Some("-") => {
            let mut buf = String::new();
            std::io::stdin()
                .read_to_string(&mut buf)
                .map_err(|e| format!("Could not read findings from stdin: {e}"))?;
            Ok(buf)
        }
        Some(path) => {
            std::fs::read_to_string(path).map_err(|e| format!("Could not read '{path}': {e}"))
        }
    }
}

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

/// `review findings` — list findings with their derived status.
pub fn run_list(args: FindingsArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let comparison = resolve_comparison_arg(&repo, args.target.spec.as_deref())?;
    let state = storage::load_review_state(&repo, &comparison).map_err(|e| e.to_string())?;

    let file_filter = match &args.file {
        Some(glob) => {
            Some(glob::Pattern::new(glob).map_err(|e| format!("Invalid --file pattern: {e}"))?)
        }
        None => None,
    };
    let kind_filter: Option<FindingKind> = args.kind.map(Into::into);
    let severity_filter: Option<FindingSeverity> = args.severity.map(Into::into);

    let mut filtered: Vec<&Finding> = state
        .findings
        .iter()
        .filter(|f| {
            let is_open = f.is_open();
            if args.open && !is_open {
                return false;
            }
            if args.resolved && is_open {
                return false;
            }
            if let Some(kind) = kind_filter {
                if f.kind != kind {
                    return false;
                }
            }
            if let Some(sev) = severity_filter {
                if f.severity != sev {
                    return false;
                }
            }
            if let Some(run) = &args.run {
                if f.run_id.as_deref() != Some(run.as_str()) {
                    return false;
                }
            }
            if let Some(pattern) = &file_filter {
                if !pattern.matches(&f.anchor.file_path) {
                    return false;
                }
            }
            true
        })
        .collect();

    filtered.sort_by(|a, b| {
        a.anchor
            .file_path
            .cmp(&b.anchor.file_path)
            .then(a.anchor.line_number.cmp(&b.anchor.line_number))
            .then(a.created_at.cmp(&b.created_at))
    });

    if args.json {
        print_json(&FindingsListJson {
            comparison: comparison.key.clone(),
            total: filtered.len(),
            findings: filtered.iter().map(|f| FindingJson::of(f)).collect(),
        });
    } else {
        print_findings_human(&comparison.key, state.findings.len(), &filtered);
    }
    Ok(())
}

fn print_findings_human(comparison: &str, total: usize, rows: &[&Finding]) {
    if rows.is_empty() {
        if total == 0 {
            println!("(no findings on {comparison})");
        } else {
            println!("(no findings match the filter; {total} total on {comparison})");
        }
        return;
    }
    let open = rows.iter().filter(|f| f.is_open()).count();
    let resolved = rows.len() - open;
    println!(
        "{} finding(s) on {comparison} · {open} open · {resolved} resolved\n",
        rows.len()
    );
    for f in rows {
        let status = f.derived_status();
        let status_label = match status.resolution() {
            Some(action) => format!("resolved:{action}"),
            None => "open".to_owned(),
        };
        let loc = match f.anchor.line_number {
            Some(line) => format!("{}:{line}", f.anchor.file_path),
            None => f.anchor.file_path.clone(),
        };
        let kind = f.kind.as_str();
        let severity = f.severity.as_str();
        println!(
            "{}  [{status_label}]  {kind}/{severity}  {}  {loc}",
            f.id, f.title
        );
    }
}

// ---------------------------------------------------------------------------
// show
// ---------------------------------------------------------------------------

/// `review finding show` — full detail and event log for one finding.
pub fn run_show(target: ReviewTarget, args: ShowArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let comparison = resolve_comparison_arg(&repo, target.spec.as_deref())?;
    let state = storage::load_review_state(&repo, &comparison).map_err(|e| e.to_string())?;

    let finding = state
        .findings
        .iter()
        .find(|f| f.id == args.id)
        .ok_or_else(|| format!("Finding {} not found in {}", args.id, comparison.key))?;

    if args.json {
        print_json(&FindingJson::of(finding));
    } else {
        print_finding_detail(finding);
    }
    Ok(())
}

fn print_finding_detail(f: &Finding) {
    let status = f.derived_status();
    let status_label = match status.resolution() {
        Some(action) => format!("resolved ({action})"),
        None => "open".to_owned(),
    };
    println!("{}  [{status_label}]", f.id);
    println!("  {}", f.title);
    println!(
        "  {}/{}{}",
        f.kind.as_str(),
        f.severity.as_str(),
        f.confidence
            .map(|c| format!(" · {}", c.as_str()))
            .unwrap_or_default()
    );
    let loc = match f.anchor.line_number {
        Some(line) => format!(
            "{}:{}",
            f.anchor.file_path,
            line_range(line, f.anchor.end_line_number)
        ),
        None => f.anchor.file_path.clone(),
    };
    println!("  {loc} ({})", f.anchor.side.as_str());
    if let Some(hunk) = &f.anchor.hunk_id {
        println!("  hunk: {hunk}");
    }
    if let Some(run) = &f.run_id {
        println!("  run: {run}");
    }
    if let Some(producer) = &f.producer_id {
        println!("  producer id: {producer}");
    }
    println!(
        "  by {} via {} at {}",
        f.author.as_deref().unwrap_or("?"),
        f.source.as_str(),
        f.created_at
    );
    if let Some(body) = &f.body {
        println!("\n{body}");
    }
    if let Some(suggestion) = &f.suggestion {
        println!("\nSuggestion:\n  {suggestion}");
    }
    if !f.evidence.is_empty() {
        println!("\nEvidence:");
        for e in &f.evidence {
            print_evidence(e, "  ");
        }
    }
    if f.events.is_empty() {
        println!("\nEvents: (none — open)");
    } else {
        println!("\nEvents:");
        for event in &f.events {
            println!(
                "  {} — {} via {} at {}",
                event.action.as_str(),
                event.actor.as_deref().unwrap_or("?"),
                event.source.as_str(),
                event.at
            );
            if let Some(reason) = &event.reason {
                println!("      {reason}");
            }
            if let Some(e) = &event.evidence {
                print_evidence(e, "      ");
            }
        }
    }
}

fn print_evidence(e: &Evidence, indent: &str) {
    let kind = e.kind.as_str();
    println!("{indent}[{kind}]");
    if let Some(desc) = &e.description {
        println!("{indent}  {desc}");
    }
    if let Some(cmd) = &e.command {
        println!("{indent}  $ {cmd}");
    }
    if let Some(out) = &e.output {
        for line in out.lines() {
            println!("{indent}  {line}");
        }
    }
}

// ---------------------------------------------------------------------------
// resolve / reopen
// ---------------------------------------------------------------------------

/// `review finding resolve` — append a disposition event. Always appends (the
/// log is the history), but notes when the finding was already resolved.
pub fn run_resolve(target: ReviewTarget, args: ResolveArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let (comparison, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;

    let actor = std::env::var("REVIEW_AUTHOR")
        .ok()
        .or_else(|| default_git_user(&repo));
    let source = resolve_source(None)?;
    let action: DispositionAction = args.as_action.into();
    let evidence = args.evidence.map(|text| Evidence {
        kind: EvidenceKind::Reasoning,
        description: Some(text),
        command: None,
        output: None,
    });

    let id = args.id.clone();
    // `None` = finding not found; `Some(was_resolved)` = event appended.
    let outcome: Cell<Option<bool>> = Cell::new(None);
    let state = mutate_review(&repo, &comparison, &hunks, |state| {
        match find_finding_mut(state, &id) {
            Some(f) => {
                let was_resolved = !f.is_open();
                f.events.push(DispositionEvent {
                    action,
                    actor: actor.clone(),
                    source,
                    at: now_iso8601(),
                    reason: args.reason.clone(),
                    evidence: evidence.clone(),
                });
                outcome.set(Some(was_resolved));
                true
            }
            None => {
                outcome.set(None);
                false
            }
        }
    })?;

    match outcome.into_inner() {
        None => Err(format!(
            "Finding {} not found in {} (may have been deleted concurrently)",
            args.id, comparison.key
        )),
        Some(was_resolved) => {
            let status_action = action.as_str();
            if args.json {
                print_json(&FindingResultJson {
                    comparison: &comparison.key,
                    action: "resolve",
                    id: &args.id,
                    status: "resolved",
                    resolution: Some(status_action),
                    already: was_resolved,
                    version: state.version,
                });
            } else {
                if was_resolved {
                    println!(
                        "Note: finding {} was already resolved; appended another event.",
                        args.id
                    );
                }
                println!(
                    "Resolved finding {} as {status_action} on {} (review v{})",
                    args.id, comparison.key, state.version
                );
            }
            Ok(())
        }
    }
}

/// The result of a reopen attempt.
enum ReopenOutcome {
    NotFound,
    AlreadyOpen,
    Reopened,
}

/// `review finding reopen` — append a Reopened event. Idempotent: reopening an
/// already-open finding is a no-op.
pub fn run_reopen(target: ReviewTarget, args: ReopenArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&target.repo)?);
    let (comparison, hunks, _) = load_for_mutation(&repo, target.spec.as_deref())?;

    let actor = std::env::var("REVIEW_AUTHOR")
        .ok()
        .or_else(|| default_git_user(&repo));
    let source = resolve_source(None)?;

    let id = args.id.clone();
    let outcome: Cell<ReopenOutcome> = Cell::new(ReopenOutcome::NotFound);
    let state = mutate_review(&repo, &comparison, &hunks, |state| {
        match find_finding_mut(state, &id) {
            Some(f) if f.is_open() => {
                outcome.set(ReopenOutcome::AlreadyOpen);
                false
            }
            Some(f) => {
                f.events.push(DispositionEvent {
                    action: DispositionAction::Reopened,
                    actor: actor.clone(),
                    source,
                    at: now_iso8601(),
                    reason: args.reason.clone(),
                    evidence: None,
                });
                outcome.set(ReopenOutcome::Reopened);
                true
            }
            None => {
                outcome.set(ReopenOutcome::NotFound);
                false
            }
        }
    })?;

    match outcome.into_inner() {
        ReopenOutcome::NotFound => Err(format!(
            "Finding {} not found in {} (may have been deleted concurrently)",
            args.id, comparison.key
        )),
        ReopenOutcome::AlreadyOpen => {
            if args.json {
                print_json(&FindingResultJson {
                    comparison: &comparison.key,
                    action: "reopen",
                    id: &args.id,
                    status: "open",
                    resolution: None,
                    already: true,
                    version: state.version,
                });
            } else {
                println!(
                    "Already open: finding {} on {} (review v{})",
                    args.id, comparison.key, state.version
                );
            }
            Ok(())
        }
        ReopenOutcome::Reopened => {
            if args.json {
                print_json(&FindingResultJson {
                    comparison: &comparison.key,
                    action: "reopen",
                    id: &args.id,
                    status: "open",
                    resolution: None,
                    already: false,
                    version: state.version,
                });
            } else {
                println!(
                    "Reopened finding {} on {} (review v{})",
                    args.id, comparison.key, state.version
                );
            }
            Ok(())
        }
    }
}

fn find_finding_mut<'a>(state: &'a mut ReviewState, id: &str) -> Option<&'a mut Finding> {
    state.findings.iter_mut().find(|f| f.id == id)
}

// ---------------------------------------------------------------------------
// runs
// ---------------------------------------------------------------------------

/// `review runs` — list recorded review passes.
pub fn run_runs(args: RunsArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let comparison = resolve_comparison_arg(&repo, args.target.spec.as_deref())?;
    let state = storage::load_review_state(&repo, &comparison).map_err(|e| e.to_string())?;

    let mut findings_by_run: HashMap<&str, usize> = HashMap::new();
    for f in &state.findings {
        if let Some(run_id) = f.run_id.as_deref() {
            *findings_by_run.entry(run_id).or_insert(0) += 1;
        }
    }
    let count_for = |run_id: &str| -> usize { findings_by_run.get(run_id).copied().unwrap_or(0) };

    if args.json {
        print_json(&RunsListJson {
            comparison: comparison.key.clone(),
            total: state.runs.len(),
            runs: state
                .runs
                .iter()
                .map(|run| RunJson {
                    run,
                    findings: count_for(&run.id),
                })
                .collect(),
        });
    } else if state.runs.is_empty() {
        println!("(no runs on {})", comparison.key);
    } else {
        println!("{} run(s) on {}\n", state.runs.len(), comparison.key);
        for run in &state.runs {
            let model = run.model.as_deref().unwrap_or("-");
            println!(
                "{}  {}  ({model})  {}  {} finding(s)",
                run.id,
                run.tool,
                run.created_at,
                count_for(&run.id),
            );
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::diff::parser::parse_multi_file_diff;

    fn hunks_from(diff: &str) -> Vec<DiffHunk> {
        parse_multi_file_diff(diff)
    }

    // Two files, each with one added line, so we know their new-side ranges.
    const DIFF: &str = "diff --git a/src/auth.rs b/src/auth.rs\n--- a/src/auth.rs\n+++ b/src/auth.rs\n@@ -140,3 +140,4 @@\n ctx\n more\n+let x = 1;\n tail\n";

    #[test]
    fn anchor_matches_new_side_line_inside_hunk() {
        let hunks = hunks_from(DIFF);
        let hunk = &hunks[0];
        // new_start 140, new_count 4 → covers 140..=143 on the new side.
        let matched = anchor_hunk(&hunks, "src/auth.rs", 142, AnnotationSide::New);
        assert_eq!(matched.map(|h| h.id.as_str()), Some(hunk.id.as_str()));
    }

    #[test]
    fn anchor_matches_old_side_line_inside_hunk() {
        let hunks = hunks_from(DIFF);
        let hunk = &hunks[0];
        // old_start 140, old_count 3 → covers 140..=142 on the old side.
        let matched = anchor_hunk(&hunks, "src/auth.rs", 141, AnnotationSide::Old);
        assert_eq!(matched.map(|h| h.id.as_str()), Some(hunk.id.as_str()));
        // Line 143 sits in the new-side range but past the old-side range, so
        // an old-side anchor there must not match.
        assert!(anchor_hunk(&hunks, "src/auth.rs", 143, AnnotationSide::Old).is_none());
    }

    #[test]
    fn anchor_returns_none_outside_any_hunk() {
        let hunks = hunks_from(DIFF);
        // Well past the hunk's new-side range.
        assert!(anchor_hunk(&hunks, "src/auth.rs", 9000, AnnotationSide::New).is_none());
        // Right file range but wrong file.
        assert!(anchor_hunk(&hunks, "src/other.rs", 142, AnnotationSide::New).is_none());
        // A file-level side never matches a line.
        assert!(anchor_hunk(&hunks, "src/auth.rs", 142, AnnotationSide::File).is_none());
    }

    #[test]
    fn submit_parses_full_example() {
        let json = r#"{
          "run": { "tool": "claude-code/code-review", "model": "m", "summary": "s" },
          "findings": [
            {
              "kind": "bug", "severity": "high", "confidence": "confirmed",
              "title": "expiry compared in ms vs s",
              "body": "b", "suggestion": "compare epoch seconds",
              "anchor": { "path": "src/auth.rs", "line": 142, "endLine": null, "side": "new" },
              "evidence": [ { "kind": "test", "command": "cargo test", "output": "FAILED" } ],
              "producerId": "cr-001",
              "resolution": { "action": "fixed", "reason": "r", "evidence": { "kind": "test", "command": "cargo test", "output": "ok" } }
            }
          ]
        }"#;
        let input: SubmitInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.run.tool, "claude-code/code-review");
        assert_eq!(input.findings.len(), 1);
        let parsed: FindingInput = serde_json::from_value(input.findings[0].clone()).unwrap();
        assert_eq!(parsed.kind, FindingKind::Bug);
        assert_eq!(parsed.severity, FindingSeverity::High);
        assert_eq!(parsed.anchor.path, "src/auth.rs");
        assert_eq!(parsed.anchor.line, Some(142));
        assert_eq!(parsed.producer_id.as_deref(), Some("cr-001"));
        let resolution = parsed.resolution.expect("resolution present");
        assert_eq!(resolution.action, DispositionAction::Fixed);
    }

    #[test]
    fn submit_run_only_has_no_findings() {
        let json = r#"{ "run": { "tool": "t" } }"#;
        let input: SubmitInput = serde_json::from_str(json).unwrap();
        assert_eq!(input.run.tool, "t");
        assert!(input.findings.is_empty());
    }

    #[test]
    fn submit_bad_enum_names_the_index() {
        // Two findings; the second has an invalid kind.
        let bad = serde_json::json!({
            "kind": "not-a-kind", "severity": "low",
            "title": "x", "anchor": { "path": "a.rs" }
        });
        let err = serde_json::from_value::<FindingInput>(bad)
            .map_err(|e| format!("finding[{}]: {e}", 1))
            .unwrap_err();
        assert!(err.starts_with("finding[1]:"), "got: {err}");
    }

    #[test]
    fn submit_missing_required_field_errors() {
        // Missing `title`.
        let bad = serde_json::json!({
            "kind": "bug", "severity": "low", "anchor": { "path": "a.rs" }
        });
        assert!(serde_json::from_value::<FindingInput>(bad).is_err());
    }

    fn git(dir: &std::path::Path, args: &[&str]) {
        let out = std::process::Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(out.status.success(), "git {args:?} failed");
    }

    #[test]
    fn submit_rejects_reopened_resolution() {
        // A finding cannot be submitted already-reopened: the guard rejects it
        // per-index before any state is written.
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path();
        git(p, &["init", "-q"]);
        git(p, &["config", "user.email", "t@example.com"]);
        git(p, &["config", "user.name", "t"]);
        std::fs::write(p.join("a.txt"), "one\n").unwrap();
        git(p, &["add", "."]);
        git(p, &["commit", "-qm", "first"]);
        std::fs::write(p.join("a.txt"), "one\ntwo\n").unwrap();
        git(p, &["commit", "-aqm", "second"]);

        let json = r#"{
          "run": { "tool": "t" },
          "findings": [
            {
              "kind": "bug", "severity": "low", "title": "x",
              "anchor": { "path": "a.txt" },
              "resolution": { "action": "reopened" }
            }
          ]
        }"#;
        let json_path = p.join("findings.json");
        std::fs::write(&json_path, json).unwrap();

        let args = SubmitArgs {
            target: ReviewTarget {
                repo: Some(p.to_string_lossy().into_owned()),
                spec: Some("HEAD".to_owned()),
            },
            file: Some(json_path.to_string_lossy().into_owned()),
            author: Some("t".to_owned()),
            source: None,
            json: false,
        };
        let err = run_submit(args).unwrap_err();
        assert!(err.starts_with("finding[0]:"), "got: {err}");
        assert!(err.contains("cannot be \"reopened\""), "got: {err}");
    }
}
