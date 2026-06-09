/**
 * Unified utility for scrolling to elements inside virtualized shadow DOM views.
 *
 * @pierre/diffs virtualizes lines outside the viewport — off-screen elements
 * have no layout, so scrollIntoView() is a no-op. Worse, the virtualizer's
 * scrollHeight is an *estimate* that settles asynchronously after mount
 * (line heights and annotation panels are measured lazily as regions render).
 * This utility handles the full lifecycle:
 *
 * 1. Fast path: if the target element already exists, smooth scrollIntoView
 * 2. Instant approximate scroll so the virtualizer renders the target area
 * 3. Poll for the target element, re-running the approximate scroll whenever
 *    the container's scrollHeight changes materially (height settling)
 * 4. Smooth scrollIntoView once found, with a one-shot settle correction
 *    afterwards in case content above the target shifted during the animation
 * 5. Scroll tracking/correction suppression held for the entire operation
 * 6. Cancelled immediately if the user starts scrolling themselves
 */

import { suppressScrollForNav } from "../hooks/scrollState";

/**
 * Find a line element inside a @pierre/diffs shadow DOM rendered somewhere
 * under `root`. Prefers the non-removed side so unified/split views land on
 * the "new" line when both sides carry the same number.
 */
export function findLineInShadowDOM(
  root: HTMLElement,
  lineNumber: number,
): HTMLElement | null {
  const shadow = root.querySelector("diffs-container")?.shadowRoot;
  if (!shadow) return null;
  return (
    (shadow.querySelector(
      `[data-line="${lineNumber}"]:not([data-line-type="removed"])`,
    ) as HTMLElement | null) ??
    (shadow.querySelector(`[data-line="${lineNumber}"]`) as HTMLElement | null)
  );
}

export interface ScrollToTargetOptions {
  /** The scrollable container (overflow: auto/scroll) that owns the content */
  scrollContainer: HTMLElement;
  /** Function that attempts to find the target element. Called repeatedly. */
  findTarget: () => HTMLElement | null;
  /** Approximate line number for initial scroll positioning */
  lineNumber: number;
  /** Line height in px for offset calculation */
  lineHeight: number;
  /** Total lines for proportion-based calculation (more accurate with word wrap) */
  totalLines?: number;
  /** Poll interval in ms (default: 100) */
  pollInterval?: number;
  /** Give up after this many ms (default: 3000) */
  timeout?: number;
  /** Identifier included in the timeout warning for debuggability */
  debugLabel?: string;
}

export interface ScrollHandle {
  /** Cancel the scroll operation and clean up timers. */
  cancel(): void;
}

/** Resolved (no-op) handle returned when the fast path succeeds. */
const RESOLVED_HANDLE: ScrollHandle = { cancel() {} };

/** Suppression window refreshed on every poll tick while an op is active. */
const TICK_SUPPRESS_MS = 400;
/** Suppression window covering a smooth programmatic scroll animation. */
export const NAV_SCROLL_SUPPRESS_MS = 800;
/** How long to wait after the smooth scroll before verifying the landing. */
const SETTLE_CHECK_MS = 450;
/** Re-correct after settle only if the target drifted further than this. */
const SETTLE_TOLERANCE_PX = 40;

