import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import { computeGuideGroups, type Group } from "../../stores/selectors/groups";

/**
 * The active guide's groups, reconciled against the currently loaded diff
 * and filtered down to non-empty ones. Shared subscription + memo behind
 * {@link GuideBanner} and {@link GuideModePanel} so both agree on exactly
 * which groups exist.
 */
export function useGuideGroups(): Group[] {
  const reviewGroups = useReviewStore(
    (s) => s.getActiveGroupingEntry().reviewGroups,
  );
  const hunks = useAllHunks();

  return useMemo(
    () =>
      computeGuideGroups(reviewGroups, hunks).filter(
        (g) => g.hunkIds.length > 0,
      ),
    [reviewGroups, hunks],
  );
}
