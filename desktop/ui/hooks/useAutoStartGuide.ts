import { useEffect, useRef, useState } from "react";
import { useReviewStore } from "../stores";
import { makeReviewKey } from "../stores/slices/groupingSlice";

/**
 * Auto-generates guide groups after hunks stabilize for the configured delay.
 * Kicks off classification + grouping in the background without switching to
 * guide view mode (the sidebar stays closed until the user opens it).
 * Resets the timer whenever hunks change or a load/refresh is in progress.
 * Only fires once per review key per session.
 *
 * Returns `secondsRemaining` (counting down while waiting, null otherwise).
 */
export function useAutoStartGuide(): { secondsRemaining: number | null } {
  const triggeredKeys = useRef(new Set<string>());
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  const autoStart = useReviewStore(
    (s) => s.reviewState?.guide?.autoStart ?? false,
  );
  const hunks = useReviewStore((s) => s.hunks);
  // Coerce to boolean so progress object identity changes don't reset the timer.
  // Including isLoading in deps ensures the timer restarts after loading completes.
  const isLoading = useReviewStore((s) => s.loadingProgress !== null);
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparisonKey = useReviewStore((s) => s.comparison.key);
  const autoStartDelay = useReviewStore((s) => s.autoStartDelay);

  useEffect(() => {
    if (!autoStart) {
      setSecondsRemaining(null);
      return;
    }

    setSecondsRemaining(autoStartDelay);

    const interval = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev !== null && prev > 1) return prev - 1;
        return prev;
      });
    }, 1_000);

    const timer = setTimeout(() => {
      setSecondsRemaining(null);

      const state = useReviewStore.getState();
      const reviewKey = makeReviewKey(
        state.repoPath ?? "",
        state.comparison.key,
      );

      // Already triggered for this review
      if (triggeredKeys.current.has(reviewKey)) {
        console.log("[auto-guide] Already triggered for", reviewKey);
        return;
      }

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
      if (state.isReviewBusy(reviewKey)) {
        console.log("[auto-guide] Skipped: already generating for", reviewKey);
        return;
      }

      console.log("[auto-guide] Auto-starting generation for", reviewKey);
      triggeredKeys.current.add(reviewKey);
      // Only generate groups + classify — don't switch to guide view mode
      state.classifyStaticHunks();
      state.generateGrouping({ silent: true });
    }, autoStartDelay * 1_000);

    console.log(`[auto-guide] Timer reset (${autoStartDelay}s)`);

    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      setSecondsRemaining(null);
    };
  }, [autoStart, hunks, isLoading, repoPath, comparisonKey, autoStartDelay]);

  return { secondsRemaining };
}
