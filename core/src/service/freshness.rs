//! Review freshness checking — determines whether a review's diff is still active.

use log::error;
use std::path::PathBuf;

use crate::service::targets::resolve_review;
use crate::sources::github::GhCliProvider;
use crate::sources::local_git::LocalGitSource;
use crate::sources::traits::Comparison;

use super::{ReviewFreshnessInput, ReviewFreshnessResult};

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
    let key = format!("{}:{}", input.repo_path, input.ref_name);

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
                        missing_refs: vec![],
                    };
                }
                // Head changed — re-check whether the diff is active
                let source = match LocalGitSource::new(PathBuf::from(&input.repo_path)) {
                    Ok(s) => s,
                    Err(_) => {
                        return ReviewFreshnessResult {
                            key,
                            is_active: true,
                            old_sha: None,
                            new_sha: Some(status.head_ref_oid),
                            missing_refs: vec![],
                        };
                    }
                };
                let is_active = resolve_review(
                    &source,
                    &input.ref_name,
                    input.base_override.as_deref(),
                    input.github_pr.as_ref(),
                )
                .is_ok_and(|(comparison, _)| source.is_diff_active(&comparison));
                return ReviewFreshnessResult {
                    key,
                    is_active,
                    old_sha: None,
                    new_sha: Some(status.head_ref_oid),
                    missing_refs: vec![],
                };
            }
            Err(_) => {
                return ReviewFreshnessResult {
                    key,
                    is_active: false,
                    old_sha: None,
                    new_sha: None,
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
                missing_refs: vec![],
            };
        }
    };

    // Resolve the review identity into a comparison. An unresolvable ref (e.g. a
    // deleted branch) takes the missing-refs path so the UI still flags it.
    let comparison = match resolve_review(
        &source,
        &input.ref_name,
        input.base_override.as_deref(),
        input.github_pr.as_ref(),
    ) {
        Ok((c, _)) => c,
        Err(_) => {
            return ReviewFreshnessResult {
                key,
                is_active: false,
                old_sha: None,
                new_sha: None,
                missing_refs: vec![input.ref_name.clone()],
            };
        }
    };

    // Working tree comparisons always need re-check
    if source.include_working_tree(&comparison) {
        return ReviewFreshnessResult {
            key,
            is_active: source.is_diff_active(&comparison),
            old_sha: None,
            new_sha: None,
            missing_refs: vec![],
        };
    }

    // Non-working-tree local comparisons: resolve SHAs
    let resolved_old = source.resolve_ref_or_empty_tree(&comparison.base);
    let resolved_new = source.resolve_ref_or_empty_tree(&comparison.head);

    let missing_refs = missing_refs_from_resolved(&comparison, &resolved_old, &resolved_new);
    if !missing_refs.is_empty() {
        return ReviewFreshnessResult {
            key,
            is_active: false,
            old_sha: None,
            new_sha: None,
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
            missing_refs: vec![],
        };
    }

    // SHAs changed — re-check whether the diff is active
    ReviewFreshnessResult {
        key,
        is_active: source.is_diff_active(&comparison),
        old_sha: Some(resolved_old),
        new_sha: Some(resolved_new),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_refs_empty_when_both_resolve_to_non_empty_tree() {
        let comparison = Comparison::new("main", "feature");
        let missing = missing_refs_from_resolved(&comparison, "abc123", "def456");
        assert!(missing.is_empty());
    }

    #[test]
    fn missing_refs_flags_base_resolved_to_empty_tree() {
        let comparison = Comparison::new("deleted-branch", "feature");
        let missing = missing_refs_from_resolved(&comparison, LocalGitSource::EMPTY_TREE, "def456");
        assert_eq!(missing, vec!["deleted-branch".to_owned()]);
    }

    #[test]
    fn missing_refs_flags_head_resolved_to_empty_tree() {
        let comparison = Comparison::new("main", "deleted-branch");
        let missing = missing_refs_from_resolved(&comparison, "abc123", LocalGitSource::EMPTY_TREE);
        assert_eq!(missing, vec!["deleted-branch".to_owned()]);
    }

    #[test]
    fn missing_refs_flags_both_when_both_resolve_to_empty_tree() {
        let comparison = Comparison::new("deleted-base", "deleted-head");
        let missing = missing_refs_from_resolved(
            &comparison,
            LocalGitSource::EMPTY_TREE,
            LocalGitSource::EMPTY_TREE,
        );
        assert_eq!(
            missing,
            vec!["deleted-base".to_owned(), "deleted-head".to_owned()]
        );
    }

    #[test]
    fn missing_refs_ignores_empty_base_ref_even_if_empty_tree() {
        // An empty base ref represents a snapshot (no base), not a missing ref —
        // it legitimately resolves to the empty tree and shouldn't be flagged.
        let comparison = Comparison::new("", "feature");
        let missing = missing_refs_from_resolved(&comparison, LocalGitSource::EMPTY_TREE, "def456");
        assert!(missing.is_empty());
    }

    #[test]
    fn missing_refs_ignores_empty_head_ref_even_if_empty_tree() {
        let comparison = Comparison::new("main", "");
        let missing = missing_refs_from_resolved(&comparison, "abc123", LocalGitSource::EMPTY_TREE);
        assert!(missing.is_empty());
    }
}