export function scrollToTarget(options: ScrollToTargetOptions): ScrollHandle {
  const {
    scrollContainer,
    findTarget,
    lineNumber,
    lineHeight,
    totalLines,
    pollInterval = 100,
    timeout = 3000,
    debugLabel,
  } = options;

  let cancelled = false;
  let resolved = false;
  let pollId: ReturnType<typeof setInterval> | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let settleId: ReturnType<typeof setTimeout> | undefined;
  // scrollHeight at the time of the last approximate scroll — when the
  // virtualizer's height estimate settles, we re-anchor.
  let anchoredScrollHeight = 0;

  function teardown(): void {
    cancelled = true;
    if (pollId !== undefined) clearInterval(pollId);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (settleId !== undefined) clearTimeout(settleId);
    scrollContainer.removeEventListener("wheel", onUserScrollIntent);
    scrollContainer.removeEventListener("touchmove", onUserScrollIntent);
  }

  // User started scrolling themselves — get out of the way entirely,
  // including any pending settle correction.
  function onUserScrollIntent(): void {
    teardown();
  }

  function approximateScroll(): void {
    const scrollHeight = scrollContainer.scrollHeight;
    let approxTop: number;
    if (totalLines && totalLines > 1) {
      const ratio = Math.min(
        1,
        Math.max(0, (lineNumber - 1) / (totalLines - 1)),
      );
      approxTop = ratio * scrollHeight;
    } else {
      approxTop = (lineNumber - 1) * lineHeight;
    }
    anchoredScrollHeight = scrollHeight;
    scrollContainer.scrollTo({
      top: Math.max(0, approxTop - scrollContainer.clientHeight / 2),
      behavior: "instant",
    });
  }

  function finish(el: HTMLElement): void {
    resolved = true;
    if (pollId !== undefined) clearInterval(pollId);
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    suppressScrollForNav(NAV_SCROLL_SUPPRESS_MS);
    el.scrollIntoView({ behavior: "smooth", block: "center" });

    // Content above the target can keep settling (annotation panels and
    // line heights measure in lazily) and shift the target mid-animation.
    // After the smooth scroll has had time to land, verify and correct.
    settleId = setTimeout(() => {
      if (cancelled || !el.isConnected) {
        teardown();
        return;
      }
      const rect = el.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      const center = containerRect.top + containerRect.height / 2;
      const elCenter = rect.top + rect.height / 2;
      // Tall targets that fill the viewport are "in view" even off-center.
      const fillsViewport = rect.height >= containerRect.height * 0.8;
      if (!fillsViewport && Math.abs(elCenter - center) > SETTLE_TOLERANCE_PX) {
        suppressScrollForNav(NAV_SCROLL_SUPPRESS_MS);
        el.scrollIntoView({ behavior: "instant", block: "center" });
      }
      teardown();
    }, SETTLE_CHECK_MS);
  }

  function tick(): void {
    if (cancelled || resolved) return;
    suppressScrollForNav(TICK_SUPPRESS_MS);

    const el = findTarget();
    if (el && el.isConnected && el.getBoundingClientRect().height > 0) {
      finish(el);
      return;
    }

    // Height estimate settled since our last approximate scroll — our
    // proportional position is now wrong, so re-anchor.
    const scrollHeight = scrollContainer.scrollHeight;
    const drift = Math.abs(scrollHeight - anchoredScrollHeight);
    if (drift > Math.max(lineHeight * 4, scrollHeight * 0.02)) {
      approximateScroll();
    }
  }

  // Suppress tracking/correction for the duration of the operation
  suppressScrollForNav(TICK_SUPPRESS_MS);

  // Fast path: target already in DOM with layout
  {
    const el = findTarget();
    if (el && el.isConnected && el.getBoundingClientRect().height > 0) {
      suppressScrollForNav(NAV_SCROLL_SUPPRESS_MS);
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      return RESOLVED_HANDLE;
    }
  }

  // Phase 1: instant approximate scroll → virtualizer renders target area
  approximateScroll();

  // Phase 2: poll until target appears (or timeout)
  scrollContainer.addEventListener("wheel", onUserScrollIntent, {
    passive: true,
  });
  scrollContainer.addEventListener("touchmove", onUserScrollIntent, {
    passive: true,
  });
  pollId = setInterval(tick, pollInterval);
  timeoutId = setTimeout(() => {
    if (!resolved) {
      console.warn(
        `[scrollToTarget] gave up waiting for target${debugLabel ? ` (${debugLabel})` : ""}`,
        { lineNumber, totalLines, scrollHeight: scrollContainer.scrollHeight },
      );
    }
    teardown();
  }, timeout);

  return { cancel: teardown };
}
