import { useCallback } from "react";
import { useReviewStore } from "../stores";
import { usePollWhileVisible } from "./usePollWhileVisible";

/** Polling interval for freshness checks (60 seconds). */
const POLL_INTERVAL_MS = 60_000;

/**
 * Periodically checks whether each sidebar review still has a non-empty diff.
 *
 * Polls while the window is visible and on focus — the diff changes from
 * outside the app, so returning to the window is when a stale answer shows.
 * Only runs when there are global reviews loaded; each check fans out to git
 * once per review.
 */
export function useReviewFreshness() {
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const hasReviews = useReviewStore((s) => s.globalReviews.length > 0);

  usePollWhileVisible(
    useCallback(() => {
      if (hasReviews) checkReviewsFreshness();
    }, [hasReviews, checkReviewsFreshness]),
    POLL_INTERVAL_MS,
    { onFocus: true },
  );
}
