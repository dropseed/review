import { useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import {
  computeCommitGroups,
  computeGuideGroups,
  computeStatusGroups,
  countGroupUnreviewed,
  countUnreviewed,
  type Group,
} from "../../stores/selectors/groups";
import type { HunkRisk } from "../../types";
import { isEmptyFilter } from "../../types/hunkFilter";
import { selectHunkIds } from "../../types/scope";
import { truncateSubject } from "./commitFormat";
import { jumpToGroup } from "./jumpToGroup";

const RISK_OPTIONS: { value: HunkRisk; label: string }[] = [
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

/**
 * The Review tab's single filter/scope row: the risk filter (its own
 * toggles), whatever `scope` a group header or the commit/guide pickers have
 * set (a status bucket, a commit or commit range, the uncommitted bucket, or
 * a guide group's exact hunk set), and — once that scope is fully reviewed —
 * a "Next: <group> →" advance button that replaces the old persistent walk
 * bar. The row beneath acts on exactly the matching set — predicate filter
 * AND scope — source-independent. Hidden until there's actually something to
 * filter or an active scope, to stay out of the way otherwise.
 */
export function ReviewFilterBar() {
  const reviewFilter = useReviewStore((s) => s.reviewFilter);
  const setReviewFilter = useReviewStore((s) => s.setReviewFilter);
  const scope = useReviewStore((s) => s.scope);
  const setScope = useReviewStore((s) => s.setScope);
  const setGuideContentMode = useReviewStore((s) => s.setGuideContentMode);
  const reviewState = useReviewStore((s) => s.reviewState);
  const attribution = useReviewStore((s) => s.attribution);
  const guideReviewGroups = useReviewStore(
    (s) => s.getActiveGroupingEntry().reviewGroups,
  );
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

  const clearScope = () => {
    setScope(null);
    if (scope?.source === "guide") setGuideContentMode(null);
  };

  // The group sequence "Next" advances through — same source as the active
  // scope, so a commit scope advances through commits (then Uncommitted), a
  // guide scope through guide groups, and a status scope through the status
  // sections. Mirrors the grouping the old ReviewWalkBar walked. Split into
  // one memo per source so a commit- or guide-scoped session doesn't get a
  // new `sequenceGroups` reference (and re-derive `nextGroup`) on every hunk
  // approve/reject — only computeStatusGroups actually depends on
  // `reviewState`.
  const commitSequence = useMemo(
    () =>
      computeCommitGroups(hunks, attribution ?? null).filter(
        (g) => g.hunkIds.length > 0,
      ),
    [hunks, attribution],
  );
  const guideSequence = useMemo(
    () =>
      computeGuideGroups(guideReviewGroups, hunks).filter(
        (g) => g.hunkIds.length > 0,
      ),
    [guideReviewGroups, hunks],
  );
  const statusSequence = useMemo(
    () =>
      computeStatusGroups(hunks, reviewState).filter(
        (g) => g.hunkIds.length > 0,
      ),
    [hunks, reviewState],
  );
  const sequenceGroups: Group[] = !scope
    ? []
    : scope.source === "commit" || scope.source === "uncommitted"
      ? commitSequence
      : scope.source === "guide"
        ? guideSequence
        : statusSequence;

  const scopeComplete =
    scope !== null &&
    scope.hunkIds.length > 0 &&
    countUnreviewed(scope.hunkIds, reviewState) === 0;

  const nextGroup = useMemo(() => {
    if (!scopeComplete || !scope) return undefined;
    // A commit range/set spans several commit-group keys at once —
    // resolve its position from the highest-ordinal member instead of an
    // exact key match against a single group.
    let afterIndex = -1;
    if (scope.source === "commit" && scope.commitKeys?.length) {
      const keys = new Set(scope.commitKeys);
      sequenceGroups.forEach((g, i) => {
        if (keys.has(g.key)) afterIndex = Math.max(afterIndex, i);
      });
    } else {
      afterIndex = sequenceGroups.findIndex(
        (g) => g.source === scope.source && g.key === scope.key,
      );
    }
    if (afterIndex === -1) return undefined;
    return sequenceGroups
      .slice(afterIndex + 1)
      .find((g) => countGroupUnreviewed(g, reviewState) > 0);
  }, [scopeComplete, scope, sequenceGroups, reviewState]);

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

        {scope && (
          <span className="ml-1 inline-flex items-center gap-1 rounded bg-surface-hover px-2 py-0.5 text-xxs text-fg-secondary">
            {truncateSubject(scope.title, 40)}
            <button
              type="button"
              onClick={clearScope}
              aria-label={`Clear ${scope.title} filter`}
              className="text-fg-faint hover:text-fg-secondary"
            >
              ×
            </button>
          </span>
        )}

        {scopeComplete &&
          (nextGroup ? (
            <button
              type="button"
              onClick={() => jumpToGroup(nextGroup)}
              className={`${base} text-focus-ring hover:bg-focus-ring/10`}
            >
              Next: {truncateSubject(nextGroup.title, 28)} →
            </button>
          ) : (
            <button
              type="button"
              onClick={clearScope}
              className={`${base} text-status-approved hover:bg-status-approved/15`}
            >
              Done
            </button>
          ))}
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
