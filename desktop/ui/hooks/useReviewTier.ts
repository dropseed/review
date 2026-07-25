import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { getApiClient } from "../api";

/**
 * Repos already swept this session.
 *
 * Module-level, not state: the sweep is disk housekeeping, not something a
 * render depends on, and re-running it per repo switch would re-pay a `gh`
 * round trip for every open PR review each time the user ping-pongs between
 * two repos.
 */
const sweptRepos = new Set<string>();

/**
 * Keep the active review's tier in the store, and reclaim dead PR checkouts.
 *
 * Mounted once in ReviewView. The tier is re-probed whenever the review
 * changes; promotions and releases update it themselves through the store.
 */
export function useReviewTier(): void {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);

  useEffect(() => {
    if (!repoPath || !reviewRef) return;
    void useReviewStore.getState().loadReviewTier();
  }, [repoPath, reviewRef]);

  // Reclaim disk from PRs that merged or closed while we weren't looking.
  useEffect(() => {
    if (!repoPath || sweptRepos.has(repoPath)) return;
    sweptRepos.add(repoPath);

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
