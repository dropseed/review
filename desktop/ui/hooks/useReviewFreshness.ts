import { useEffect, useRef } from "react";
import { useReviewStore } from "../stores";

/** Polling interval for freshness checks (60 seconds). */
const POLL_INTERVAL_MS = 60_000;

/**
 * Periodically checks whether each sidebar review still has a non-empty diff.
 *
 * Triggers:
 * - Window focus / visibility change
 * - 60-second background interval
 *
 * Only runs when there are global reviews loaded.
 */
export function useReviewFreshness() {
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const globalReviewsLength = useReviewStore((s) => s.globalReviews.length);
  const checkRef = useRef(checkReviewsFreshness);
  const hasReviewsRef = useRef(globalReviewsLength > 0);

  useEffect(() => {
    checkRef.current = checkReviewsFreshness;
    hasReviewsRef.current = globalReviewsLength > 0;
  }, [checkReviewsFreshness, globalReviewsLength]);

  // Shared guard: only check when reviews exist
  function checkIfReady(): void {
    if (hasReviewsRef.current) {
      checkRef.current();
    }
  }

  // Poll only while visible — each check fans out to git per review.
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (intervalId === null) {
        intervalId = setInterval(checkIfReady, POLL_INTERVAL_MS);
      }
    };
    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        checkIfReady();
        start();
      } else {
        stop();
      }
    };

    window.addEventListener("focus", checkIfReady);
    document.addEventListener("visibilitychange", handleVisibility);
    if (document.visibilityState === "visible") {
      start();
    }

    return () => {
      window.removeEventListener("focus", checkIfReady);
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, []);
}
