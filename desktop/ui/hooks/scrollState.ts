/**
 * Module-level flags to suppress scroll-related behaviors during programmatic
 * scrolls (e.g., scrollIntoView on file open or keyboard navigation).
 *
 * Each flag is a timestamped window: call suppress() to start, isSuppressed()
 * returns true until the window expires. Multiple calls extend the window.
 */

function makeSuppressWindow() {
  let suppressedUntil = 0;
  return {
    suppress(durationMs: number): void {
      const until = Date.now() + durationMs;
      if (until > suppressedUntil) suppressedUntil = until;
    },
    isSuppressed(): boolean {
      return Date.now() < suppressedUntil;
    },
  };
}

/** Prevents useScrollHunkTracking from updating focusedHunkId during smooth scroll. */
const trackingWindow = makeSuppressWindow();
export const suppressScrollTracking = (ms: number) =>
  trackingWindow.suppress(ms);
export const isScrollTrackingSuppressed = () => trackingWindow.isSuppressed();

/** Suppress scroll tracking during a programmatic scroll. */
export function suppressScrollForNav(ms: number): void {
  suppressScrollTracking(ms);
}

/** Suppression window covering a smooth programmatic scroll animation. */
export const NAV_SCROLL_SUPPRESS_MS = 800;
