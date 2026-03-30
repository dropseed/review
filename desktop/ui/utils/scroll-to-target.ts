/**
 * Unified utility for scrolling to elements inside virtualized shadow DOM views.
 *
 * @pierre/diffs virtualizes lines outside the viewport — off-screen elements
 * have no layout, so scrollIntoView() is a no-op. This utility handles the
 * full lifecycle:
 *
 * 1. Fast path: if the target element already exists, smooth scrollIntoView
 * 2. Instant approximate scroll to get the virtualizer to render the target area
 * 3. Poll for the target element (caller can also call notify() from onPostRender)
 * 4. Smooth scrollIntoView once found
 * 5. Scroll suppression for the entire operation
 */

import { suppressScrollForNav } from "../hooks/scrollState";

// ---------------------------------------------------------------------------
// Low-level scroll helpers (previously in scroll.ts)
// ---------------------------------------------------------------------------

/** Walk up from an element to find the nearest scrollable ancestor. */
function findScrollContainer(el: HTMLElement | null): HTMLElement | null {
  let current = el?.parentElement;
  while (current) {
    const { overflow, overflowY } = getComputedStyle(current);
    if (
      overflow === "auto" ||
      overflow === "scroll" ||
      overflowY === "auto" ||
      overflowY === "scroll"
    ) {
      return current;
    }
    current = current.parentElement;
  }
  return null;
}

/**
 * Scroll a container so that a given line number is approximately centered.
 *
 * When `totalLines` is provided, uses proportion-based scrolling that
 * accounts for word wrap: `(lineNumber / totalLines) * scrollHeight`.
 */
function scrollToLinePosition(
  el: HTMLElement | null,
  lineNumber: number,
  lineHeight: number,
  behavior: ScrollBehavior,
  totalLines?: number,
): void {
  const scrollContainer = findScrollContainer(el);
  if (!scrollContainer) return;

  let approxTop: number;
  if (totalLines && totalLines > 1) {
    const ratio = Math.max(0, (lineNumber - 1) / (totalLines - 1));
    approxTop = ratio * scrollContainer.scrollHeight;
  } else {
    approxTop = (lineNumber - 1) * lineHeight;
  }

  const centerOffset = scrollContainer.clientHeight / 2;
  scrollContainer.scrollTo({
    top: Math.max(0, approxTop - centerOffset),
    behavior,
  });
}

// ---------------------------------------------------------------------------
// scrollToTarget
// ---------------------------------------------------------------------------

export interface ScrollToTargetOptions {
  /** Container element to find the scroll ancestor from */
  container: HTMLElement;
  /** Function that attempts to find the target element. Called repeatedly. */
  findTarget: () => HTMLElement | null;
  /** Approximate line number for initial scroll positioning */
  lineNumber: number;
  /** Line height in px for offset calculation */
  lineHeight: number;
  /** Total lines for proportion-based calculation (more accurate with word wrap) */
  totalLines?: number;
  /** Poll interval in ms (default: 150) */
  pollInterval?: number;
  /** Give up after this many ms (default: 2000) */
  timeout?: number;
}

export interface ScrollHandle {
  /** Hint that new content was rendered (e.g., from onPostRender).
   *  Triggers an immediate check for the target element. */
  notify(): void;
  /** Cancel the scroll operation and clean up timers. */
  cancel(): void;
}

/** Resolved (no-op) handle returned when the fast path succeeds. */
const RESOLVED_HANDLE: ScrollHandle = { notify() {}, cancel() {} };

export function scrollToTarget(options: ScrollToTargetOptions): ScrollHandle {
  const {
    container,
    findTarget,
    lineNumber,
    lineHeight,
    totalLines,
    pollInterval = 150,
    timeout = 2000,
  } = options;

  let cancelled = false;
  let pollId: ReturnType<typeof setInterval> | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  function cleanup(): void {
    cancelled = true;
    if (pollId !== undefined) clearInterval(pollId);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }

  function tryResolve(): boolean {
    if (cancelled) return false;
    const el = findTarget();
    if (el) {
      cleanup();
      suppressScrollForNav();
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return true;
    }
    return false;
  }

  // Suppress tracking/correction for the duration of the operation
  suppressScrollForNav();

  // Fast path: target already in DOM with layout
  if (tryResolve()) return RESOLVED_HANDLE;

  // Phase 1: instant approximate scroll → virtualizer renders target area
  scrollToLinePosition(
    container,
    lineNumber,
    lineHeight,
    "instant",
    totalLines,
  );

  // Phase 2: poll until target appears (or timeout)
  pollId = setInterval(tryResolve, pollInterval);
  timeoutId = setTimeout(cleanup, timeout);

  return {
    notify() {
      tryResolve();
    },
    cancel: cleanup,
  };
}
