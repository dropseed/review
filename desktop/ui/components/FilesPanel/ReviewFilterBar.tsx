import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import type { HunkRisk } from "../../types";
import { selectHunkIds, UNCOMMITTED_COMMIT } from "../../types/hunkFilter";

const RISK_OPTIONS: { value: HunkRisk; label: string }[] = [
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

/**
 * The Review tab's filter + bulk-action bar. Filtering (risk and/or label)
 * writes the `reviewFilter` the file sections read, so a choice scopes the
 * whole tab; the action row then approves/rejects/saves exactly the matching
 * set. This is the "select by predicate → act on selection" surface the
 * per-angle bulk buttons collapse into — another axis is a control, not a new
 * button. Hidden until there's actually something to filter on (a risk-tagged
 * hunk or more than one label), to stay out of the way otherwise.
 */
export function ReviewFilterBar() {
  const reviewFilter = useReviewStore((s) => s.reviewFilter);
  const setReviewFilter = useReviewStore((s) => s.setReviewFilter);
  const reviewState = useReviewStore((s) => s.reviewState);
  const hunkCommits = useReviewStore((s) => s.attribution?.hunkCommits);
  const commits = useReviewStore((s) => s.attribution?.commits);
  const hunks = useAllHunks();

  const hasAnyRisk = useMemo(
    () =>
      reviewState
        ? Object.values(reviewState.hunks).some((h) => h.risk != null)
        : false,
    [reviewState],
  );
  const presentLabels = useMemo(() => {
    const set = new Set<string>();
    if (reviewState) {
      for (const h of Object.values(reviewState.hunks)) {
        for (const l of h.classification?.value ?? []) set.add(l);
      }
    }
    return [...set].sort();
  }, [reviewState]);

  const activeRisk = reviewFilter.risk?.[0] ?? null;
  const activeLabel = reviewFilter.label ?? "";
  const activeCommits = reviewFilter.commits ?? [];
  const filterActive =
    activeRisk != null || activeLabel !== "" || activeCommits.length > 0;

  const matchingIds = useMemo(
    () =>
      filterActive
        ? selectHunkIds(hunks, reviewState, reviewFilter, hunkCommits)
        : [],
    [filterActive, hunks, reviewState, reviewFilter, hunkCommits],
  );

  const commitChipLabel =
    activeCommits.length === 1
      ? activeCommits[0] === UNCOMMITTED_COMMIT
        ? "Uncommitted changes"
        : `Commit ${
            commits?.find((c) => c.hash === activeCommits[0])?.shortHash ??
            activeCommits[0].slice(0, 7)
          }`
      : activeCommits.length > 1
        ? `${activeCommits.length} commits`
        : null;
  const clearCommits = () =>
    setReviewFilter({ ...reviewFilter, commits: undefined });

  if (!hasAnyRisk && presentLabels.length < 2 && !filterActive) return null;

  const setRisk = (risk: HunkRisk | null) =>
    setReviewFilter({ ...reviewFilter, risk: risk ? [risk] : undefined });
  const setLabel = (label: string) =>
    setReviewFilter({ ...reviewFilter, label: label || undefined });

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

        {presentLabels.length > 0 && (
          <label className="ml-1 flex items-center gap-1">
            <span className="text-xxs uppercase tracking-wide text-fg-faint">
              Label
            </span>
            <select
              value={activeLabel}
              onChange={(e) => setLabel(e.target.value)}
              aria-label="Filter by label"
              className={`max-w-[12rem] rounded border border-edge-default/50 bg-surface-raised px-1 py-0.5 text-xxs ${
                activeLabel ? "text-fg-secondary" : "text-fg-muted"
              }`}
            >
              <option value="">All</option>
              {presentLabels.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        )}

        {commitChipLabel && (
          <span className="ml-1 inline-flex items-center gap-1 rounded bg-surface-hover px-2 py-0.5 text-xxs text-fg-secondary">
            {commitChipLabel}
            <button
              type="button"
              onClick={clearCommits}
              aria-label="Clear commit filter"
              className="text-fg-faint hover:text-fg-secondary"
            >
              ×
            </button>
          </span>
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
