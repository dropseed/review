import { useCallback, useEffect } from "react";
import { useReviewStore } from "../stores";
import { usePollWhileVisible } from "./usePollWhileVisible";

/** How often to re-ask GitHub while the window is visible. */
const VIEWER_PR_POLL_MS = 300_000;

/**
 * Keeps the sidebar's open-PR snapshot current.
 *
 * Two reads on mount, in order: the disk cache paints instantly and offline,
 * then a network refresh corrects it a second or two later. Doing only the
 * second would leave the sidebar visibly assembling itself on every launch;
 * doing only the first would show yesterday's PRs forever.
 *
 * After that, `usePollWhileVisible` — this costs a `gh` subprocess and an API
 * call, which is not something to spend on a window nobody is looking at.
 */
export function useViewerPrsSync(): void {
  const loadViewerPrs = useReviewStore((s) => s.loadViewerPrs);
  const refreshViewerPrs = useReviewStore((s) => s.refreshViewerPrs);

  useEffect(() => {
    let cancelled = false;
    void loadViewerPrs().then(() => {
      // The cache read outlives an unmount, and the refresh chained behind it
      // must not fire into a torn-down store.
      if (!cancelled) void refreshViewerPrs();
    });
    return () => {
      cancelled = true;
    };
  }, [loadViewerPrs, refreshViewerPrs]);

  usePollWhileVisible(
    useCallback(() => void refreshViewerPrs(), [refreshViewerPrs]),
    VIEWER_PR_POLL_MS,
  );
}
