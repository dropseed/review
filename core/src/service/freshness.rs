//! Review freshness checking — determines whether a review's diff is still active.

use log::error;
use std::path::PathBuf;

use crate::sources::github::GhCliProvider;
use crate::sources::local_git::{DiffShortStat, LocalGitSource};
use crate::sources::traits::Comparison;

use super::{ReviewFreshnessInput, ReviewFreshnessResult};

/// A diff is considered active when it has any changed files, additions, or deletions.
pub fn is_diff_active(stats: &Option<DiffShortStat>) -> bool {
    stats
        .as_ref()
        .is_some_and(|s| s.file_count > 0 || s.additions > 0 || s.deletions > 0)
}

/// Detect missing refs by checking if a non-empty ref resolved to the empty tree.
pub fn missing_refs_from_resolved(
    comparison: &Comparison,
    resolved_old: &str,
    resolved_new: &str,
) -> Vec<String> {
    let mut missing = Vec::new();
    if !comparison.base.is_empty() && resolved_old == LocalGitSource::EMPTY_TREE {
        missing.push(comparison.base.clone());
    }
    if !comparison.head.is_empty() && resolved_new == LocalGitSource::EMPTY_TREE {
        missing.push(comparison.head.clone());
    }
    missing
}

/// Check freshness for a single review.
pub fn check_single_review_freshness(input: ReviewFreshnessInput) -> ReviewFreshnessResult {
    let key = format!("{}:{}", input.repo_path, input.comparison.key);

    // PR comparisons: check state via gh CLI
    if let Some(ref pr) = input.github_pr {
        let provider = GhCliProvider::new(PathBuf::from(&input.repo_path));
        match provider.get_pr_status(pr.number) {
            Ok(status) => {
                let is_merged_or_closed = status.state == "MERGED" || status.state == "CLOSED";
                if is_merged_or_closed {
                    return ReviewFreshnessResult {
                        key,
                        is_active: false,
                        old_sha: None,
                        new_sha: Some(status.head_ref_oid),
                        diff_stats: None,
                        missing_refs: vec![],
                    };
                }
                // PR is open — check if head SHA changed
                let sha_unchanged = input
                    .cached_new_sha
                    .as_deref()
                    .is_some_and(|cached| cached == status.head_ref_oid);
                if sha_unchanged {
                    return ReviewFreshnessResult {
                        key,
                        is_active: true,
                        old_sha: input.cached_old_sha,
                        new_sha: Some(status.head_ref_oid),
                        diff_stats: None,
                        missing_refs: vec![],
                    };
                }
                // Head changed — re-check diff stats
                let source = match LocalGitSource::new(PathBuf::from(&input.repo_path)) {
                    Ok(s) => s,
                    Err(_) => {
                        return ReviewFreshnessResult {
                            key,
                            is_active: true,
                            old_sha: None,
                            new_sha: Some(status.head_ref_oid),
                            diff_stats: None,
                            missing_refs: vec![],
                        };
                    }
                };
                let stats = source.get_diff_shortstat(&input.comparison).ok();
                return ReviewFreshnessResult {
                    key,
                    is_active: is_diff_active(&stats),
                    old_sha: None,
                    new_sha: Some(status.head_ref_oid),
                    diff_stats: stats,
                    missing_refs: vec![],
                };
            }
            Err(_) => {
                return ReviewFreshnessResult {
                    key,
                    is_active: false,
                    old_sha: None,
                    new_sha: None,
                    diff_stats: None,
                    missing_refs: vec![],
                };
            }
        }
    }

    // Local comparisons: resolve SHAs and compare with cache
    let source = match LocalGitSource::new(PathBuf::from(&input.repo_path)) {
        Ok(s) => s,
        Err(_) => {
            return ReviewFreshnessResult {
                key,
                is_active: false,
                old_sha: None,
                new_sha: None,
                diff_stats: None,
                missing_refs: vec![],
            };
        }
    };

    // Working tree comparisons always need re-check
    if source.include_working_tree(&input.comparison) {
        let stats = source.get_diff_shortstat(&input.comparison).ok();
        return ReviewFreshnessResult {
            key,
            is_active: is_diff_active(&stats),
            old_sha: None,
            new_sha: None,
            diff_stats: stats,
            missing_refs: vec![],
        };
    }

    // Non-working-tree local comparisons: resolve SHAs
    let resolved_old = source.resolve_ref_or_empty_tree(&input.comparison.base);
    let resolved_new = source.resolve_ref_or_empty_tree(&input.comparison.head);

    let missing_refs = missing_refs_from_resolved(&input.comparison, &resolved_old, &resolved_new);
    if !missing_refs.is_empty() {
        return ReviewFreshnessResult {
            key,
            is_active: false,
            old_sha: None,
            new_sha: None,
            diff_stats: None,
            missing_refs,
        };
    }

    let old_unchanged = input
        .cached_old_sha
        .as_deref()
        .is_some_and(|cached| cached == resolved_old);
    let new_unchanged = input
        .cached_new_sha
        .as_deref()
        .is_some_and(|cached| cached == resolved_new);

    if old_unchanged && new_unchanged {
        return ReviewFreshnessResult {
            key,
            is_active: resolved_old != resolved_new,
            old_sha: Some(resolved_old),
            new_sha: Some(resolved_new),
            diff_stats: None,
            missing_refs: vec![],
        };
    }

    // SHAs changed — re-check diff stats
    let stats = source.get_diff_shortstat(&input.comparison).ok();
    ReviewFreshnessResult {
        key,
        is_active: is_diff_active(&stats),
        old_sha: Some(resolved_old),
        new_sha: Some(resolved_new),
        diff_stats: stats,
        missing_refs: vec![],
    }
}

/// Batch-check freshness for multiple reviews in parallel.
pub async fn check_reviews_freshness(
    reviews: Vec<ReviewFreshnessInput>,
) -> Vec<ReviewFreshnessResult> {
    static FRESHNESS_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(6);

    let handles: Vec<_> = reviews
        .into_iter()
        .map(|input| {
            tokio::spawn(async move {
                let _permit = FRESHNESS_SEMAPHORE.acquire().await.unwrap();
                tokio::task::spawn_blocking(move || check_single_review_freshness(input)).await
            })
        })
        .collect();

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(Ok(result)) => results.push(result),
            Ok(Err(e)) => error!("[check_reviews_freshness] task panicked: {e}"),
            Err(e) => error!("[check_reviews_freshness] join error: {e}"),
        }
    }
    results
}
