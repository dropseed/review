import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useReviewStore } from "../../stores";
import { isHunkReviewed } from "../../types";
import type { DiffHunk } from "../../types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";

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

function groupItemStyle(isActive: boolean, isCompleted: boolean): string {
  if (isActive) return "bg-guide/10 text-guide";
  if (isCompleted)
    return "text-fg-faint hover:text-fg-muted hover:bg-surface-raised/30";
  return "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/30";
}

function GroupItemOverflowMenu({
  unreviewedIds,
  reviewedIds,
  onApprove,
  onReject,
  onReset,
}: {
  unreviewedIds: string[];
  reviewedIds: string[];
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const hasUnreviewed = unreviewedIds.length > 0;
  const hasReviewed = reviewedIds.length > 0;

  if (!hasUnreviewed && !hasReviewed) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={`mr-1 flex items-center justify-center w-5 h-5 rounded shrink-0
                     text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50
                     transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasUnreviewed && (
          <>
            <DropdownMenuItem onClick={onApprove}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Approve all hunks
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReject}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Reject all hunks
            </DropdownMenuItem>
          </>
        )}
        {hasReviewed && (
          <DropdownMenuItem onClick={onReset}>
            <svg
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
              />
            </svg>
            Reset review
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function GuideSideNav(): ReactNode {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const reviewGroups = useReviewStore((s) => s.reviewGroups);
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const setActiveGroupIndex = useReviewStore((s) => s.setActiveGroupIndex);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const setGuideContentMode = useReviewStore((s) => s.setGuideContentMode);
  const groupingLoading = useReviewStore((s) => s.groupingLoading);
  const groupingError = useReviewStore((s) => s.groupingError);
  const generateGrouping = useReviewStore((s) => s.generateGrouping);
  const isGroupingStale = useReviewStore((s) => s.isGroupingStale);
  const exitGuide = useReviewStore((s) => s.exitGuide);
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);

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

  const groupActionData = useMemo(() => {
    const data = new Map<
      string,
      { unreviewedIds: string[]; reviewedIds: string[] }
    >();
    for (const group of reviewGroups) {
      const unreviewedIds: string[] = [];
      const reviewedIds: string[] = [];
      for (const id of group.hunkIds) {
        const hunk = hunkById.get(id);
        if (!hunk) continue;
        const state = hunkStates?.[id];
        if (state?.status === "approved" || state?.status === "rejected") {
          reviewedIds.push(id);
        }
        if (
          !isHunkReviewed(state, trustList, {
            autoApproveStaged,
            stagedFilePaths,
            filePath: hunk.filePath,
          })
        ) {
          unreviewedIds.push(id);
        }
      }
      data.set(group.title, { unreviewedIds, reviewedIds });
    }
    return data;
  }, [
    reviewGroups,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);

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
  const stale = hasGrouping && isGroupingStale();
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
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Groups header */}
        {(hasGroups || groupingLoading || groupingError) && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-edge/50">
            <span className="text-xxs font-medium text-fg-muted uppercase tracking-wider flex-1">
              Groups
            </span>
            {stale && !groupingLoading && (
              <button
                onClick={() => generateGrouping()}
                className="flex items-center gap-1 rounded-full bg-status-modified/15 px-1.5 py-0.5 text-xxs font-medium text-status-modified hover:bg-status-modified/25 transition-colors"
              >
                Stale
              </button>
            )}
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
              <div className="px-3 pt-2 pb-0.5">
                <span className="text-xxs font-medium text-fg-faint uppercase tracking-wider">
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
              const data = groupActionData.get(group.title);
              return (
                <div key={group.title} className="group flex items-center">
                  <button
                    type="button"
                    onClick={() => handleGroupClick(i)}
                    className={`flex items-start gap-1.5 flex-1 min-w-0 px-3 py-1.5 text-xs transition-colors ${groupItemStyle(isActive, isCompleted)}`}
                  >
                    {isCompleted ? (
                      <span className="text-status-approved shrink-0 mt-px">
                        <svg
                          className="w-3 h-3"
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
                    ) : (
                      <span className="w-4 text-center text-xxs text-fg-faint shrink-0 tabular-nums mt-px">
                        {i + 1}
                      </span>
                    )}
                    <span className="flex-1 text-left">{group.title}</span>
                    {!isCompleted && unreviewedCount > 0 && (
                      <span className="text-xxs text-guide/70 tabular-nums shrink-0">
                        {unreviewedCount}
                      </span>
                    )}
                  </button>
                  <GroupItemOverflowMenu
                    unreviewedIds={data?.unreviewedIds ?? []}
                    reviewedIds={data?.reviewedIds ?? []}
                    onApprove={() => approveHunkIds(data?.unreviewedIds ?? [])}
                    onReject={() => rejectHunkIds(data?.unreviewedIds ?? [])}
                    onReset={() => unapproveHunkIds(data?.reviewedIds ?? [])}
                  />
                </div>
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
    </nav>
  );
}
