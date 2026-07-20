//! Guide subcommands: `guide show|add|clear`.
//!
//! The guide is an agent-authored grouping of a comparison's hunks into a
//! walkthrough. It's stored on the review (`guide.state.groups`) and rendered
//! by the desktop app, which no longer generates it — an agent composes it
//! here, group by group, and the desktop file watcher surfaces each `add` live.
//!
//! Typical authoring flow: `guide clear` to start fresh, then a `guide add`
//! per theme. Reads (`guide show`) reconcile the stored groups against the
//! current diff: hunk IDs that no longer exist are dropped, and live hunks not
//! in any group are reported as `ungrouped`.

use std::cell::Cell;
use std::collections::HashSet;
use std::path::PathBuf;

use clap::{Args, Subcommand};
use serde::Serialize;

use crate::review::state::{now_iso8601, Guide, GuideGenerated, HunkGroup};

use super::common::{load_for_mutation, load_review_view, mutate_review, print_json, ReviewTarget};
use super::get_repo_path;

#[derive(Debug, Args)]
pub struct GuideArgs {
    #[command(subcommand)]
    pub action: GuideAction,
}

#[derive(Debug, Subcommand)]
pub enum GuideAction {
    /// Show the current guide: its groups, their membership, and any ungrouped hunks
    Show(ShowArgs),
    /// Append a group of hunks to the guide
    Add(AddArgs),
    /// Remove the guide entirely
    Clear(ClearArgs),
}

#[derive(Debug, Args)]
pub struct ShowArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct AddArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Group title (e.g. "Refactor the auth module")
    pub title: String,
    /// Hunk IDs (`file:hash`, from `review hunks`) that belong in this group
    #[arg(required = true)]
    pub hunk_ids: Vec<String>,
    /// Optional one-line description shown under the title
    #[arg(long)]
    pub desc: Option<String>,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Args)]
