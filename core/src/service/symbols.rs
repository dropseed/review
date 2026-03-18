//! Symbol extraction and diff orchestration.

use anyhow::Context;
use log::{debug, info};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::time::Instant;

use crate::diff::parser::{parse_multi_file_diff, DiffHunk};
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::{Comparison, DiffSource};
use crate::symbols::{self, FileSymbolDiff, Symbol, SymbolDefinition};

use super::RepoFileSymbols;

/// Compute symbol-level diffs for files.
pub fn get_file_symbol_diffs(
    repo_path: &Path,
    file_paths: &[String],
    comparison: &Comparison,
) -> anyhow::Result<Vec<FileSymbolDiff>> {
    let t0 = Instant::now();
    debug!(
        "[get_file_symbol_diffs] repo_path={}, files={}",
        repo_path.display(),
        file_paths.len()
    );

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;

    // Determine the git refs for old and new sides
    let old_ref = if source.include_working_tree(comparison) {
        "HEAD".to_owned()
    } else {
        comparison.base.clone()
    };

    // Single git diff call for all files instead of one per file
    let full_diff = source.get_diff(comparison, None).unwrap_or_default();

    // Check the disk cache before doing expensive tree-sitter work
    let diff_hash = symbols::cache::compute_hash(&full_diff);
    if let Ok(Some(cached)) = symbols::cache::load(repo_path, comparison, &diff_hash) {
        info!(
            "[get_file_symbol_diffs] CACHE HIT: {} files from cache in {:?}",
            cached.len(),
            t0.elapsed()
        );
        return Ok(cached);
    }

    let all_hunks = parse_multi_file_diff(&full_diff);
    let rename_map = crate::diff::parser::extract_rename_map(&full_diff);

    // Pass 1: compute FileSymbolDiff per file (parallel), also return file contents for reuse
    let pass1_results: Vec<(
        FileSymbolDiff,
        Option<String>,
        Option<String>,
        Vec<DiffHunk>,
    )> = std::thread::scope(|s| {
        let handles: Vec<_> = file_paths
            .iter()
            .map(|file_path| {
                let source = &source;
                let all_hunks = &all_hunks;
                let old_ref = old_ref.as_str();
                let comparison = comparison;
                let repo_path = repo_path;
                let rename_map = &rename_map;
                s.spawn(move || {
                    // Get old content (use old path for renamed files)
                    let old_path = rename_map
                        .get(file_path.as_str())
                        .map(|s| s.as_str())
                        .unwrap_or(file_path);
                    let old_content = source
                        .get_file_bytes(old_path, old_ref)
                        .ok()
                        .and_then(|bytes| String::from_utf8(bytes).ok());

                    // Get new content
                    let new_content = if source.include_working_tree(comparison) {
                        let full_path = repo_path.join(file_path);
                        std::fs::read_to_string(&full_path).ok()
                    } else {
                        source
                            .get_file_bytes(file_path, &comparison.head)
                            .ok()
                            .and_then(|bytes| String::from_utf8(bytes).ok())
                    };

                    let file_hunks: Vec<_> = all_hunks
                        .iter()
                        .filter(|h| h.file_path == *file_path)
                        .cloned()
                        .collect();

                    let diff = symbols::extractor::compute_file_symbol_diff(
                        old_content.as_deref(),
                        new_content.as_deref(),
                        file_path,
                        &file_hunks,
                    );

                    (diff, old_content, new_content, file_hunks)
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });

    // Collect modified symbol names across all files (from SymbolDiff trees)
    let mut modified_symbols: HashSet<String> = HashSet::new();
    // Track definition ranges per file: file_path -> (symbol_name -> (start, end))
    let mut definition_ranges_by_file: HashMap<String, HashMap<String, (u32, u32)>> =
        HashMap::new();

    fn collect_modified_names(
        symbols: &[crate::symbols::SymbolDiff],
        file_path: &str,
        modified: &mut HashSet<String>,
        def_ranges: &mut HashMap<String, HashMap<String, (u32, u32)>>,
    ) {
        for sym in symbols {
            modified.insert(sym.name.clone());
            // Track definition range for this symbol in this file
            if let Some(ref range) = sym.new_range {
                def_ranges
                    .entry(file_path.to_owned())
                    .or_default()
                    .insert(sym.name.clone(), (range.start_line, range.end_line));
            } else if let Some(ref range) = sym.old_range {
                def_ranges
                    .entry(file_path.to_owned())
                    .or_default()
                    .insert(sym.name.clone(), (range.start_line, range.end_line));
            }
            collect_modified_names(&sym.children, file_path, modified, def_ranges);
        }
    }

    for (diff, _, _, _) in &pass1_results {
        collect_modified_names(
            &diff.symbols,
            &diff.file_path,
            &mut modified_symbols,
            &mut definition_ranges_by_file,
        );
    }

    // Extract per-file imported names for scoping symbol reference search
    let import_maps: Vec<Option<HashSet<String>>> = pass1_results
        .iter()
        .map(|(diff, _, new_content, _)| {
            new_content
                .as_deref()
                .and_then(|c| symbols::extractor::extract_imported_names(c, &diff.file_path))
        })
        .collect();

    // Pass 2: find references to modified symbols in each file (parallel)
    let results: Vec<FileSymbolDiff> = std::thread::scope(|s| {
        let handles: Vec<_> = pass1_results
            .into_iter()
            .zip(import_maps)
            .map(
                |((mut diff, old_content, new_content, file_hunks), file_imports)| {
                    let modified_symbols = &modified_symbols;
                    let definition_ranges_by_file = &definition_ranges_by_file;
                    s.spawn(move || {
                        if diff.has_grammar {
                            let file_path = &diff.file_path;
                            let def_ranges = definition_ranges_by_file
                                .get(file_path)
                                .cloned()
                                .unwrap_or_default();

                            // Scope target symbols: intersect with file's imports
                            let scoped_symbols: HashSet<String>;
                            let target_symbols = match &file_imports {
                                Some(imports) => {
                                    let defined_in_file: HashSet<&String> =
                                        def_ranges.keys().collect();
                                    scoped_symbols = modified_symbols
                                        .iter()
                                        .filter(|sym| {
                                            imports.contains(sym.as_str())
                                                || defined_in_file.contains(sym)
                                        })
                                        .cloned()
                                        .collect();
                                    &scoped_symbols
                                }
                                None => modified_symbols,
                            };

                            // Find references in new content
                            if let Some(ref content) = new_content {
                                let mut refs = symbols::extractor::find_symbol_references(
                                    content,
                                    file_path,
                                    &file_hunks,
                                    target_symbols,
                                    &def_ranges,
                                    true,
                                );
                                diff.symbol_references.append(&mut refs);
                            }

                            // Find references in old content (for deletion-only hunks)
                            if let Some(ref content) = old_content {
                                let mut refs = symbols::extractor::find_symbol_references(
                                    content,
                                    file_path,
                                    &file_hunks,
                                    target_symbols,
                                    &def_ranges,
                                    false,
                                );
                                // Deduplicate
                                let existing: HashSet<(&str, &str)> = diff
                                    .symbol_references
                                    .iter()
                                    .map(|r| (r.symbol_name.as_str(), r.hunk_id.as_str()))
                                    .collect();
                                refs.retain(|r| {
                                    !existing
                                        .contains(&(r.symbol_name.as_str(), r.hunk_id.as_str()))
                                });
                                diff.symbol_references.append(&mut refs);
                            }
                        }
                        diff
                    })
                },
            )
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok()).collect()
    });

    // Save to disk cache for next time
    let _ = symbols::cache::save(repo_path, comparison, &diff_hash, &results);

    info!(
        "[get_file_symbol_diffs] SUCCESS: {} files processed in {:?}",
        results.len(),
        t0.elapsed()
    );
    Ok(results)
}

/// Extract symbols from all tracked files in the repo.
pub fn get_repo_symbols(repo_path: &Path) -> anyhow::Result<Vec<RepoFileSymbols>> {
    let t0 = Instant::now();
    debug!("[get_repo_symbols] repo_path={}", repo_path.display());

    let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
    let tracked_files = source
        .get_tracked_files()
        .context("Failed to get tracked files")?;

    let mut results = Vec::new();
    for file_path in &tracked_files {
        if symbols::extractor::get_language_for_file(file_path).is_none() {
            continue;
        }
        let full_path = repo_path.join(file_path);
        let syms = std::fs::read_to_string(&full_path)
            .ok()
            .and_then(|content| symbols::extractor::extract_symbols(&content, file_path))
            .unwrap_or_default();
        if syms.is_empty() {
            continue;
        }
        results.push(RepoFileSymbols {
            file_path: file_path.clone(),
            symbols: syms,
        });
    }

    results.sort_by(|a, b| a.file_path.cmp(&b.file_path));
    info!(
        "[get_repo_symbols] SUCCESS: {} files with symbols (from {} tracked) in {:?}",
        results.len(),
        tracked_files.len(),
        t0.elapsed()
    );
    Ok(results)
}

/// Extract all symbols from a file using tree-sitter.
pub fn get_file_symbols(
    repo_path: &Path,
    file_path: &str,
    git_ref: Option<&str>,
) -> anyhow::Result<Option<Vec<Symbol>>> {
    debug!(
        "[get_file_symbols] repo_path={}, file_path={file_path}, ref={git_ref:?}",
        repo_path.display()
    );

    let content = if let Some(r) = git_ref {
        let source = LocalGitSource::new(repo_path.to_path_buf()).context("Failed to open repo")?;
        source
            .get_file_bytes(file_path, r)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
    } else {
        let full_path = repo_path.join(file_path);
        std::fs::read_to_string(&full_path).ok()
    };

    let Some(content) = content else {
        return Ok(None);
    };

    Ok(symbols::extractor::extract_symbols(&content, file_path))
}

/// Find symbol definitions by name across the repo.
pub fn find_symbol_definitions(
    repo_path: &Path,
    symbol_name: &str,
    git_ref: Option<&str>,
) -> anyhow::Result<Vec<SymbolDefinition>> {
    debug!(
        "[find_symbol_definitions] repo_path={}, symbol_name={symbol_name}, git_ref={git_ref:?}",
        repo_path.display()
    );

    let repo_path_str = repo_path.to_string_lossy();

    // Use git grep to find candidate files containing the symbol name.
    let mut cmd = std::process::Command::new("git");
    cmd.args(["grep", "-l", "-F", "--", symbol_name]);
    if let Some(r) = git_ref {
        cmd.arg(r);
    }
    let output = cmd
        .current_dir(repo_path)
        .output()
        .context("Failed to run git grep")?;

    let candidate_files: Vec<String> = if output.status.success() {
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(|l| {
                // When searching a ref, git grep outputs "ref:path" — strip the ref prefix
                if git_ref.is_some() {
                    l.splitn(2, ':').nth(1).unwrap_or(l).to_string()
                } else {
                    l.to_string()
                }
            })
            .collect()
    } else {
        Vec::new()
    };

    // Filter to files with tree-sitter grammar support, cap at 50
    let supported_files: Vec<&String> = candidate_files
        .iter()
        .filter(|f| symbols::extractor::get_language_for_file(f).is_some())
        .take(50)
        .collect();

    info!(
        "[find_symbol_definitions] {} candidates, {} with grammar support (capped at 50)",
        candidate_files.len(),
        supported_files.len()
    );

    // Process candidates in parallel using scoped threads
    let mut all_defs = Vec::new();
    std::thread::scope(|scope| {
        let handles: Vec<_> = supported_files
            .iter()
            .map(|file_path| {
                let repo = &repo_path_str;
                let name = symbol_name;
                let fp = file_path.as_str();
                let r = &git_ref;
                scope.spawn(move || {
                    let content = if let Some(git_r) = r {
                        let show_output = std::process::Command::new("git")
                            .args(["show", &format!("{git_r}:{fp}")])
                            .current_dir(repo.as_ref())
                            .output();
                        match show_output {
                            Ok(o) if o.status.success() => {
                                String::from_utf8_lossy(&o.stdout).to_string()
                            }
                            _ => return Vec::new(),
                        }
                    } else {
                        let full_path = std::path::PathBuf::from(repo.as_ref()).join(fp);
                        match std::fs::read_to_string(&full_path) {
                            Ok(c) => c,
                            Err(_) => return Vec::new(),
                        }
                    };
                    symbols::extractor::find_definitions(&content, fp, name)
                })
            })
            .collect();

        for handle in handles {
            if let Ok(defs) = handle.join() {
                all_defs.extend(defs);
            }
        }
    });

    info!(
        "[find_symbol_definitions] SUCCESS: {} definitions found",
        all_defs.len()
    );
    Ok(all_defs)
}
