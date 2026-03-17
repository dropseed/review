import { useEffect } from "react";
import { useReviewStore } from "../stores";
import { makeReviewKey } from "../stores/slices/groupingSlice";

/**
 * Auto-generates guide groups after hunks stabilize for the configured delay.
 * Kicks off classification + grouping in the background without switching to
 * guide view mode (the sidebar stays closed until the user opens it).
 * Resets the timer whenever hunks change or a load/refresh is in progress.
 *
 * When groups already exist but are stale (hunks changed), starts a countdown
 * to regenerate them automatically.
 *
 * Writes `autoStartSecondsRemaining` to the store so both the header and
 * GuideSideNav can display the countdown.
 */
export function useAutoStartGuide(): void {
  const autoStart = useReviewStore(
    (s) => s.reviewState?.guide?.autoStart ?? false,
  );
  const hunks = useReviewStore((s) => s.hunks);
  // Coerce to boolean so progress object identity changes don't reset the timer.
  // Including isLoading in deps ensures the timer restarts after loading completes.
  const isLoading = useReviewStore((s) => s.loadingProgress !== null);
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparisonKey = useReviewStore((s) => s.comparison?.key);
  const autoStartDelay = useReviewStore((s) => s.autoStartDelay);
  // Derive staleness from primitive fields so the selector doesn't run O(n) set
  // comparisons on every unrelated store update (e.g. countdown ticks).
  const isGroupingStale = useReviewStore((s) => {
    const generated = s.reviewState?.guide?.state;
    if (!generated) return false;
    const storedIds = generated.hunkIds;
    const currentIds = s.hunks;
    if (storedIds.length !== currentIds.length) return true;
    const storedSet = new Set(storedIds);
    return currentIds.some((h) => !storedSet.has(h.id));
  });

  useEffect(() => {
    const setSeconds = useReviewStore.getState().setAutoStartSecondsRemaining;

    if (!autoStart) {
      setSeconds(null);
      return;
    }

    setSeconds(autoStartDelay);

    const interval = setInterval(() => {
      const current = useReviewStore.getState().autoStartSecondsRemaining;
      if (current !== null && current > 1) {
        setSeconds(current - 1);
      }
    }, 1_000);

    const timer = setTimeout(() => {
      setSeconds(null);

      const state = useReviewStore.getState();

      // Still loading
      if (state.loadingProgress !== null) {
        console.log("[auto-guide] Skipped: still loading");
        return;
      }

      // No repo or review state
      if (!state.repoPath || !state.reviewState) {
        console.log("[auto-guide] Skipped: no repo or review state");
        return;
      }

      // Count unreviewed hunks
      const hunkStates = state.reviewState.hunks;
      const unreviewedCount = state.hunks.filter((h) => {
        const hs = hunkStates[h.id];
        return hs?.status !== "approved" && hs?.status !== "rejected";
      }).length;

      if (unreviewedCount < 4) {
        console.log(
          "[auto-guide] Skipped: only",
          unreviewedCount,
          "unreviewed hunks",
        );
        return;
      }

      // Already generating
      const reviewKey = makeReviewKey(state.repoPath, state.comparison!.key);
      if (state.isReviewBusy(reviewKey)) {
        console.log("[auto-guide] Skipped: already generating for", reviewKey);
        return;
      }

      const hasGroups = state.getActiveGroupingEntry().reviewGroups.length > 0;
      const stale = state.isGroupingStale();

      if (hasGroups && stale) {
        // Groups exist but are stale — regenerate (non-silent so the user knows)
        console.log(
          "[auto-guide] Auto-regenerating stale groups for",
          reviewKey,
        );
        state.generateGrouping();
      } else if (hasGroups && !stale) {
        // Groups exist and are fresh — nothing to do
        console.log("[auto-guide] Skipped: groups exist and are fresh");
      } else if (state.changesViewMode === "guide") {
        // Guide already active with no groups — skip (startGuide handles this)
        console.log("[auto-guide] Skipped: guide already active");
      } else {
        // No groups yet — first-time auto-start
        console.log("[auto-guide] Auto-starting generation for", reviewKey);
        state.classifyStaticHunks();
        state.generateGrouping({ silent: true });
      }
    }, autoStartDelay * 1_000);

    console.log(`[auto-guide] Timer reset (${autoStartDelay}s)`);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      setSeconds(null);
    };
  }, [
    autoStart,
    hunks,
    isLoading,
    repoPath,
    comparisonKey,
    autoStartDelay,
    isGroupingStale,
  ]);
}