pub struct ClearArgs {
    #[command(flatten)]
    pub target: ReviewTarget,
    /// Output as JSON
    #[arg(long)]
    pub json: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuideShowJson<'a> {
    comparison: String,
    groups: &'a [HunkGroup],
    ungrouped: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generated_at: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct GuideMutationJson {
    comparison: String,
    action: &'static str,
    groups: usize,
    version: u64,
}

/// Split the stored groups against the live hunk set for display: drop hunk IDs
/// that no longer exist (and any group emptied as a result), and collect live
/// hunks not in any group as `ungrouped`. Mirrors the desktop's reconciliation
/// so the CLI and app agree on what a guide currently covers.
fn reconcile_for_display(
    groups: &[HunkGroup],
    live_ids: &HashSet<String>,
) -> (Vec<HunkGroup>, Vec<String>) {
    let mut seen: HashSet<String> = HashSet::new();
    let mut kept_groups = Vec::new();
    for group in groups {
        let kept: Vec<String> = group
            .hunk_ids
            .iter()
            .filter(|id| live_ids.contains(id.as_str()))
            .cloned()
            .collect();
        if kept.is_empty() {
            continue;
        }
        for id in &kept {
            seen.insert(id.clone());
        }
        kept_groups.push(HunkGroup {
            title: group.title.clone(),
            description: group.description.clone(),
            hunk_ids: kept,
        });
    }
    let mut ungrouped: Vec<String> = live_ids
        .iter()
        .filter(|id| !seen.contains(id.as_str()))
        .cloned()
        .collect();
    ungrouped.sort();
    (kept_groups, ungrouped)
}

/// `review guide show` — print the guide, reconciled against the current diff.
pub fn run_show(args: ShowArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let view = load_review_view(&repo, args.target.spec.as_deref())?;
    let live_ids: HashSet<String> = view.hunks.iter().map(|h| h.id.clone()).collect();

    let stored = view.state.guide.as_ref().and_then(|g| g.state.as_ref());
    let groups = stored.map(|s| s.groups.as_slice()).unwrap_or(&[]);
    let generated_at = stored.map(|s| s.generated_at.clone());
    let (display_groups, ungrouped) = reconcile_for_display(groups, &live_ids);

    if args.json {
        print_json(&GuideShowJson {
            comparison: view.review.comparison.key.clone(),
            groups: &display_groups,
            ungrouped,
            generated_at,
        });
    } else {
        print_guide_human(&view.review.comparison.key, &display_groups, &ungrouped);
    }
    Ok(())
}

fn print_guide_human(comparison: &str, groups: &[HunkGroup], ungrouped: &[String]) {
    if groups.is_empty() && ungrouped.is_empty() {
        println!("(no hunks to guide on {comparison})");
        return;
    }
    if groups.is_empty() {
        println!(
            "(no guide on {comparison} — {} hunk(s) ungrouped)",
            ungrouped.len()
        );
    } else {
        let grouped: usize = groups.iter().map(|g| g.hunk_ids.len()).sum();
        println!(
            "{} group(s) on {comparison} · {grouped} hunk(s) grouped · {} ungrouped\n",
            groups.len(),
            ungrouped.len()
        );
    }
    for (i, group) in groups.iter().enumerate() {
        println!(
            "{}. {} ({} hunks)",
            i + 1,
            group.title,
            group.hunk_ids.len()
        );
        if !group.description.is_empty() {
            println!("   {}", group.description);
        }
        for id in &group.hunk_ids {
            println!("     {id}");
        }
    }
    if !ungrouped.is_empty() {
        println!("\nUngrouped ({}):", ungrouped.len());
        for id in ungrouped {
            println!("     {id}");
        }
    }
}

/// `review guide add` — append a group to the guide.
pub fn run_add(args: AddArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let (review, hunks, live_ids) = load_for_mutation(&repo, args.target.spec.as_deref())?;
    let comparison = &review.comparison;

    // Keep only IDs that exist in the current diff, de-duplicated in order; warn
    // about the rest so a stale or mistyped ID doesn't silently vanish.
    let mut valid: Vec<String> = Vec::new();
    let mut unknown: Vec<String> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();
    for id in &args.hunk_ids {
        if !live_ids.contains(id) {
            unknown.push(id.clone());
        } else if seen.insert(id.as_str()) {
            valid.push(id.clone());
        }
    }
    if !unknown.is_empty() {
        eprintln!(
            "Warning: ignoring {} hunk ID(s) not in {}: {}",
            unknown.len(),
            comparison.key,
            unknown.join(", ")
        );
    }
    if valid.is_empty() {
        return Err(format!(
            "No valid hunk IDs for {} — none matched the current diff. List them with `review hunks`.",
            comparison.key
        ));
    }

    // Snapshot of the diff at authoring time, so staleness detection (here and
    // in the desktop app) can tell when hunks have since shifted.
    let mut snapshot: Vec<String> = live_ids.iter().cloned().collect();
    snapshot.sort();

    let group = HunkGroup {
        title: args.title.clone(),
        description: args.desc.clone().unwrap_or_default(),
        hunk_ids: valid,
    };

    let group_count = Cell::new(0usize);
    let state = mutate_review(&repo, &review.ref_name, &hunks, |state| {
        let guide = state.guide.get_or_insert_with(|| Guide { state: None });
        let generated = guide.state.get_or_insert_with(|| GuideGenerated {
            groups: Vec::new(),
            hunk_ids: snapshot.clone(),
            generated_at: now_iso8601(),
        });
        generated.groups.push(group.clone());
        generated.hunk_ids = snapshot.clone();
        generated.generated_at = now_iso8601();
        group_count.set(generated.groups.len());
        true
    })?;

    let total = group_count.get();
    if args.json {
        print_json(&GuideMutationJson {
            comparison: comparison.key.clone(),
            action: "add",
            groups: total,
            version: state.version,
        });
    } else {
        println!(
            "Added group \"{}\" ({} hunks) to {} — {total} group(s) total (review v{})",
            args.title,
            group.hunk_ids.len(),
            comparison.key,
            state.version
        );
    }
    Ok(())
}

/// `review guide clear` — drop the guide entirely.
pub fn run_clear(args: ClearArgs) -> Result<(), String> {
    let repo = PathBuf::from(get_repo_path(&args.target.repo)?);
    let (review, hunks, _) = load_for_mutation(&repo, args.target.spec.as_deref())?;
    let comparison = &review.comparison;

    let existed = Cell::new(false);
    let state = mutate_review(&repo, &review.ref_name, &hunks, |state| {
        if state.guide.is_some() {
            state.guide = None;
            existed.set(true);
            true
        } else {
            false
        }
    })?;

    if args.json {
        print_json(&GuideMutationJson {
            comparison: comparison.key.clone(),
            action: "clear",
            groups: 0,
            version: state.version,
        });
    } else if existed.get() {
        println!(
            "Cleared the guide on {} (review v{})",
            comparison.key, state.version
        );
    } else {
        println!("(no guide on {})", comparison.key);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn group(title: &str, ids: &[&str]) -> HunkGroup {
        HunkGroup {
            title: title.to_owned(),
            description: String::new(),
            hunk_ids: ids.iter().map(|s| s.to_string()).collect(),
        }
    }

    fn live(ids: &[&str]) -> HashSet<String> {
        ids.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn keeps_live_groups_and_reports_ungrouped() {
        let groups = [group("A", &["f:a", "f:b"])];
        let (kept, ungrouped) = reconcile_for_display(&groups, &live(&["f:a", "f:b", "f:c"]));
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].hunk_ids, vec!["f:a", "f:b"]);
        // f:c isn't in any group → reported as ungrouped.
        assert_eq!(ungrouped, vec!["f:c"]);
    }

    #[test]
    fn drops_vanished_hunks_and_empty_groups() {
        let groups = [
            group("A", &["f:a", "f:gone"]),
            group("B", &["f:gone1", "f:gone2"]),
        ];
        let (kept, ungrouped) = reconcile_for_display(&groups, &live(&["f:a"]));
        // Group A keeps only the surviving hunk; group B vanishes entirely.
        assert_eq!(kept.len(), 1);
        assert_eq!(kept[0].title, "A");
        assert_eq!(kept[0].hunk_ids, vec!["f:a"]);
        assert!(ungrouped.is_empty());
    }

    #[test]
    fn ungrouped_is_sorted_and_deduped_against_groups() {
        let groups = [group("A", &["f:b"])];
        let (kept, ungrouped) = reconcile_for_display(&groups, &live(&["f:c", "f:a", "f:b"]));
        assert_eq!(kept.len(), 1);
        // Only the hunks not in any group, sorted.
        assert_eq!(ungrouped, vec!["f:a", "f:c"]);
    }

    #[test]
    fn empty_guide_reports_all_hunks_ungrouped() {
        let (kept, ungrouped) = reconcile_for_display(&[], &live(&["f:b", "f:a"]));
        assert!(kept.is_empty());
        assert_eq!(ungrouped, vec!["f:a", "f:b"]);
    }
}
