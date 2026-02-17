import { type ReactNode, useCallback, useEffect, useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { isHunkReviewed } from "../../types";
import type { DiffHunk, HunkGroup } from "../../types";
import { SummaryStats } from "../GuideView/SummaryStats";

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

function CheckIcon(): ReactNode {
  return (
    <svg
      className="w-3 h-3"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={3}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function SparkleIcon(): ReactNode {
  return (
    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="currentColor">
      <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
    </svg>
  );
}

function buildHunkMap(hunks: DiffHunk[]): Map<string, DiffHunk> {
  const map = new Map<string, DiffHunk>();
  for (const h of hunks) map.set(h.id, h);
  return map;
}

function GroupNavItem({
  group,
  index,
  isActive,
  onClick,
  unreviewedCount,
}: {
  group: HunkGroup;
  index: number;
  isActive: boolean;
  onClick: () => void;
  unreviewedCount: number;
}): ReactNode {
  const isCompleted = unreviewedCount === 0;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 w-full px-3 py-1.5 text-xs transition-colors ${
        isActive
          ? "bg-status-modified/10 text-status-modified"
          : isCompleted
            ? "text-fg-faint hover:text-fg-muted hover:bg-surface-raised/30"
            : "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/30"
      }`}
    >
      {isCompleted ? (
        <span className="text-status-approved shrink-0">
          <CheckIcon />
        </span>
      ) : (
        <span className="w-4 text-center text-xxs text-fg-faint shrink-0 tabular-nums">
          {index + 1}
        </span>
      )}
      <span className="truncate flex-1 text-left">{group.title}</span>
      {!isCompleted && unreviewedCount > 0 && (
        <span className="text-xxs text-status-modified/70 tabular-nums shrink-0">
          {unreviewedCount}
        </span>
      )}
    </button>
  );
}

export function GuideNavList(): ReactNode {
  const progress = useReviewProgress();
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
  const summaryStatus = useReviewStore((s) => s.summaryStatus);
  const groupingStatus = useReviewStore((s) => s.groupingStatus);
  const guideSummary = useReviewStore((s) => s.guideSummary);
  const startGuide = useReviewStore((s) => s.startGuide);
  const guideLoading = useReviewStore((s) => s.guideLoading);
  const githubPr = useReviewStore((s) => s.reviewState?.githubPr);

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

  // Auto-advance to the next unreviewed group when current group completes
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

  const hasPrBody = !!githubPr?.body;
  const hasGroups = reviewGroups.length > 0;
  const showStartButton = !hasGroups && !groupingLoading && !groupingError;

  return (
    <div className="flex flex-col h-full">
      {/* Progress bar */}
      <div className="shrink-0">
        <SummaryStats {...progress} />
      </div>

      {/* Navigation items */}
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <nav className="py-1">
          {/* Overview */}
          <button
            type="button"
            onClick={() => setGuideContentMode("overview")}
            className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium transition-colors ${
              guideContentMode === "overview"
                ? "bg-status-modified/10 text-status-modified"
                : "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/50"
            }`}
          >
            {summaryStatus === "loading" && <Spinner />}
            <span className="truncate">Overview</span>
            {summaryStatus !== "loading" && guideSummary && !hasPrBody && (
              <span className="text-status-classifying ml-auto shrink-0">
                <SparkleIcon />
              </span>
            )}
          </button>

          {/* Groups header */}
          {(hasGroups || groupingLoading || groupingError) && (
            <div className="flex items-center gap-2 px-3 py-2 mt-1 border-t border-edge/50">
              <span className="text-xxs font-medium text-fg-muted uppercase tracking-wider flex-1">
                Groups
              </span>
              {groupingStatus === "loading" && <Spinner />}
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

          {/* Group items */}
          {reviewGroups.map((group, i) => (
            <GroupNavItem
              key={group.title}
              group={group}
              index={i}
              isActive={guideContentMode === "group" && activeGroupIndex === i}
              onClick={() => handleGroupClick(i)}
              unreviewedCount={groupUnreviewedCounts.get(group.title) ?? 0}
            />
          ))}

          {/* All done */}
          {hasGroups && totalGroupUnreviewed === 0 && (
            <div className="px-3 py-2 border-t border-edge/50">
              <span className="text-xxs text-status-approved font-medium">
                All groups reviewed
              </span>
            </div>
          )}

          {/* Start guide CTA */}
          {showStartButton && (
            <div className="px-3 py-4">
              <div className="rounded-lg border border-edge-default/60 overflow-hidden bg-surface-panel">
                <div className="flex items-center w-full gap-3 px-3 py-2.5 bg-surface-raised/40">
                  <SparkleIcon />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-medium text-fg-secondary">
                      Start Guided Review
                    </span>
                    <p className="text-xxs text-fg-muted mt-0.5">
                      AI organizes changes into review groups
                    </p>
                  </div>
                </div>
                <div className="px-3 py-2 flex gap-2">
                  <button
                    onClick={startGuide}
                    disabled={guideLoading || hunks.length === 0}
                    className="flex-1 rounded-md bg-status-classifying/15 px-2.5 py-1.5 text-xs font-medium text-status-classifying border border-status-classifying/20 hover:bg-status-classifying/25 transition-colors disabled:opacity-50"
                  >
                    {guideLoading ? "Starting…" : "Start"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </nav>
      </div>
    </div>
  );
}
