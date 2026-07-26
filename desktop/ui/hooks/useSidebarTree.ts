import { useMemo } from "react";
import { useReviewStore } from "../stores";
import { buildSidebarTree, type RepoNode } from "../utils/sidebar-tree";

/**
 * The sidebar tree — repos in activity order, each carrying its own rows.
 *
 * Recomputed at most once per minute (the 7/14-day liveness windows don't need
 * finer granularity) and whenever its inputs change.
 */
export function useSidebarTree(): RepoNode[] {
  const localActivity = useReviewStore((s) => s.localActivity);
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsByKey = useReviewStore((s) => s.globalReviewsByKey);
  const sidebarPinned = useReviewStore((s) => s.sidebarPinned);
  const sidebarDismissed = useReviewStore((s) => s.sidebarDismissed);
  const reviewSortOrder = useReviewStore((s) => s.reviewSortOrder);
  const reviewDiffStats = useReviewStore((s) => s.reviewDiffStats);

  const nowBucket = Math.floor(Date.now() / 60_000);

  return useMemo(
    () =>
      buildSidebarTree(
        localActivity,
        globalReviews,
        globalReviewsByKey,
        sidebarPinned,
        sidebarDismissed,
        nowBucket * 60_000,
        reviewSortOrder,
        reviewDiffStats,
      ),
    [
      localActivity,
      globalReviews,
      globalReviewsByKey,
      sidebarPinned,
      sidebarDismissed,
      nowBucket,
      reviewSortOrder,
      reviewDiffStats,
    ],
  );
}
