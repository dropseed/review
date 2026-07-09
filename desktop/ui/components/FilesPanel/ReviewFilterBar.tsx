import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import type { HunkRisk } from "../../types";
import { isEmptyFilter } from "../../types/hunkFilter";
import { selectHunkIds } from "../../types/scope";

const RISK_OPTIONS: { value: HunkRisk; label: string }[] = [
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

/**
 * The Review tab's filter row: the risk filter (its own toggles) plus a bulk
 * action row (Approve/Reject/Save) that acts on exactly the matching set —
 * the risk predicate filter intersected with whatever `scope` the commit
 * picker has set (e.g. a single commit's hunks). Hidden until there's
 * actually something to filter or an active scope, to stay out of the way
 * otherwise.
 */
export function ReviewFilterBar() {
  const reviewFilter = useReviewStore((s) => s.reviewFilter);
  const setReviewFilter = useReviewStore((s) => s.setReviewFilter);
  const scope = useReviewStore((s) => s.scope);
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useAllHunks();

  const hasAnyRisk = useMemo(
    () =>
      reviewState
        ? Object.values(reviewState.hunks).some((h) => h.risk != null)
        : false,
    [reviewState],
  );
  const activeRisk = reviewFilter.risk?.[0] ?? null;
  const filterActive = !isEmptyFilter(reviewFilter) || scope !== null;

  const matchingIds = useMemo(
    () =>
      filterActive
        ? selectHunkIds(hunks, reviewState, reviewFilter, scope)
        : [],
    [filterActive, hunks, reviewState, reviewFilter, scope],
  );

  if (!hasAnyRisk && !filterActive) return null;

  const setRisk = (risk: HunkRisk | null) =>
    setReviewFilter({ ...reviewFilter, risk: risk ? [risk] : undefined });

  const base = "rounded px-2 py-0.5 text-xxs font-medium transition-colors";
  const idle = "text-fg-muted hover:bg-surface-hover";
  const active =
    "bg-surface-hover text-fg-secondary ring-1 ring-edge-strong/40";
  const activeHigh =
    "bg-status-rejected/15 text-status-rejected ring-1 ring-status-rejected/30";

  const act = (run: (ids: string[]) => void) => () => run(matchingIds);

  return (
    <div
      className="border-b border-edge-default/40"
      data-testid="review-filter-bar"
    >
      <div className="flex flex-wrap items-center gap-1 px-2 py-1.5">
        {(hasAnyRisk || activeRisk != null) && (
          <>
            <span className="mr-0.5 text-xxs uppercase tracking-wide text-fg-faint">
              Risk
            </span>
            <button
              type="button"
              onClick={() => setRisk(null)}
              aria-pressed={activeRisk == null}
              className={`${base} ${activeRisk == null ? active : idle}`}
            >
              All
            </button>
            {RISK_OPTIONS.map((o) => {
              const isActive = activeRisk === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setRisk(isActive ? null : o.value)}
                  aria-pressed={isActive}
                  className={`${base} ${
                    isActive ? (o.value === "high" ? activeHigh : active) : idle
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </>
        )}
      </div>

      {filterActive && matchingIds.length > 0 && (
        <div
          className="flex items-center gap-1 px-2 pb-1.5"
          data-testid="review-filter-actions"
        >
          <span className="mr-0.5 text-xxs text-fg-faint">
            {matchingIds.length} matching
          </span>
          <button
            type="button"
            onClick={act((ids) =>
              useReviewStore.getState().approveHunkIds(ids),
            )}
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
      )}
    </div>
  );
}
