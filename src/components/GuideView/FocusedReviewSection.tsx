import { useEffect, useMemo, useRef } from "react";
import { useReviewStore } from "../../stores";
import { isHunkReviewed } from "../../types";
import type { DiffHunk, HunkGroup, HunkState } from "../../types";
import { useAnimatedCount } from "../../hooks/useAnimatedCount";
import { fireCelebrationConfetti } from "../../utils/confetti";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../ui/dropdown-menu";
import { GroupCard } from "./GroupCard";

// ========================================================================
// Helpers
// ========================================================================

/**
 * Filter a list of hunk IDs down to those that are not yet reviewed.
 */
function getUnreviewedIds(
  ids: string[],
  hunkById: Map<string, DiffHunk>,
  hunkStates: Record<string, HunkState> | undefined,
  trustList: string[],
  autoApproveStaged: boolean,
  stagedFilePaths: Set<string>,
): string[] {
  const result: string[] = [];
  for (const id of ids) {
    const hunk = hunkById.get(id);
    if (
      hunk &&
      !isHunkReviewed(hunkStates?.[id], trustList, {
        autoApproveStaged,
        stagedFilePaths,
        filePath: hunk.filePath,
      })
    ) {
      result.push(id);
    }
  }
  return result;
}

// ========================================================================
// FocusedReviewSection
// ========================================================================

