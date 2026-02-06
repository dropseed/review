import { useEffect, useRef } from "react";
import { useReviewProgress } from "./useReviewProgress";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { fireCelebrationConfetti } from "../utils/confetti";
import { playCelebrationSound } from "../utils/sounds";

/**
 * Fires a celebration (confetti + sound) on the transition to 100% reviewed.
 * Resets when totalHunks changes (new review = fresh celebration).
 */
export function useCelebration(): void {
  const { reviewedPercent, totalHunks, state } = useReviewProgress();
  const prefersReducedMotion = usePrefersReducedMotion();

  const prevPercentRef = useRef<number | null>(null);
  const hasCelebratedRef = useRef(false);
  const prevTotalRef = useRef(totalHunks);

  useEffect(() => {
    // Reset when switching to a new review
    if (totalHunks !== prevTotalRef.current) {
      hasCelebratedRef.current = false;
      prevPercentRef.current = null;
      prevTotalRef.current = totalHunks;
    }

    const prevPercent = prevPercentRef.current;
    prevPercentRef.current = reviewedPercent;

    // Only fire on the transition to 100% (not on mount if already complete)
    const justCompleted =
      prevPercent !== null &&
      prevPercent < 100 &&
      reviewedPercent === 100 &&
      totalHunks > 0 &&
      state !== null;

    if (justCompleted && !hasCelebratedRef.current) {
      hasCelebratedRef.current = true;
      if (!prefersReducedMotion) {
        fireCelebrationConfetti();
      }
      playCelebrationSound();
    }
  }, [reviewedPercent, totalHunks, state, prefersReducedMotion]);
}
