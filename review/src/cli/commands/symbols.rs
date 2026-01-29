use crate::cli::{get_or_detect_comparison, OutputFormat};
use crate::diff::parser::{parse_diff, DiffHunk, LineType};
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::{DiffSource, FileEntry};
use crate::symbols::extractor::compute_file_symbol_diff;
use crate::symbols::{FileSymbolDiff, SymbolChangeType, SymbolDiff, SymbolKind};
use colored::Colorize;
use std::collections::HashMap;
use std::path::PathBuf;

/// Line stats for a single hunk.
struct HunkLineStats {
    added: usize,
    removed: usize,
}

/// Build a map from hunk ID to line-level add/remove counts.
fn build_line_stats(hunks: &[DiffHunk]) -> HashMap<String, HunkLineStats> {
    hunks
        .iter()
        .map(|h| {
            let added = h
                .lines
                .iter()
                .filter(|l| l.line_type == LineType::Added)
                .count();
            let removed = h
                .lines
                .iter()
                .filter(|l| l.line_type == LineType::Removed)
                .count();
            (h.id.clone(), HunkLineStats { added, removed })
        })
        .collect()
}

/// Sum line stats for a symbol and all its children.
fn symbol_line_stats(
    symbol: &SymbolDiff,
    stats: &HashMap<String, HunkLineStats>,
) -> (usize, usize) {
    let mut added = 0;
    let mut removed = 0;
    for id in &symbol.hunk_ids {
        if let Some(s) = stats.get(id) {
            added += s.added;
            removed += s.removed;
        }
    }
    for child in &symbol.children {
        let (a, r) = symbol_line_stats(child, stats);
        added += a;
        removed += r;
    }
    (added, removed)
}

/// Sum line stats for a list of hunk IDs.
fn hunk_ids_line_stats(
    hunk_ids: &[String],
    stats: &HashMap<String, HunkLineStats>,
) -> (usize, usize) {
    let mut added = 0;
    let mut removed = 0;
    for id in hunk_ids {
        if let Some(s) = stats.get(id) {
            added += s.added;
            removed += s.removed;
        }
    }
    (added, removed)
}

/// Format line stats as colored "+N -M" string.
fn format_line_stats(added: usize, removed: usize) -> String {
    match (added, removed) {
        (0, 0) => String::new(),
        (a, 0) => format!("{}", format!("+{a}").green()),
        (0, r) => format!("{}", format!("-{r}").red()),
        (a, r) => format!("{} {}", format!("+{a}").green(), format!("-{r}").red()),
    }
}

#[expect(
    clippy::needless_pass_by_value,
    reason = "file parameter passed from clap's owned String"
)]
pub fn run(
    repo_path: &str,
    file: Option<String>,
    split: bool,
    format: OutputFormat,
) -> Result<(), String> {
    let path = PathBuf::from(repo_path);

    // Get current comparison, or auto-detect from repo branches
    let comparison = get_or_detect_comparison(&path)?;

    // Get changed files
    let source = LocalGitSource::new(path.clone()).map_err(|e| e.to_string())?;
    let file_entries = source.list_files(&comparison).map_err(|e| e.to_string())?;
    let mut file_paths = Vec::new();
    flatten_file_paths(&file_entries, &mut file_paths);

    // Filter to specific file if provided
    if let Some(ref filter) = file {
        file_paths.retain(|p| p == filter || p.ends_with(filter));
        if file_paths.is_empty() {
            return Err(format!("No matching file found for '{filter}'"));
        }
    }

    // Determine git refs for old and new sides
    let old_ref = if comparison.working_tree {
        "HEAD".to_owned()
    } else {
        comparison.old.clone()
    };

    // Parse all hunks
    let mut all_hunks = Vec::new();
    for file_path in &file_paths {
        let file_diff = source
            .get_diff(&comparison, Some(file_path))
            .unwrap_or_default();
        if !file_diff.is_empty() {
            let hunks = parse_diff(&file_diff, file_path);
            all_hunks.extend(hunks);
        }
    }

    // Build line stats from parsed hunks
    let line_stats = build_line_stats(&all_hunks);

    // Compute symbol diffs for each file
    let mut results = Vec::new();
    for file_path in &file_paths {
        let old_content = source
            .get_file_bytes(file_path, &old_ref)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok());

        let new_content = if comparison.working_tree {
            let full_path = path.join(file_path);
            std::fs::read_to_string(&full_path).ok()
        } else {
            source
                .get_file_bytes(file_path, &comparison.new)
                .ok()
                .and_then(|bytes| String::from_utf8(bytes).ok())
        };

        let file_hunks: Vec<_> = all_hunks
            .iter()
            .filter(|h| h.file_path == *file_path)
            .cloned()
            .collect();

        let diff = compute_file_symbol_diff(
            old_content.as_deref(),
            new_content.as_deref(),
            file_path,
            &file_hunks,
        );

        results.push(diff);
    }

    // Filter to files with actual changes
    results.retain(|d| !d.symbols.is_empty() || !d.top_level_hunk_ids.is_empty());

    if format == OutputFormat::Json {
        println!(
            "{}",
            serde_json::to_string_pretty(&results).expect("failed to serialize JSON output")
        );
        return Ok(());
    }

    // Text output
    if results.is_empty() {
        println!("No symbol changes found");
        return Ok(());
    }

    if split {
        print_split(&results, &line_stats);
    } else {
        print_inline(&results, &line_stats);
    }

    Ok(())
}

