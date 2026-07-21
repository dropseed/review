import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import { isEmptyFilter } from "../../types/hunkFilter";
import { selectHunkIds } from "../../types/scope";

/**
 * The Review tab's bulk action row (Approve/Reject/Save), acting on exactly
 * the matching set — the active predicate filter intersected with whatever
 * `scope` the commit picker has set (e.g. a single commit's hunks). Hidden
 * until there's an active filter or scope, to stay out of the way otherwise.
 */
export function ReviewFilterBar() {
  const reviewFilter = useReviewStore((s) => s.reviewFilter);
  const scope = useReviewStore((s) => s.scope);
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useAllHunks();

  const filterActive = !isEmptyFilter(reviewFilter) || scope !== null;

  const matchingIds = useMemo(
    () =>
      filterActive
        ? selectHunkIds(hunks, reviewState, reviewFilter, scope)
        : [],
    [filterActive, hunks, reviewState, reviewFilter, scope],
  );

  if (!filterActive || matchingIds.length === 0) return null;

  const base = "rounded px-2 py-0.5 text-xxs font-medium transition-colors";

  const act = (run: (ids: string[]) => void) => () => run(matchingIds);

  return (
    <div
      className="border-b border-edge-default/40"
      data-testid="review-filter-bar"
    >
      <div
        className="flex items-center gap-1 px-2 py-1.5"
        data-testid="review-filter-actions"
      >
        <span className="mr-0.5 text-xxs text-fg-faint">
          {matchingIds.length} matching
        </span>
        <button
          type="button"
          onClick={act((ids) => useReviewStore.getState().approveHunkIds(ids))}
          className={`${base} text-status-approved hover:bg-status-approved/15`}
        >
          Approve
        </button>
        <button
          type="button"
          onClick={act((ids) => useReviewStore.getState().rejectHunkIds(ids))}
          className={`${base} text-status-rejected hover:bg-status-rejected/15`}
        >
          Reject
        </button>
        <button
          type="button"
          onClick={act((ids) =>
            useReviewStore.getState().saveHunkIdsForLater(ids),
          )}
          className={`${base} text-status-modified hover:bg-status-modified/15`}
        >
          Save
        </button>
      </div>
    </div>
  );
}
