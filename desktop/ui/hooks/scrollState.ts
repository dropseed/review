/**
 * Module-level flag to suppress scroll tracking during programmatic scrolls
 * (e.g., scrollIntoView on file open or keyboard navigation).
 *
 * This prevents useScrollHunkTracking from updating focusedHunkId while
 * a smooth scroll animation is in progress, avoiding a feedback loop.
 */

let suppressedUntil = 0;

/** Suppress scroll tracking for the given duration. Extends the window if longer. */
export function suppressScrollTracking(durationMs: number): void {
  const until = Date.now() + durationMs;
  if (until > suppressedUntil) {
    suppressedUntil = until;
  }
}

export function isScrollTrackingSuppressed(): boolean {
  return Date.now() < suppressedUntil;
}