// --- Inline (default) output ---

fn print_inline(results: &[FileSymbolDiff], stats: &HashMap<String, HunkLineStats>) {
    let mut total_symbols = 0;
    let mut total_top_level = 0;

    for file_diff in results {
        println!("{}", file_diff.file_path.bold());

        for symbol in &file_diff.symbols {
            print_symbol_inline(symbol, 1, stats);
            total_symbols += count_symbols(symbol);
        }

        if !file_diff.top_level_hunk_ids.is_empty() {
            let count = file_diff.top_level_hunk_ids.len();
            total_top_level += count;
            let (a, r) = hunk_ids_line_stats(&file_diff.top_level_hunk_ids, stats);
            let ls = format_line_stats(a, r);
            println!(
                "  {} ({count} top-level {}){}",
                "~".yellow(),
                if count == 1 { "hunk" } else { "hunks" },
                if ls.is_empty() {
                    String::new()
                } else {
                    format!("  {ls}")
                }
            );
        }

        println!();
    }

    let file_count = results.len();
    let mut summary = format!(
        "{} {} symbol(s) changed across {} file(s)",
        "Total:".dimmed(),
        total_symbols,
        file_count
    );
    if total_top_level > 0 {
        summary.push_str(&format!(", {total_top_level} top-level hunk(s)"));
    }
    println!("{summary}");
}

fn print_symbol_inline(symbol: &SymbolDiff, depth: usize, stats: &HashMap<String, HunkLineStats>) {
    let indent = "  ".repeat(depth);
    let prefix = change_prefix(&symbol.change_type);
    let badge = kind_badge(symbol.kind.as_ref());
    let (a, r) = symbol_line_stats(symbol, stats);
    let ls = format_line_stats(a, r);

    if ls.is_empty() {
        println!("{indent}{prefix} {badge}{}", symbol.name);
    } else {
        println!("{indent}{prefix} {badge}{}  {ls}", symbol.name);
    }

    for child in &symbol.children {
        print_symbol_inline(child, depth + 1, stats);
    }
}

// --- Split (side-by-side) output ---

/// A row in the split view. Each side is optional (blank when the other side is add/remove).
struct SplitRow {
    left: Option<String>,
    right: Option<String>,
    depth: usize,
}

fn print_split(results: &[FileSymbolDiff], stats: &HashMap<String, HunkLineStats>) {
    // Determine column width from terminal, fall back to 80
    let term_width = terminal_width().max(40);
    let indent = "  ";
    // Content area per column, accounting for indent + " │ " separator
    let col_width = (term_width - 3) / 2 - indent.len();

    for file_diff in results {
        // File header — bold filename
        println!("{}", file_diff.file_path.bold());

        // Column headers — indented under filename
        let old_label = "Old";
        let new_label = "New";
        let header_pad = col_width.saturating_sub(old_label.len());
        println!(
            "{indent}{}{}{}{}",
            old_label.dimmed(),
            " ".repeat(header_pad),
            " │ ".dimmed(),
            new_label.dimmed()
        );

        let mut rows = Vec::new();
        for symbol in &file_diff.symbols {
            collect_split_rows(symbol, 0, stats, &mut rows);
        }

        if !file_diff.top_level_hunk_ids.is_empty() {
            let count = file_diff.top_level_hunk_ids.len();
            let (a, r) = hunk_ids_line_stats(&file_diff.top_level_hunk_ids, stats);
            let base = format!(
                "({count} top-level {})",
                if count == 1 { "hunk" } else { "hunks" }
            );
            let left_label = if r > 0 {
                format!("{base}  {}", format!("-{r}").red())
            } else {
                base.clone()
            };
            let right_label = if a > 0 {
                format!("{base}  {}", format!("+{a}").green())
            } else {
                base
            };
            rows.push(SplitRow {
                left: Some(left_label),
                right: Some(right_label),
                depth: 0,
            });
        }

        for row in &rows {
            let row_indent = "  ".repeat(row.depth);
            let left = match &row.left {
                Some(s) => format!("{row_indent}{s}"),
                None => String::new(),
            };
            let right = match &row.right {
                Some(s) => format!("{row_indent}{s}"),
                None => String::new(),
            };

            let left_visible = visible_len(&left);
            let padding = col_width.saturating_sub(left_visible);

            println!(
                "{indent}{}{}{}{}",
                left,
                " ".repeat(padding),
                " │ ".dimmed(),
                right
            );
        }

        println!();
    }
}

