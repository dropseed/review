import { useMemo } from "react";
import { useReviewStore } from "../stores";
import { buildRepoGroups, type RepoGroup } from "../utils/sidebar-ordering";

/**
 * Returns the repo groups rendered in the sidebar, memoized against the
 * underlying store slices that feed `buildRepoGroups`. Shared by the sidebar
 * header (for derived counts) and the sidebar list (for rendering).
 */
export function useRepoGroups(): RepoGroup[] {
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsByKey = useReviewStore((s) => s.globalReviewsByKey);
  const localActivity = useReviewStore((s) => s.localActivity);
  const reviewSortOrder = useReviewStore((s) => s.reviewSortOrder);
  const reviewDiffStats = useReviewStore((s) => s.reviewDiffStats);

  return useMemo(
    () =>
      buildRepoGroups(
        localActivity,
        globalReviews,
        globalReviewsByKey,
        reviewSortOrder,
        reviewDiffStats,
      ),
    [
      localActivity,
      globalReviews,
      globalReviewsByKey,
      reviewSortOrder,
      reviewDiffStats,
    ],
  );
}
