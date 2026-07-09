import { type ReactNode, useCallback, useEffect, useMemo, useRef } from "react";
import { useReviewStore } from "../../stores";
import { useAllHunks } from "../../stores/selectors/hunks";
import {
  countGroupUnreviewed,
  type Group,
} from "../../stores/selectors/groups";
import { SparkleIcon } from "../ui/icons";
import { jumpToGroup } from "./jumpToGroup";
import { useGuideGroups } from "./useGuideGroups";

const BACK_ICON = (
  <svg
    className="h-3 w-3 shrink-0"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="m15 6-6 6 6 6" />
  </svg>
);

const CHECK_ICON = (
  <svg
    className="w-3.5 h-3.5"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={3}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const UNGROUPED_ICON = (
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
);

function formatStalenessMessage(added: number, removed: number): string {
  if (added > 0 && removed > 0) {
    return `+${added} / -${removed} hunks since the guide was built`;
  }
  if (added > 0) {
    return `+${added} new ${added === 1 ? "hunk" : "hunks"} since the guide was built`;
  }
  return `-${removed} ${removed === 1 ? "hunk" : "hunks"} since the guide was built`;
}

function itemStyle(
  isPlaceholder: boolean,
  isActive: boolean,
  isCompleted: boolean,
): string {
  const borderStyle = isPlaceholder ? "border-l-2 border-dashed" : "border-l-2";
  if (isActive) {
    return isPlaceholder
      ? `bg-fg/[0.06] text-fg-secondary ${borderStyle} border-fg-faint`
      : `bg-guide/15 text-guide ${borderStyle} border-guide`;
  }
  if (isCompleted)
    return `text-fg-faint hover:text-fg-muted hover:bg-surface-raised/30 ${borderStyle} border-transparent`;
  return `text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/30 ${borderStyle} border-transparent`;
}

function GuideModeHeader({ onBack }: { onBack: () => void }): ReactNode {
  return (
    <div className="flex items-center gap-2 border-b border-edge-default/40 px-2 py-1.5">
      <button
        type="button"
        onClick={onBack}
        className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-fg-muted transition-colors hover:bg-surface-raised/40 hover:text-fg-secondary"
      >
        {BACK_ICON}
        Back
      </button>
      <div className="flex items-center gap-1.5 text-xs font-medium text-guide">
        <SparkleIcon />
        Review guide
      </div>
    </div>
  );
}

/**
 * Dedicated sidebar mode for an agent-authored guide, swapped in for the
 * normal commit-oriented Review-tab sidebar when the user clicks
 * {@link GuideBanner}. Shows only a back button and the guide's ordered
 * sections (number, title, unreviewed count, completion check) — no commit
 * picker, no status sections. Clicking a section routes through
 * {@link jumpToGroup} (scope + focus the first unreviewed hunk in it), and
 * a completed section auto-advances into the next unreviewed one after a
 * brief delay so the reviewer doesn't have to click through manually.
 */
export function GuideModePanel(): ReactNode {
  const setGuideMode = useReviewStore((s) => s.setGuideMode);
  const reviewState = useReviewStore((s) => s.reviewState);
  const activeGroupKey = useReviewStore((s) =>
    s.guideContentMode === "group"
      ? (s.getActiveGroupingEntry().reviewGroups[s.activeGroupIndex]?.title ??
        null)
      : null,
  );
  const getGroupingStaleness = useReviewStore((s) => s.getGroupingStaleness);
  const hunks = useAllHunks();
  const groups = useGuideGroups();

  const staleness = useMemo(
    () => getGroupingStaleness(),
    [getGroupingStaleness, hunks, reviewState?.guide?.state],
  );

  const unreviewedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const g of groups)
      counts.set(g.key, countGroupUnreviewed(g, reviewState));
    return counts;
  }, [groups, reviewState]);

  const totalUnreviewed = useMemo(() => {
    let n = 0;
    for (const c of unreviewedCounts.values()) n += c;
    return n;
  }, [unreviewedCounts]);

  // Suppress auto-advance immediately after the user clicks a section, so
  // their explicit selection isn't overridden by the effect below.
  const userNavigatedRef = useRef(false);

  // Auto-advance to the next unreviewed section when the current one completes.
  useEffect(() => {
    if (userNavigatedRef.current) {
      userNavigatedRef.current = false;
      return;
    }
    if (activeGroupKey === null || groups.length === 0) return;
    const currentIndex = groups.findIndex((g) => g.key === activeGroupKey);
    if (currentIndex === -1) return;
    if ((unreviewedCounts.get(groups[currentIndex].key) ?? 0) > 0) return;
    const nextGroup = groups.find(
      (g, i) => i > currentIndex && (unreviewedCounts.get(g.key) ?? 0) > 0,
    );
    if (nextGroup) {
      const timer = setTimeout(() => jumpToGroup(nextGroup), 300);
      return () => clearTimeout(timer);
    }
  }, [unreviewedCounts, activeGroupKey, groups]);

  const handleGroupClick = useCallback(
    (group: Group) => {
      // Only suppress the immediate auto-advance when re-opening an already
      // finished section; clicking an unreviewed section needs no guard, and
      // setting it there could strand a stale `true` that eats a later advance.
      userNavigatedRef.current = (unreviewedCounts.get(group.key) ?? 0) === 0;
      jumpToGroup(group);
    },
    [unreviewedCounts],
  );

  const handleBack = useCallback(() => setGuideMode(false), [setGuideMode]);

  if (groups.length === 0) {
    return (
      <div className="flex flex-col flex-1 min-h-0">
        <GuideModeHeader onBack={handleBack} />
        <div className="flex flex-1 items-center justify-center px-3 py-6 text-center">
          <p className="text-xs text-fg-muted">No guide sections available.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <GuideModeHeader onBack={handleBack} />
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {staleness.stale && (
          <div className="px-3 pt-1.5 pb-1">
            <span className="text-xxs text-fg-faint">
              {formatStalenessMessage(staleness.added, staleness.removed)}
            </span>
          </div>
        )}

        {groups.map((group, i) => {
          const unreviewedCount = unreviewedCounts.get(group.key) ?? 0;
          const isCompleted = unreviewedCount === 0;
          const isActive =
            activeGroupKey !== null && group.key === activeGroupKey;
          return (
            <button
              key={group.key}
              type="button"
              onClick={() => handleGroupClick(group)}
              className={`flex items-start gap-2 w-full pl-2.5 pr-3 py-2 text-xs transition-colors ${itemStyle(
                !!group.isPlaceholder,
                isActive,
                isCompleted,
              )}`}
            >
              {isCompleted ? (
                <span className="text-status-approved shrink-0 mt-0.5">
                  {CHECK_ICON}
                </span>
              ) : group.isPlaceholder ? (
                <span className="w-4 text-center shrink-0 mt-px">
                  {UNGROUPED_ICON}
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
                    group.isPlaceholder
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

        {totalUnreviewed === 0 && (
          <div className="px-3 py-2 border-t border-edge/50">
            <span className="text-xxs text-status-approved font-medium">
              All groups reviewed
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
