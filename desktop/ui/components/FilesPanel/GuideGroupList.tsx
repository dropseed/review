import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../../stores";
import { isHunkReviewed } from "../../types";
import type { DiffHunk } from "../../types";
import { Checkbox } from "../ui/checkbox";
import { Switch } from "../ui/switch";
import { SimpleTooltip } from "../ui/tooltip";

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

/** Ticking elapsed-time display that updates every second. */
function ElapsedTimer(): ReactNode {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  if (elapsed < 1) return null;
  return (
    <span className="text-xxs text-fg-faint tabular-nums ml-1">{elapsed}s</span>
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

/** Shared hook for guide group state. Used by both FilesPanel (for section header) and GuideGroupList (for content). */
export function useGuideGroupState() {
  const guideExpanded = useReviewStore((s) => s.guideExpanded);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const activeEntry = useReviewStore((s) => s.getActiveGroupingEntry());
  const reviewGroups = activeEntry.reviewGroups;
  const groupingLoading = activeEntry.groupingLoading;
  const guideLoading = activeEntry.guideLoading;

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

  return {
    guideActive: guideExpanded,
    totalGroupUnreviewed,
    groupUnreviewedCounts,
    reviewGroups,
    groupingLoading,
    guideLoading,
  };
}

export function GuideGroupList(): ReactNode {
  const {
    totalGroupUnreviewed,
    groupUnreviewedCounts,
    reviewGroups,
    groupingLoading,
  } = useGuideGroupState();

  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const activeEntry = useReviewStore((s) => s.getActiveGroupingEntry());
  const groupingError = activeEntry.groupingError;
  const groupingPartialTitle = activeEntry.groupingPartialTitle;
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
  const cancelGrouping = useReviewStore((s) => s.cancelGrouping);
  const excludeReviewed = useReviewStore((s) => s.excludeReviewedFromGrouping);
  const setExcludeReviewed = useReviewStore(
    (s) => s.setExcludeReviewedFromGrouping,
  );
  const autoStartSeconds = useReviewStore((s) => s.autoStartSecondsRemaining);
  const autoStartGuide = useReviewStore(
    (s) => s.reviewState?.guide?.autoStart ?? false,
  );
  const setAutoStartGuide = useReviewStore((s) => s.setAutoStartGuide);

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

  return (
    <div>
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

      {groupingLoading && !hasGroups && (
        <div className="px-3 py-4 text-center">
          <div className="flex items-center justify-center gap-2 text-fg-muted">
            <Spinner />
            <span className="text-xs">Generating groups…</span>
            <ElapsedTimer />
          </div>
          {groupingPartialTitle && (
            <p className="text-xxs text-fg-faint mt-1.5 truncate px-2">
              {groupingPartialTitle}
            </p>
          )}
          <button
            type="button"
            onClick={cancelGrouping}
            className="mt-2 text-xxs text-fg-faint hover:text-fg-muted transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

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
            const unreviewedCount = groupUnreviewedCounts.get(group.title) ?? 0;
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

      {groupingLoading && hasGroups && (
        <div className="px-3 py-1.5 text-fg-muted">
          <div className="flex items-center gap-2">
            <Spinner />
            <span className="text-xxs flex-1">Loading more groups…</span>
            <button
              type="button"
              onClick={cancelGrouping}
              className="text-xxs text-fg-faint hover:text-fg-muted transition-colors shrink-0"
            >
              Stop
            </button>
          </div>
          {groupingPartialTitle && (
            <p className="text-xxs text-fg-faint truncate mt-0.5 pl-5">
              {groupingPartialTitle}
            </p>
          )}
        </div>
      )}

      {hasGroups && totalGroupUnreviewed === 0 && (
        <div className="px-3 py-2 border-t border-edge/50">
          <span className="text-xxs text-status-approved font-medium">
            All groups reviewed
          </span>
        </div>
      )}

      <div className="border-t border-edge/50 px-3 py-2 space-y-1.5">
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
        <SimpleTooltip content="Auto-start guided review when hunks load">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <Switch
              checked={autoStartGuide}
              onCheckedChange={setAutoStartGuide}
              className="scale-75 origin-left"
            />
            <span className="text-[10px] font-medium text-fg-muted select-none">
              Auto
              {autoStartGuide && autoStartSeconds !== null && (
                <span className="ml-0.5 tabular-nums">
                  {" "}
                  {autoStartSeconds}s
                </span>
              )}
            </span>
          </label>
        </SimpleTooltip>
      </div>
    </div>
  );
}
