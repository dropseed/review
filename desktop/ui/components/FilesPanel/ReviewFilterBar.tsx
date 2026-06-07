import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import type { HunkRisk } from "../../types";
import { selectHunkIds } from "../../types/hunkFilter";

const RISK_OPTIONS: { value: HunkRisk; label: string }[] = [
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

/**
 * The Review tab's filter + bulk-action bar. Filtering (risk, for now) writes
 * the `reviewFilter` the file sections read, so a choice scopes the whole tab;
 * the action row then approves/rejects/saves exactly the matching set. This is
 * the "select by predicate → act on selection" surface the per-angle bulk
 * buttons collapse into — adding an axis is a toggle, not a new button.
 *
 * Hidden until a hunk actually carries a risk, to stay out of the way of
 * reviews that don't use the axis.
 */
export function ReviewFilterBar() {
  const reviewFilter = useReviewStore((s) => s.reviewFilter);
  const setReviewFilter = useReviewStore((s) => s.setReviewFilter);
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunks = useAllHunks();
  const hasAnyRisk = useReviewStore((s) =>
    s.reviewState
      ? Object.values(s.reviewState.hunks).some((h) => h.risk != null)
      : false,
  );

  const activeRisk = reviewFilter.risk?.[0] ?? null;
  const filterActive = activeRisk != null;

  const matchingIds = useMemo(
    () => (filterActive ? selectHunkIds(hunks, reviewState, reviewFilter) : []),
    [filterActive, hunks, reviewState, reviewFilter],
  );

  if (!hasAnyRisk && activeRisk == null) return null;

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
      <div className="flex items-center gap-1 px-2 py-1.5">
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
