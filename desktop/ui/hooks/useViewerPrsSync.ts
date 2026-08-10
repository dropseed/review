import { useEffect } from "react";
import { useReviewStore } from "../stores";

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
 * After that, one interval while the window is visible — the same shape as the
 * activity poll in `AppShell`, and for the same reason: this costs a `gh`
 * subprocess and an API call, which is not something to spend on a window
 * nobody is looking at. Coming back to a hidden window refreshes immediately
 * rather than waiting out the remainder of an interval that wasn't running.
 */
export function useViewerPrsSync(): void {
  const loadViewerPrs = useReviewStore((s) => s.loadViewerPrs);
  const refreshViewerPrs = useReviewStore((s) => s.refreshViewerPrs);

  useEffect(() => {
    let cancelled = false;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const refresh = (): void => {
      if (!cancelled) void refreshViewerPrs();
    };

    void loadViewerPrs().then(() => {
      if (!cancelled) refresh();
    });

    const start = (): void => {
      if (intervalId === null) {
        intervalId = setInterval(refresh, VIEWER_PR_POLL_MS);
      }
    };
    const stop = (): void => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        refresh();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [loadViewerPrs, refreshViewerPrs]);
}
