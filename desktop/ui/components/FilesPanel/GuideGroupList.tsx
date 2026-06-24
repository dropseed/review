import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { useReviewStore } from "../../stores";
import { useHunkById, useAllHunks } from "../../stores/selectors/hunks";
import { isHunkReviewed } from "../../types";

function formatStalenessMessage(added: number, removed: number): string {
  if (added > 0 && removed > 0) {
    return `+${added} / -${removed} hunks since the guide was built`;
  }
  if (added > 0) {
    return `+${added} new ${added === 1 ? "hunk" : "hunks"} since the guide was built`;
  }
  return `-${removed} ${removed === 1 ? "hunk" : "hunks"} since the guide was built`;
}

function groupItemStyle(isActive: boolean, isCompleted: boolean): string {
  if (isActive) return "bg-guide/15 text-guide border-l-2 border-guide";
  if (isCompleted)
    return "text-fg-faint hover:text-fg-muted hover:bg-surface-raised/30 border-l-2 border-transparent";
  return "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/30 border-l-2 border-transparent";
}

function ungroupedItemStyle(isActive: boolean, isCompleted: boolean): string {
  if (isActive)
    return "bg-fg/[0.06] text-fg-secondary border-l-2 border-dashed border-fg-faint";
  if (isCompleted)
    return "text-fg-faint hover:text-fg-muted hover:bg-surface-raised/30 border-l-2 border-dashed border-transparent";
  return "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/30 border-l-2 border-dashed border-transparent";
}

/** Shared hook for guide group state. Used by both FilesPanel (for section header) and GuideGroupList (for content). */
export function useGuideGroupState() {
  const guideExpanded = useReviewStore((s) => s.guideExpanded);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const activeEntry = useReviewStore((s) => s.getActiveGroupingEntry());
  const reviewGroups = activeEntry.reviewGroups;

  const hunkById = useHunkById();
  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;
  const hunkStates = reviewState?.hunks;

  const groupUnreviewedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of reviewGroups) {
      let count = 0;
      for (const id of group.hunkIds) {
        const hunk = hunkById.get(id);
        if (
          hunk &&
          !isHunkReviewed(hunkStates?.[id], trustList, {
            autoApproveStaged,
            stagedFilePaths,
            filePath: hunk.filePath,
          })
        ) {
          count++;
        }
      }
      counts.set(group.title, count);
    }
    return counts;
  }, [
    reviewGroups,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);

  const totalGroupUnreviewed = useMemo(() => {
    let count = 0;
    for (const c of groupUnreviewedCounts.values()) count += c;
    return count;
  }, [groupUnreviewedCounts]);

  return {
    guideActive: guideExpanded,
    totalGroupUnreviewed,
    groupUnreviewedCounts,
    reviewGroups,
  };
}

export function GuideGroupList(): ReactNode {
  const { totalGroupUnreviewed, groupUnreviewedCounts, reviewGroups } =
    useGuideGroupState();

  const hunks = useAllHunks();
  const reviewState = useReviewStore((s) => s.reviewState);
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const setActiveGroupIndex = useReviewStore((s) => s.setActiveGroupIndex);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const setGuideContentMode = useReviewStore((s) => s.setGuideContentMode);
  const getGroupingStaleness = useReviewStore((s) => s.getGroupingStaleness);
  const staleness = useMemo(
    () => getGroupingStaleness(),
    [getGroupingStaleness, hunks, reviewState],
  );

  // Suppress auto-advance immediately after the user clicks a group,
  // so their explicit selection isn't overridden by the effect below.
  const userNavigatedRef = useRef(false);

  // Auto-advance to next unreviewed group when current group completes
  useEffect(() => {
    if (userNavigatedRef.current) {
      userNavigatedRef.current = false;
      return;
    }
    if (guideContentMode !== "group" || reviewGroups.length === 0) return;
    const currentGroup = reviewGroups[activeGroupIndex];
    if (!currentGroup) return;
    const currentUnreviewed =
      groupUnreviewedCounts.get(currentGroup.title) ?? 0;
    if (currentUnreviewed > 0) return;

    const nextIndex = reviewGroups.findIndex(
      (g, i) =>
        i > activeGroupIndex && (groupUnreviewedCounts.get(g.title) ?? 0) > 0,
    );
    if (nextIndex >= 0) {
      const timer = setTimeout(() => setActiveGroupIndex(nextIndex), 300);
      return () => clearTimeout(timer);
    }
  }, [
    groupUnreviewedCounts,
    activeGroupIndex,
    reviewGroups,
    setActiveGroupIndex,
    guideContentMode,
  ]);

  const handleGroupClick = useCallback(
    (index: number) => {
      userNavigatedRef.current = true;
      setActiveGroupIndex(index);
      setGuideContentMode("group");
    },
    [setActiveGroupIndex, setGuideContentMode],
  );

  const generated = reviewState?.guide?.state;
  const hasGrouping = generated != null && generated.groups.length > 0;
  const stale = hasGrouping && staleness.stale;
  const hasGroups = reviewGroups.length > 0;

  if (!hasGroups) {
    return (
      <div className="px-3 py-6 text-center space-y-1.5">
        <p className="text-xs text-fg-muted">No guide yet</p>
        <p className="text-xxs text-fg-faint leading-relaxed">
          Guides are built by your review agent. Ask it to organize these hunks
          — e.g. run the review-guide skill — and the groups will appear here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {stale && (
        <div className="px-3 pt-1.5 pb-1">
          <span className="text-xxs text-fg-faint">
            {formatStalenessMessage(staleness.added, staleness.removed)}
          </span>
        </div>
      )}

      {reviewGroups.map((group, i) => {
        const unreviewedCount = groupUnreviewedCounts.get(group.title) ?? 0;
        const isCompleted = unreviewedCount === 0;
        const isActive = guideContentMode === "group" && activeGroupIndex === i;
        return (
          <button
            key={group.title}
            type="button"
            onClick={() => handleGroupClick(i)}
            className={`flex items-start gap-2 w-full pl-2.5 pr-3 py-2 text-xs transition-colors ${
              group.ungrouped
                ? ungroupedItemStyle(isActive, isCompleted)
                : groupItemStyle(isActive, isCompleted)
            }`}
          >
            {isCompleted ? (
              <span className="text-status-approved shrink-0 mt-0.5">
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={3}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </span>
            ) : group.ungrouped ? (
              <span className="w-4 text-center shrink-0 mt-px">
                <svg
                  className="w-3 h-3 text-fg-faint/60 inline"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </span>
            ) : (
              <span className="w-4 text-center text-xxs text-fg-faint/60 shrink-0 tabular-nums mt-0.5">
                {i + 1}
              </span>
            )}
            <span className="flex-1 text-left line-clamp-2">{group.title}</span>
            {!isCompleted && (
              <span
                className={`inline-flex items-center justify-center min-w-[1.125rem] h-[1.125rem] rounded-full text-xxs font-medium tabular-nums shrink-0 px-1 ${
                  group.ungrouped
                    ? "bg-fg/[0.08] text-fg-muted"
                    : "bg-guide/15 text-guide"
                }`}
              >
                {unreviewedCount}
              </span>
            )}
          </button>
        );
      })}

      {totalGroupUnreviewed === 0 && (
        <div className="px-3 py-2 border-t border-edge/50">
          <span className="text-xxs text-status-approved font-medium">
            All groups reviewed
          </span>
        </div>
      )}
    </div>
  );
}
