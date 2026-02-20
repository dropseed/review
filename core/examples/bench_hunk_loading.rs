//! Benchmark: per-file diff vs batch diff for hunk loading.
//!
//! Compares the old approach (one `git diff` per changed file) against the
//! batch approach (single `git diff` + `parse_multi_file_diff`).
//!
//! Usage:
//!   cargo run --example bench_hunk_loading [-- <old_ref> <new_ref>]

use review::diff::parser::{parse_diff, parse_multi_file_diff};
use review::sources::local_git::LocalGitSource;
use review::sources::traits::{Comparison, DiffSource, FileEntry, FileStatus};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let (old_ref, new_ref) = if args.len() >= 3 {
        (args[1].clone(), args[2].clone())
    } else {
        ("HEAD~5".to_string(), "HEAD".to_string())
    };

    let repo_path = std::env::current_dir().expect("no cwd");
    println!("Repo:       {}", repo_path.display());
    println!("Comparison: {}..{}\n", old_ref, new_ref);

    let source = LocalGitSource::new(repo_path).expect("not a git repo");

    let comparison = Comparison::new(old_ref.clone(), new_ref.clone());

    let files = source.list_files(&comparison).expect("list_files failed");
    let changed_paths = collect_changed_paths(&files);
    println!("Changed files: {}\n", changed_paths.len());

    if changed_paths.is_empty() {
        println!("No changed files in this range. Try a wider range.");
        return;
    }

    // -- Per-file diff --
    println!("=== Per-file diff ({} git calls) ===", changed_paths.len());
    let t0 = Instant::now();
    let mut hunks_a = Vec::new();
    let mut diff_bytes_a = 0usize;
    for path in &changed_paths {
        let diff = source.get_diff(&comparison, Some(path)).unwrap_or_default();
        diff_bytes_a += diff.len();
        hunks_a.extend(parse_diff(&diff, path));
    }
    let elapsed_a = t0.elapsed();
    println!("  Hunks:     {}", hunks_a.len());
    println!("  Diff data: {} KB", diff_bytes_a / 1024);
    println!("  Time:      {elapsed_a:?}");
    println!(
        "  Avg/file:  {:?}\n",
        elapsed_a / changed_paths.len().max(1) as u32
    );

    // -- Batch diff --
    println!("=== Batch diff (1 git call) ===");
    let t1 = Instant::now();
    let full_diff = source.get_diff(&comparison, None).unwrap_or_default();
    let diff_time = t1.elapsed();
    let hunks_b = parse_multi_file_diff(&full_diff);
    let parse_time = t1.elapsed() - diff_time;
    let elapsed_b = t1.elapsed();

    let requested: std::collections::HashSet<&str> =
        changed_paths.iter().map(|s| s.as_str()).collect();
    let hunks_b_filtered: Vec<_> = hunks_b
        .into_iter()
        .filter(|h| requested.contains(h.file_path.as_str()))
        .collect();

    println!("  Hunks:     {}", hunks_b_filtered.len());
    println!("  Diff data: {} KB", full_diff.len() / 1024);
    println!("  Git diff:  {diff_time:?}");
    println!("  Parsing:   {parse_time:?}");
    println!("  Time:      {elapsed_b:?}\n");

    // -- Summary --
    let speedup = elapsed_a.as_secs_f64() / elapsed_b.as_secs_f64();
    println!("=== Summary ===");
    println!("  Per-file: {elapsed_a:?}");
    println!("  Batch:    {elapsed_b:?}");
    println!("  Speedup:  {speedup:.1}x");
    println!(
        "  Hunks:    {} vs {} {}",
        hunks_a.len(),
        hunks_b_filtered.len(),
        if hunks_a.len() == hunks_b_filtered.len() {
            "(match)"
        } else {
            "(MISMATCH)"
        }
    );
}

fn collect_changed_paths(entries: &[FileEntry]) -> Vec<String> {
    let mut paths = Vec::new();
    for entry in entries {
        if let Some(ref status) = entry.status {
            if !entry.is_directory
                && matches!(
                    status,
                    FileStatus::Added
                        | FileStatus::Modified
                        | FileStatus::Deleted
                        | FileStatus::Renamed
                        | FileStatus::Untracked
                )
            {
                paths.push(entry.path.clone());
            }
        }
        if let Some(ref children) = entry.children {
            paths.extend(collect_changed_paths(children));
        }
    }
    paths
}
