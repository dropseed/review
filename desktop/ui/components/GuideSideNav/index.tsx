import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useReviewStore } from "../../stores";
import { isHunkReviewed } from "../../types";
import type { DiffHunk } from "../../types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { Checkbox } from "../ui/checkbox";

function VerticalDotsIcon({
  className = "w-3.5 h-3.5",
}: {
  className?: string;
}): ReactNode {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <circle cx="12" cy="5" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="12" cy="19" r="1.5" />
    </svg>
  );
}

function Spinner({ className = "h-3 w-3" }: { className?: string }): ReactNode {
  return (
    <svg
      className={`animate-spin ${className}`}
      viewBox="0 0 24 24"
      fill="none"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function buildHunkMap(hunks: DiffHunk[]): Map<string, DiffHunk> {
  const map = new Map<string, DiffHunk>();
  for (const h of hunks) map.set(h.id, h);
  return map;
}

function formatStalenessMessage(added: number, removed: number): string {
  if (added > 0 && removed > 0) {
    return `+${added} / -${removed} hunks since generated`;
  }
  if (added > 0) {
    return `+${added} new ${added === 1 ? "hunk" : "hunks"} since generated`;
  }
  return `-${removed} ${removed === 1 ? "hunk" : "hunks"} since generated`;
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

export function GuideSideNav(): ReactNode {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const activeEntry = useReviewStore((s) => s.getActiveGroupingEntry());
  const reviewGroups = activeEntry.reviewGroups;
  const groupingLoading = activeEntry.groupingLoading;
  const groupingError = activeEntry.groupingError;
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const setActiveGroupIndex = useReviewStore((s) => s.setActiveGroupIndex);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const setGuideContentMode = useReviewStore((s) => s.setGuideContentMode);
  const generateGrouping = useReviewStore((s) => s.generateGrouping);
  const getGroupingStaleness = useReviewStore((s) => s.getGroupingStaleness);
  const staleness = useMemo(
    () => getGroupingStaleness(),
    [getGroupingStaleness, hunks, reviewState],
  );
  const exitGuide = useReviewStore((s) => s.exitGuide);
  const excludeReviewed = useReviewStore((s) => s.excludeReviewedFromGrouping);
  const setExcludeReviewed = useReviewStore(
    (s) => s.setExcludeReviewedFromGrouping,
  );
  const clearGrouping = useReviewStore((s) => s.clearGrouping);

  const hunkById = useMemo(() => buildHunkMap(hunks), [hunks]);
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

  // Group consecutive groups that share the same phase for section headers
  const phaseGroups = useMemo(() => {
    const result: {
      phase: string;
      items: { group: (typeof reviewGroups)[0]; index: number }[];
    }[] = [];
    let current: (typeof result)[0] | null = null;
    reviewGroups.forEach((group, i) => {
      const phase = group.phase || "Changes";
      if (!current || current.phase !== phase) {
        current = { phase, items: [] };
        result.push(current);
      }
      current.items.push({ group, index: i });
    });
    return result;
  }, [reviewGroups]);

  const showPhaseHeaders = phaseGroups.length > 1;

  // Auto-advance to next unreviewed group when current group completes
  useEffect(() => {
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
      setActiveGroupIndex(index);
      setGuideContentMode("group");
    },
    [setActiveGroupIndex, setGuideContentMode],
  );

  // Staleness
  const guide = reviewState?.guide;
  const hasGrouping = guide != null && guide.groups.length > 0;
  const stale = hasGrouping && staleness.stale;
  const hasGroups = reviewGroups.length > 0;

  return (
    <nav
      className="guide-floating-panel relative flex h-full shrink-0 flex-col rounded-xl backdrop-blur-xl overflow-hidden"
      style={{ width: "15rem" }}
      aria-label="Guided Review"
    >
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 flex items-center gap-2">
        <svg
          className="h-3.5 w-3.5 text-guide shrink-0"
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
        </svg>
        <span className="text-[11px] font-medium text-fg-secondary flex-1 min-w-0 truncate">
          Guided Review
        </span>
        {/* Overflow menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex items-center justify-center w-6 h-6 shrink-0 rounded-md
                         hover:bg-fg/[0.08] transition-colors duration-100
                         text-fg-muted hover:text-fg-secondary"
              aria-label="Guide options"
            >
              <VerticalDotsIcon />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={() => generateGrouping()}
              disabled={groupingLoading}
            >
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.016 4.356v4.992"
                />
              </svg>
              Regenerate
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={clearGrouping}
              disabled={groupingLoading}
            >
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0"
                />
              </svg>
              Clear grouping
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <button
          type="button"
          onClick={exitGuide}
          className="flex items-center justify-center w-6 h-6 shrink-0 rounded-md
                     hover:bg-fg/[0.08] transition-colors duration-100
                     text-fg-muted hover:text-fg-secondary"
          aria-label="Exit guided review"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      {/* Group list */}
      <div className="flex-1 overflow-y-auto scrollbar-thin border-t border-edge/50 mt-0.5">
        {/* Stale indicator with delta info */}
        {stale && !groupingLoading && (
          <div className="px-3 pt-1.5 pb-1 flex items-center justify-between gap-2">
            <span className="text-xxs text-fg-faint">
              {formatStalenessMessage(staleness.added, staleness.removed)}
            </span>
            <button
              onClick={() => generateGrouping()}
              className="text-xxs font-medium text-status-modified hover:text-status-modified/80 transition-colors shrink-0"
              title="Regenerate all groups from scratch with AI"
            >
              Regenerate
            </button>
          </div>
        )}

        {/* Error */}
        {groupingError && (
          <div className="px-3 py-1.5">
            <div className="rounded bg-status-rejected/10 px-2 py-1.5 inset-ring-1 inset-ring-status-rejected/20">
              <p className="text-xxs text-status-rejected mb-1">
                Failed: {groupingError}
              </p>
              <button
                type="button"
                onClick={() => generateGrouping()}
                className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
              >
                Retry
              </button>
            </div>
          </div>
        )}

        {/* Loading state */}
        {groupingLoading && !hasGroups && (
          <div className="px-3 py-4 text-center">
            <div className="flex items-center justify-center gap-2 text-fg-muted">
              <Spinner />
              <span className="text-xs">Generating groups…</span>
            </div>
          </div>
        )}

        {/* Group items (with phase headers) */}
        {phaseGroups.map(({ phase, items }) => (
          <div key={phase}>
            {showPhaseHeaders && (
              <div className="px-3 pt-3 pb-1">
                <span className="text-xxs font-semibold text-fg-muted uppercase tracking-wider">
                  {phase}
                </span>
              </div>
            )}
            {items.map(({ group, index: i }) => {
              const unreviewedCount =
                groupUnreviewedCounts.get(group.title) ?? 0;
              const isCompleted = unreviewedCount === 0;
              const isActive =
                guideContentMode === "group" && activeGroupIndex === i;
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
                  <span className="flex-1 text-left line-clamp-2">
                    {group.title}
                  </span>
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
          </div>
        ))}

        {/* Loading more groups indicator */}
        {groupingLoading && hasGroups && (
          <div className="flex items-center gap-2 px-3 py-1.5 text-fg-muted">
            <Spinner />
            <span className="text-xxs">Loading more groups…</span>
          </div>
        )}

        {/* All groups reviewed */}
        {hasGroups && totalGroupUnreviewed === 0 && (
          <div className="px-3 py-2 border-t border-edge/50">
            <span className="text-xxs text-status-approved font-medium">
              All groups reviewed
            </span>
          </div>
        )}
      </div>

      {/* Footer options */}
      <div className="shrink-0 border-t border-edge/50 px-3 py-2">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <Checkbox
            checked={excludeReviewed}
            onCheckedChange={(v) => setExcludeReviewed(v === true)}
            className="h-3 w-3"
          />
          <span className="text-xxs text-fg-muted select-none">
            Exclude reviewed hunks
          </span>
        </label>
      </div>
    </nav>
  );
}
