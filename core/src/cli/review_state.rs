//! Review-state subcommands: `hunks`, `approve`/`reject`/`save`/`unmark`,
//! `status`, `list`, `trust`, and `note`.
//!
//! These commands read and write the saved review JSON under `~/.review/`.

use std::path::PathBuf;

use clap::{Args, Subcommand};
use serde::Serialize;

use crate::classify::classify_hunks_static;
use crate::review::state::{overall_review_state, HunkStatus};
use crate::review::storage;
use crate::trust::matches_pattern;

use super::common::{
    effective_status, hunk_labels, hunk_line_stats, load_for_mutation, load_review_view,
    mutate_review, print_json, render_hunk_diff, resolve_comparison_arg, sync_classification,
    EffectiveStatus, ReviewTarget,
};
use super::get_repo_path;

#[derive(Debug, Args)]
pub struct HunksArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
    /// Include the diff text of each hunk
    #[arg(long)]
    pub diff: bool,
    /// Filter by status: unreviewed, trusted, approved, rejected, saved
    #[arg(long)]
    pub status: Option<String>,
    /// Filter to a file-path glob (e.g. "src/*.rs")
    #[arg(long)]
    pub file: Option<String>,
    /// Filter by label pattern (e.g. "imports:*")
    #[arg(long)]
    pub label: Option<String>,
    /// Show only the hunk with this ID
    #[arg(long)]
    pub hunk: Option<String>,
}

#[derive(Debug, Args)]
pub struct MarkArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Hunk IDs to mark
    #[arg(required = true)]
    pub hunks: Vec<String>,
    /// Reason recorded on each hunk (ignored by `unmark`)
    #[arg(long)]
    pub reason: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct StatusArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ListArgs {
    /// Repository path (defaults to the current directory)
    #[arg(short, long)]
    pub repo: Option<String>,
    /// List reviews across every registered repo
    #[arg(long)]
    pub all: bool,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct DeleteArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct TrustArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    #[command(subcommand)]
    pub action: TrustAction,
}

#[derive(Debug, Subcommand)]
pub enum TrustAction {
    /// List the trusted patterns
    List,
    /// Add a pattern to the trust list
    Add { pattern: String },
    /// Remove a pattern from the trust list
    Remove { pattern: String },
}

#[derive(Debug, Args)]
pub struct NoteArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    #[command(subcommand)]
    pub action: NoteAction,
}

#[derive(Debug, Subcommand)]
pub enum NoteAction {
    /// Print the review notes
    Show,
    /// Replace the review notes
    Set { text: String },
    /// Append a line to the review notes
    Append { text: String },
}

/// Per-status hunk counts for a comparison.
#[derive(Debug, Default, Serialize)]
struct Counts {
    unreviewed: usize,
    trusted: usize,
    approved: usize,
    rejected: usize,
    saved: usize,
}