export function FocusedReviewSection() {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const reviewGroups = useReviewStore((s) => s.reviewGroups);
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const identicalHunkIds = useReviewStore((s) => s.identicalHunkIds);
  const groupingLoading = useReviewStore((s) => s.groupingLoading);
  const groupingError = useReviewStore((s) => s.groupingError);
  const generateGrouping = useReviewStore((s) => s.generateGrouping);
  const isGroupingStale = useReviewStore((s) => s.isGroupingStale);
  const setActiveGroupIndex = useReviewStore((s) => s.setActiveGroupIndex);
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const setPendingCommentHunkId = useReviewStore(
    (s) => s.setPendingCommentHunkId,
  );
  const claudeAvailable = useReviewStore((s) => s.claudeAvailable);

  // Build hunk lookup
  const hunkById = useMemo(() => {
    const map = new Map<string, DiffHunk>();
    for (const h of hunks) map.set(h.id, h);
    return map;
  }, [hunks]);

  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;
  const hunkStates = reviewState?.hunks;

  const totalUnreviewed = useMemo(() => {
    let count = 0;
    for (const group of reviewGroups) {
      count += getUnreviewedIds(
        group.hunkIds,
        hunkById,
        hunkStates,
        trustList,
        autoApproveStaged,
        stagedFilePaths,
      ).length;
    }
    return count;
  }, [
    reviewGroups,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);

  const groupUnreviewedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of reviewGroups) {
      counts.set(
        group.title,
        getUnreviewedIds(
          group.hunkIds,
          hunkById,
          hunkStates,
          trustList,
          autoApproveStaged,
          stagedFilePaths,
        ).length,
      );
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

  const groupIdenticalCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of reviewGroups) {
      if (group.hunkIds.length === 0) {
        counts.set(group.title, 0);
        continue;
      }
      const siblings = identicalHunkIds.get(group.hunkIds[0]) ?? [];
      counts.set(
        group.title,
        getUnreviewedIds(
          siblings,
          hunkById,
          hunkStates,
          trustList,
          autoApproveStaged,
          stagedFilePaths,
        ).length,
      );
    }
    return counts;
  }, [
    reviewGroups,
    identicalHunkIds,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);

  const displayCount = useAnimatedCount(totalUnreviewed);

  const totalInGroups = useMemo(
    () => reviewGroups.reduce((sum, g) => sum + g.hunkIds.length, 0),
    [reviewGroups],
  );
  const reviewedInGroups = totalInGroups - totalUnreviewed;
  const percent =
    totalInGroups > 0 ? (reviewedInGroups / totalInGroups) * 100 : 0;

  // Celebrate when all done
  const prevUnreviewed = useRef(totalUnreviewed);
  useEffect(() => {
    const prev = prevUnreviewed.current;
    prevUnreviewed.current = totalUnreviewed;
    if (prev > 0 && totalUnreviewed === 0) {
      fireCelebrationConfetti();
    }
  }, [totalUnreviewed]);

  // Staleness
  const guide = reviewState?.guide;
  const hasGrouping = !!guide && guide.groups.length > 0;
  const stale = hasGrouping ? isGroupingStale() : false;

  const staleReason = useMemo(() => {
    if (!stale || !guide) return "";
    const storedIds = new Set(guide.hunkIds);
    const currentIds = new Set(hunks.map((h) => h.id));
    let added = 0;
    let removed = 0;
    for (const id of currentIds) {
      if (!storedIds.has(id)) added++;
    }
    for (const id of storedIds) {
      if (!currentIds.has(id)) removed++;
    }
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} new`);
    if (removed > 0) parts.push(`${removed} removed`);
    if (parts.length === 0) return "";
    return `${parts.join(", ")} hunk${added + removed === 1 ? "" : "s"} since generated`;
  }, [stale, guide, hunks]);

  // Handlers
  function handleApproveAll(group: HunkGroup): void {
    const ids = getUnreviewedIds(
      group.hunkIds,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    );
    if (ids.length > 0) approveHunkIds(ids);
  }

  function handleRejectAll(group: HunkGroup): void {
    const ids = getUnreviewedIds(
      group.hunkIds,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    );
    if (ids.length > 0) rejectHunkIds(ids);
  }

  function handleUnapproveAll(group: HunkGroup): void {
    unapproveHunkIds(group.hunkIds);
  }

  function handleApproveIdentical(group: HunkGroup): void {
    if (group.hunkIds.length === 0) return;
    const repId = group.hunkIds[0];
    const siblings = identicalHunkIds.get(repId) ?? [];
    const ids = getUnreviewedIds(
      [repId, ...siblings],
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    );
    if (ids.length > 0) approveHunkIds(ids);
  }

  function handleReviewIndividually(group: HunkGroup): void {
    const unreviewedIds = getUnreviewedIds(
      group.hunkIds,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    );
    const targetId = unreviewedIds[0] ?? group.hunkIds[0];
    const hunk = hunkById.get(targetId);
    if (hunk) navigateToBrowse(hunk.filePath);
  }

  function handleCommentHunk(hunkId: string): void {
    const hunk = hunkById.get(hunkId);
    if (hunk) {
      setPendingCommentHunkId(hunkId);
      navigateToBrowse(hunk.filePath);
    }
  }

  // Loading state
  if (groupingLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="flex items-center justify-center">
            <div className="h-8 w-8 rounded-full border-2 border-stone-700 border-t-purple-500 animate-spin" />
          </div>
          <h2 className="text-lg font-semibold text-stone-200">
            Analyzing changes...
          </h2>
          <p className="text-sm text-stone-500">
            Claude is organizing hunks into logical groups for review.
          </p>
        </div>
      </div>
    );
  }

  // Error state
  if (groupingError) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="max-w-md w-full text-center space-y-4">
          <h2 className="text-lg font-semibold text-stone-200">
            Grouping failed
          </h2>
          <p className="text-sm text-red-400">{groupingError}</p>
          <button
            type="button"
            onClick={generateGrouping}
            className="px-4 py-2 text-sm font-medium rounded-md bg-stone-800 text-stone-300
                       hover:bg-stone-700 hover:text-stone-200 transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Empty state — no groups yet
  if (reviewGroups.length === 0) {
    return (
      <div className="rounded-lg border border-stone-700/60 overflow-hidden bg-stone-900">
        <div className="flex items-center w-full gap-3 px-3.5 py-3 bg-stone-800/40">
          <div className="flex items-center justify-center">
            <svg
              className="h-4 w-4 text-purple-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-sm font-medium text-stone-300">
              AI Grouping
            </span>
            <p className="text-xs text-stone-500 mt-0.5">
              Group changes by logical concern for focused review
            </p>
          </div>
          {claudeAvailable !== false && (
            <button
              onClick={generateGrouping}
              className="flex-shrink-0 rounded-md bg-stone-800/80 px-2.5 py-1 text-2xs text-stone-400 inset-ring-1 inset-ring-stone-700/50 hover:bg-stone-700/80 hover:text-stone-300 transition-colors"
            >
              Generate
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Progress header */}
      <div className="rounded-lg border border-stone-800 p-4 text-center">
        <div className="flex items-center justify-center gap-3">
          <span className="text-3xl font-semibold tabular-nums text-amber-400">
            {displayCount}
          </span>
          <span className="text-sm text-stone-500">
            hunks remaining to review
          </span>
        </div>
        <div className="mt-2 h-1.5 bg-stone-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500/50 rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percent}%` }}
          />
        </div>
        {totalInGroups > 0 && (
          <p className="mt-1.5 text-xxs text-stone-600">
            {reviewedInGroups} of {totalInGroups} reviewed
          </p>
        )}
      </div>

      {/* Stale / regenerate */}
      {stale && !groupingLoading && (
        <div className="flex items-center justify-end">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-xxs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors">
                {staleReason || "outdated"}
                <svg
                  className="h-2.5 w-2.5"
                  viewBox="0 0 16 16"
                  fill="currentColor"
                >
                  <path d="M4.427 7.427l3.396 3.396a.25.25 0 00.354 0l3.396-3.396A.25.25 0 0011.396 7H4.604a.25.25 0 00-.177.427z" />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={generateGrouping}>
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                </svg>
                Regenerate
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {/* All done banner */}
      {totalUnreviewed === 0 && reviewGroups.length > 0 && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
          <h3 className="text-sm font-medium text-emerald-300">
            All hunks reviewed!
          </h3>
        </div>
      )}

      {/* Group list */}
      <div className="space-y-2">
        {reviewGroups.map((group, i) => (
          <GroupCard
            key={group.title}
            group={group}
            isActive={i === activeGroupIndex}
            unreviewedCount={groupUnreviewedCounts.get(group.title) ?? 0}
            identicalCount={groupIdenticalCounts.get(group.title) ?? 0}
            hunkById={hunkById}
            hunkStates={reviewState?.hunks}
            onApproveAll={handleApproveAll}
            onRejectAll={handleRejectAll}
            onUnapproveAll={handleUnapproveAll}
            onApproveIdentical={handleApproveIdentical}
            onApproveHunk={(id) => approveHunkIds([id])}
            onRejectHunk={(id) => rejectHunkIds([id])}
            onCommentHunk={handleCommentHunk}
            onReviewIndividually={handleReviewIndividually}
            onActivate={() => setActiveGroupIndex(i)}
          />
        ))}
      </div>
    </div>
  );
}

/** Returns the total unreviewed count across all groups, for section completion */
export function useFocusedReviewUnreviewed(): number {
  const reviewGroups = useReviewStore((s) => s.reviewGroups);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);

  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;
  const hunkStates = reviewState?.hunks;

  const hunkById = useMemo(() => {
    const map = new Map<string, DiffHunk>();
    for (const h of hunks) map.set(h.id, h);
    return map;
  }, [hunks]);

  return useMemo(() => {
    let count = 0;
    for (const group of reviewGroups) {
      count += getUnreviewedIds(
        group.hunkIds,
        hunkById,
        hunkStates,
        trustList,
        autoApproveStaged,
        stagedFilePaths,
      ).length;
    }
    return count;
  }, [
    reviewGroups,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);
}
