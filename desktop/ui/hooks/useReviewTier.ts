import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { getApiClient } from "../api";

/**
 * Keep the active review's tier in the store.
 *
 * Mounted once in ReviewView. Re-probes whenever the review changes, and after
 * a review-state write — materializing records the worktree on the review, so
 * the tier moves whenever that file does.
 */
export function useReviewTier(): void {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);

  useEffect(() => {
    if (!repoPath || !reviewRef) return;
    void useReviewStore.getState().loadReviewTier();
  }, [repoPath, reviewRef]);

  // Reclaim disk from PRs that merged or closed while we weren't looking.
  // Once per repo open, not on every review switch: it costs a `gh` call per
  // PR review, and merged PRs don't appear between two clicks of the sidebar.
  useEffect(() => {
    if (!repoPath) return;
    let cancelled = false;
    getApiClient()
      .reclaimClosedPrs(repoPath)
      .then((refs) => {
        if (cancelled || refs.length === 0) return;
        console.info(
          `[tier] Reclaimed ${refs.length} closed PR review(s): ${refs.join(", ")}`,
        );
        const store = useReviewStore.getState();
        void store.loadLocalActivity();
        void store.loadGlobalReviews();
      })
      .catch(() => {
        // Offline, or no `gh` — nothing to reclaim, nothing to report.
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);
}