impl Counts {
    fn tally(&mut self, status: EffectiveStatus) {
        match status {
            EffectiveStatus::Unreviewed => self.unreviewed += 1,
            EffectiveStatus::Trusted => self.trusted += 1,
            EffectiveStatus::Approved => self.approved += 1,
            EffectiveStatus::Rejected => self.rejected += 1,
            EffectiveStatus::Saved => self.saved += 1,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HunkJson {
    id: String,
    file: String,
    old_start: u32,
    old_count: u32,
    new_start: u32,
    new_count: u32,
    additions: usize,
    deletions: usize,
    status: EffectiveStatus,
    labels: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reasoning: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    diff: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct HunksJson {
    comparison: String,
    total_hunks: usize,
    counts: Counts,
    hunks: Vec<HunkJson>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StatusJson {
    comparison: String,
    total_hunks: usize,
    reviewed: usize,
    state: String,
    counts: Counts,
}

#[derive(Debug, Serialize)]
struct MarkResultJson {
    comparison: String,
    action: String,
    updated: Vec<String>,
    unknown: Vec<String>,
    version: u64,
}

#[derive(Debug, Serialize)]
struct DeleteResultJson {
    comparison: String,
    deleted: bool,
}

/// `review hunks` — list a comparison's hunks with their review status.
pub fn run_hunks(args: HunksArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let view = load_review_view(&repo, args.target.spec.as_deref())?;

    let status_filter = match &args.status {
        Some(value) => Some(parse_status_filter(value)?),
        None => None,
    };
    let file_filter = match &args.file {
        Some(glob) => {
            Some(glob::Pattern::new(glob).map_err(|e| format!("Invalid --file pattern: {e}"))?)
        }
        None => None,
    };

    // Counts always reflect the whole comparison; the printed list is filtered.
    let mut counts = Counts::default();
    let mut rows: Vec<HunkJson> = Vec::new();

    for hunk in &view.hunks {
        let labels = hunk_labels(&hunk.id, &view.state, &view.classification);
        let status = effective_status(&hunk.id, &labels, &view.state);
        counts.tally(status);

        if let Some(want) = status_filter {
            if status != want {
                continue;
            }
        }
        if let Some(id) = &args.hunk {
            if &hunk.id != id {
                continue;
            }
        }
        if let Some(pattern) = &file_filter {
            if !pattern.matches(&hunk.file_path) {
                continue;
            }
        }
        if let Some(label_pattern) = &args.label {
            if !labels.iter().any(|l| matches_pattern(l, label_pattern)) {
                continue;
            }
        }

        let (additions, deletions) = hunk_line_stats(hunk);
        let reasoning = view
            .state
            .hunks
            .get(&hunk.id)
            .and_then(|h| h.reasoning.clone());
        rows.push(HunkJson {
            id: hunk.id.clone(),
            file: hunk.file_path.clone(),
            old_start: hunk.old_start,
            old_count: hunk.old_count,
            new_start: hunk.new_start,
            new_count: hunk.new_count,
            additions,
            deletions,
            status,
            labels,
            reasoning,
            // A single-hunk query always includes the diff.
            diff: if args.diff || args.hunk.is_some() {
                Some(render_hunk_diff(hunk))
            } else {
                None
            },
        });
    }

    if args.json {
        print_json(&HunksJson {
            comparison: view.comparison.key.clone(),
            total_hunks: view.hunks.len(),
            counts,
            hunks: rows,
        });
    } else {
        print_hunks_human(&view.comparison.key, view.hunks.len(), &counts, &rows);
    }
    Ok(())
}

fn print_hunks_human(comparison: &str, total: usize, counts: &Counts, rows: &[HunkJson]) {
    println!(
        "{comparison} — {total} hunks · {} unreviewed · {} trusted · {} approved · {} rejected · {} saved\n",
        counts.unreviewed, counts.trusted, counts.approved, counts.rejected, counts.saved
    );
    if rows.is_empty() {
        println!("(no hunks match)");
        return;
    }
    let mut current_file = "";
    for row in rows {
        if row.file.as_str() != current_file {
            println!("{}", row.file);
            current_file = row.file.as_str();
        }
        let labels = if row.labels.is_empty() {
            String::new()
        } else {
            format!("  {}", row.labels.join(","))
        };
        println!(
            "  {:<10}  {}  +{} -{}{}",
            row.status.as_str(),
            row.id,
            row.additions,
            row.deletions,
            labels
        );
        if let Some(reason) = &row.reasoning {
            println!("              reason: {reason}");
        }
        if let Some(diff) = &row.diff {
            for line in diff.lines() {
                println!("      {line}");
            }
        }
    }
}

/// `review approve` / `reject` / `save` — set a status on hunks.
pub fn run_mark(args: MarkArgs, status: HunkStatus) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let (comparison, hunks, live_ids) = load_for_mutation(&repo, args.target.spec.as_deref())?;
    let total_hunks = hunks.len();
    let classification = classify_hunks_static(&hunks);

    // Validate hunk IDs against the live diff so stale IDs are caught.
    let mut known: Vec<String> = Vec::new();
    let mut unknown: Vec<String> = Vec::new();
    for id in &args.hunks {
        if live_ids.contains(id) {
            known.push(id.clone());
        } else {
            unknown.push(id.clone());
        }
    }
    for id in &unknown {
        eprintln!("warning: hunk not found in {}: {id}", comparison.key);
    }
    if known.is_empty() {
        return Err("No matching hunks to update.".to_owned());
    }

    let existed = storage::review_exists(&repo, &comparison).unwrap_or(false);
    let reason = args.reason.clone();
    let result = mutate_review(&repo, &comparison, &live_ids, |state| {
        // Keep the total and per-hunk labels fresh so `review list` and the
        // desktop app show accurate progress.
        state.total_diff_hunks = total_hunks;
        sync_classification(state, &classification);
        for id in &known {
            let entry = state.hunks.entry(id.clone()).or_default();
            entry.status = Some(status.clone());
            if let Some(reason) = &reason {
                entry.reasoning = Some(reason.clone());
            }
        }
    })?;

    let verb = status_verb(&status);
    if args.json {
        print_json(&MarkResultJson {
            comparison: comparison.key.clone(),
            action: verb.to_ascii_lowercase(),
            updated: known,
            unknown,
            version: result.version,
        });
    } else {
        if !existed {
            println!("Created review {}", comparison.key);
        }
        println!(
            "{verb} {} hunk(s) in {} (review v{})",
            known.len(),
            comparison.key,
            result.version
        );
    }
    Ok(())
}

/// `review unmark` — clear the status of hunks.
pub fn run_unmark(args: MarkArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let (comparison, hunks, live_ids) = load_for_mutation(&repo, args.target.spec.as_deref())?;
    let total_hunks = hunks.len();
    let classification = classify_hunks_static(&hunks);

    if !storage::review_exists(&repo, &comparison).unwrap_or(false) {
        return Err(format!("No review exists for {}.", comparison.key));
    }

    let ids = args.hunks.clone();
    let result = mutate_review(&repo, &comparison, &live_ids, |state| {
        state.total_diff_hunks = total_hunks;
        sync_classification(state, &classification);
        for id in &ids {
            // Clear the status; drop the entry entirely if nothing else is
            // recorded on it, to keep the review file tidy.
            let drop_entry = match state.hunks.get_mut(id) {
                Some(hunk_state) => {
                    hunk_state.status = None;
                    hunk_state.label.is_empty() && hunk_state.reasoning.is_none()
                }
                None => false,
            };
            if drop_entry {
                state.hunks.remove(id);
            }
        }
    })?;

    if args.json {
        print_json(&MarkResultJson {
            comparison: comparison.key.clone(),
            action: "unmark".to_owned(),
            updated: ids,
            unknown: Vec::new(),
            version: result.version,
        });
    } else {
        println!(
            "Cleared status on {} hunk(s) in {} (review v{})",
            ids.len(),
            comparison.key,
            result.version
        );
    }
    Ok(())
}

/// `review status` — show review progress for a comparison.
pub fn run_status(args: StatusArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let view = load_review_view(&repo, args.target.spec.as_deref())?;

    let mut counts = Counts::default();
    for hunk in &view.hunks {
        let labels = hunk_labels(&hunk.id, &view.state, &view.classification);
        counts.tally(effective_status(&hunk.id, &labels, &view.state));
    }
    let total = view.hunks.len();
    let reviewed = counts.trusted + counts.approved + counts.rejected;
    let state = overall_review_state(counts.rejected, reviewed, total).unwrap_or("in_progress");

    if args.json {
        print_json(&StatusJson {
            comparison: view.comparison.key.clone(),
            total_hunks: total,
            reviewed,
            state: state.to_owned(),
            counts,
        });
    } else {
        println!("{}", view.comparison.key);
        println!("  total       {total}");
        println!("  unreviewed  {}", counts.unreviewed);
        println!("  trusted     {}", counts.trusted);
        println!("  approved    {}", counts.approved);
        println!("  rejected    {}", counts.rejected);
        println!("  saved       {}", counts.saved);
        println!("  reviewed    {reviewed} / {total}");
        println!("  state       {state}");
    }
    Ok(())
}

/// `review list` — list saved reviews.
pub fn run_list(args: ListArgs) -> Result<(), String> {
    if args.all {
        let reviews = storage::list_all_reviews_global().map_err(|e| e.to_string())?;
        if args.json {
            print_json(&reviews);
        } else if reviews.is_empty() {
            println!("No saved reviews.");
        } else {
            println!("{} review(s) across all repos:\n", reviews.len());
            for review in &reviews {
                println!(
                    "  {:<44}  {}/{} reviewed  {:<18}  {}",
                    format!("{} · {}", review.repo_name, review.summary.comparison.key),
                    review.summary.reviewed_hunks,
                    review.summary.total_hunks,
                    review.summary.state.as_deref().unwrap_or("in_progress"),
                    review.summary.updated_at,
                );
            }
        }
        return Ok(());
    }

    let repo = PathBuf::from(get_repo_path(&args.repo)?);
    let reviews = storage::list_saved_reviews(&repo).map_err(|e| e.to_string())?;
    if args.json {
        print_json(&reviews);
    } else if reviews.is_empty() {
        println!("No saved reviews in this repo.");
    } else {
        println!("{} review(s):\n", reviews.len());
        for review in &reviews {
            println!(
                "  {:<32}  {}/{} reviewed  {:<18}  {}",
                review.comparison.key,
                review.reviewed_hunks,
                review.total_hunks,
                review.state.as_deref().unwrap_or("in_progress"),
                review.updated_at,
            );
        }
    }
    Ok(())
}

/// `review delete` — remove a saved review.
pub fn run_delete(args: DeleteArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let comparison = resolve_comparison_arg(&repo, args.target.spec.as_deref())?;
    if !storage::review_exists(&repo, &comparison).unwrap_or(false) {
        return Err(format!("No review exists for {}.", comparison.key));
    }
    storage::delete_review(&repo, &comparison).map_err(|e| e.to_string())?;
    if args.json {
        print_json(&DeleteResultJson {
            comparison: comparison.key.clone(),
            deleted: true,
        });
    } else {
        println!("Deleted review {}", comparison.key);
    }
    Ok(())
}

/// `review trust` — inspect or edit the trust list.
pub fn run_trust(args: TrustArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);

    match args.action {
        TrustAction::List => {
            let comparison = resolve_comparison_arg(&repo, args.target.spec.as_deref())?;
            let state =
                storage::load_review_state(&repo, &comparison).map_err(|e| e.to_string())?;
            let mut patterns = state.trust_list.clone();
            patterns.sort();
            println!(
                "{} trusted pattern(s) for {}:",
                patterns.len(),
                comparison.key
            );
            for pattern in &patterns {
                println!("  {pattern}");
            }
        }
        TrustAction::Add { pattern } => {
            if !pattern.contains('*')
                && !crate::trust::patterns::get_all_pattern_ids().contains(&pattern)
            {
                eprintln!("warning: '{pattern}' is not a known taxonomy pattern");
            }
            let (comparison, _hunks, live_ids) =
                load_for_mutation(&repo, args.target.spec.as_deref())?;
            let state = mutate_review(&repo, &comparison, &live_ids, |state| {
                if !state.trust_list.contains(&pattern) {
                    state.trust_list.push(pattern.clone());
                }
            })?;
            println!(
                "Trust list now has {} pattern(s) for {} (review v{})",
                state.trust_list.len(),
                comparison.key,
                state.version
            );
        }
        TrustAction::Remove { pattern } => {
            let (comparison, _hunks, live_ids) =
                load_for_mutation(&repo, args.target.spec.as_deref())?;
            let state = mutate_review(&repo, &comparison, &live_ids, |state| {
                state.trust_list.retain(|existing| existing != &pattern);
            })?;
            println!(
                "Trust list now has {} pattern(s) for {} (review v{})",
                state.trust_list.len(),
                comparison.key,
                state.version
            );
        }
    }
    Ok(())
}

/// `review note` — read or edit the free-form review notes.
pub fn run_note(args: NoteArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);

    match args.action {
        NoteAction::Show => {
            let comparison = resolve_comparison_arg(&repo, args.target.spec.as_deref())?;
            let state =
                storage::load_review_state(&repo, &comparison).map_err(|e| e.to_string())?;
            if state.notes.trim().is_empty() {
                println!("(no notes for {})", comparison.key);
            } else {
                println!("{}", state.notes);
            }
        }
        NoteAction::Set { text } => {
            let (comparison, _hunks, live_ids) =
                load_for_mutation(&repo, args.target.spec.as_deref())?;
            mutate_review(&repo, &comparison, &live_ids, |state| {
                state.notes.clone_from(&text);
            })?;
            println!("Notes updated for {}", comparison.key);
        }
        NoteAction::Append { text } => {
            let (comparison, _hunks, live_ids) =
                load_for_mutation(&repo, args.target.spec.as_deref())?;
            mutate_review(&repo, &comparison, &live_ids, |state| {
                if state.notes.trim().is_empty() {
                    state.notes.clone_from(&text);
                } else {
                    state.notes = format!("{}\n{}", state.notes, text);
                }
            })?;
            println!("Notes updated for {}", comparison.key);
        }
    }
    Ok(())
}

/// Normalize a `--status` filter value.
fn parse_status_filter(value: &str) -> Result<EffectiveStatus, String> {
    match value.to_ascii_lowercase().as_str() {
        "unreviewed" => Ok(EffectiveStatus::Unreviewed),
        "trusted" => Ok(EffectiveStatus::Trusted),
        "approved" => Ok(EffectiveStatus::Approved),
        "rejected" => Ok(EffectiveStatus::Rejected),
        "saved" => Ok(EffectiveStatus::Saved),
        other => Err(format!(
            "Invalid --status '{other}' (valid: unreviewed, trusted, approved, rejected, saved)"
        )),
    }
}

/// Past-tense verb for a status, used in confirmation output.
fn status_verb(status: &HunkStatus) -> &'static str {
    match status {
        HunkStatus::Approved => "Approved",
        HunkStatus::Rejected => "Rejected",
        HunkStatus::SavedForLater => "Saved",
    }
}
