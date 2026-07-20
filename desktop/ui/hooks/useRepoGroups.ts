import { useMemo } from "react";
import { useReviewStore } from "../stores";
import {
  buildRepoGroups,
  buildOrgGroups,
  type OrgGroup,
  type RepoGroup,
} from "../utils/sidebar-ordering";
import { buildWorkingOn, type WorkingOnEntry } from "../utils/working-on";

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

/**
 * Returns the zone-1 "Working on" list — the flat, cross-repo, activity-derived
 * set rendered above the browse tree. Recomputed at most once per minute (the
 * 7/14-day membership windows don't need finer granularity) and whenever its
 * inputs change.
 */
export function useWorkingOn(): WorkingOnEntry[] {
  const localActivity = useReviewStore((s) => s.localActivity);
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const workingOnPinned = useReviewStore((s) => s.workingOnPinned);
  const workingOnDismissed = useReviewStore((s) => s.workingOnDismissed);

  const nowBucket = Math.floor(Date.now() / 60_000);

  return useMemo(
    () =>
      buildWorkingOn(
        localActivity,
        globalReviews,
        workingOnPinned,
        workingOnDismissed,
        nowBucket * 60_000,
      ),
    [
      localActivity,
      globalReviews,
      workingOnPinned,
      workingOnDismissed,
      nowBucket,
    ],
  );
}

/**
 * Returns the two-level sidebar tree: orgs containing repos. Composed on top
 * of useRepoGroups so the same memoization rules apply.
 */
export function useOrgGroups(): OrgGroup[] {
  const repoGroups = useRepoGroups();
  const repoMetadata = useReviewStore((s) => s.repoMetadata);
  return useMemo(
    () => buildOrgGroups(repoGroups, repoMetadata),
    [repoGroups, repoMetadata],
  );
}
