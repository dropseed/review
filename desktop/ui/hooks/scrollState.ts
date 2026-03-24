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

/** Prevents useScrollAnchor from fighting smooth scroll animations. */
const correctionWindow = makeSuppressWindow();
export const suppressScrollCorrection = (ms: number) =>
  correctionWindow.suppress(ms);
export const isScrollCorrectionSuppressed = () =>
  correctionWindow.isSuppressed();

/** Suppress both tracking and correction during a programmatic scroll. */
export function suppressScrollForNav(ms = 600): void {
  suppressScrollTracking(ms);
  suppressScrollCorrection(ms);
}