fn collect_split_rows(
    symbol: &SymbolDiff,
    depth: usize,
    stats: &HashMap<String, HunkLineStats>,
    rows: &mut Vec<SplitRow>,
) {
    let badge = kind_badge(symbol.kind.as_ref());
    let (a, r) = symbol_line_stats(symbol, stats);
    let base = format!("{badge}{}", symbol.name);

    // Left side shows removal count, right side shows addition count
    let left_label = if r > 0 {
        format!("{base}  {}", format!("-{r}").red())
    } else {
        base.clone()
    };
    let right_label = if a > 0 {
        format!("{base}  {}", format!("+{a}").green())
    } else {
        base
    };

    match symbol.change_type {
        SymbolChangeType::Added => {
            rows.push(SplitRow {
                left: None,
                right: Some(format!("{} {right_label}", "+".green())),
                depth,
            });
        }
        SymbolChangeType::Removed => {
            rows.push(SplitRow {
                left: Some(format!("{} {left_label}", "-".red())),
                right: None,
                depth,
            });
        }
        SymbolChangeType::Modified => {
            rows.push(SplitRow {
                left: Some(format!("{} {left_label}", "~".yellow())),
                right: Some(format!("{} {right_label}", "~".yellow())),
                depth,
            });
        }
    }

    for child in &symbol.children {
        collect_split_rows(child, depth + 1, stats, rows);
    }
}

/// Approximate visible length of a string (strips ANSI escape sequences).
fn visible_len(s: &str) -> usize {
    let mut len = 0;
    let mut in_escape = false;
    for ch in s.chars() {
        if in_escape {
            if ch == 'm' {
                in_escape = false;
            }
        } else if ch == '\x1b' {
            in_escape = true;
        } else {
            len += 1;
        }
    }
    len
}

/// Try to get terminal width, defaulting to 80.
fn terminal_width() -> usize {
    if let Ok(cols) = std::env::var("COLUMNS") {
        if let Ok(w) = cols.parse::<usize>() {
            return w;
        }
    }
    80
}

// --- Shared helpers ---

fn change_prefix(change_type: &SymbolChangeType) -> String {
    match change_type {
        SymbolChangeType::Added => "+".green().to_string(),
        SymbolChangeType::Removed => "-".red().to_string(),
        SymbolChangeType::Modified => "~".yellow().to_string(),
    }
}

fn kind_badge(kind: Option<&SymbolKind>) -> String {
    match kind {
        Some(SymbolKind::Function | SymbolKind::Method) => format!("{} ", "fn".yellow()),
        Some(SymbolKind::Class) => format!("{}  ", "C".cyan()),
        Some(SymbolKind::Struct) => format!("{}  ", "S".cyan()),
        Some(SymbolKind::Trait) => format!("{}  ", "T".magenta()),
        Some(SymbolKind::Impl) => format!("{}  ", "I".magenta()),
        Some(SymbolKind::Enum) => format!("{}  ", "E".green()),
        Some(SymbolKind::Interface) => format!("{} ", "If".cyan()),
        Some(SymbolKind::Module) => format!("{}  ", "M".normal()),
        Some(SymbolKind::Type) => format!("{} ", "Ty".blue()),
        None => String::new(),
    }
}

fn count_symbols(symbol: &SymbolDiff) -> usize {
    1 + symbol
        .children
        .iter()
        .map(|c| count_symbols(c))
        .sum::<usize>()
}

fn flatten_file_paths(entries: &[FileEntry], output: &mut Vec<String>) {
    for entry in entries {
        if entry.is_directory {
            if let Some(ref children) = entry.children {
                flatten_file_paths(children, output);
            }
        } else if entry.status.is_some() {
            output.push(entry.path.clone());
        }
    }
}
