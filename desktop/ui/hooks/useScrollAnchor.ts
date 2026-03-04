import { useEffect, useRef } from "react";
import { isScrollCorrectionSuppressed } from "./scrollState";

/**
 * General-purpose scroll anchor hook for WebKit (no overflow-anchor support).
 *
 * Anchors to visible `[data-hunk-id]` elements and corrects scroll position
 * when content changes. Handles:
 * - Component swaps (hunk approval/trust): finds replacement by hunk ID
 * - Full re-renders (file edits, git changes): restores by scroll ratio
 * - Layout shifts (CSS variable updates): drift correction
 * - Sticky bottom: snaps to bottom when user was already there
 */
export function useScrollAnchor(
  scrollContainer: HTMLDivElement | null,
  contentKey: string,
): void {
  const prevKeyRef = useRef(contentKey);
  const resetRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!scrollContainer) return;

    // Anchor state
    let anchorEl: Element | null = null;
    let anchorHunkId: string | null = null;
    let anchorViewY = 0;
    let scrollRatio = 0;
    let atBottom = false;
    let scrolledThisFrame = false;
    let idleFrames = 0;
    let raf = 0;

    function captureAnchor(): void {
      const container = scrollContainer!;
      const maxScroll = container.scrollHeight - container.clientHeight;
      atBottom = maxScroll > 0 && maxScroll - container.scrollTop < 5;
      scrollRatio = maxScroll > 0 ? container.scrollTop / maxScroll : 0;

      const containerRect = container.getBoundingClientRect();
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;

      const hunkEls = container.querySelectorAll("[data-hunk-id]");
      let bestEl: Element | null = null;
      let bestFallback: Element | null = null;

      for (let i = 0; i < hunkEls.length; i++) {
        const el = hunkEls[i];
        const rect = el.getBoundingClientRect();
        const elTop = rect.top - containerRect.top + container.scrollTop;
        const elBottom = elTop + rect.height;

        // Element is at least partially visible
        if (elBottom > viewTop && elTop < viewBottom) {
          bestEl = el;
          break;
        }
        // Track last element above viewport as fallback
        if (elTop <= viewTop) {
          bestFallback = el;
        }
      }

      anchorEl = bestEl ?? bestFallback;
      if (anchorEl) {
        anchorHunkId = anchorEl.getAttribute("data-hunk-id");
        const rect = anchorEl.getBoundingClientRect();
        anchorViewY = rect.top - containerRect.top;
      } else {
        anchorHunkId = null;
      }
    }

    function ensureRunning(): void {
      if (!raf) {
        raf = requestAnimationFrame(onFrame);
      }
    }

    function onFrame(): void {
      raf = 0;
      const container = scrollContainer!;

      // Priority 1: Anchor element was removed from DOM
      if (anchorEl && !container.contains(anchorEl)) {
        // Try to find replacement by hunk ID (component swap from approval/trust)
        const replacement = anchorHunkId
          ? container.querySelector(`[data-hunk-id="${anchorHunkId}"]`)
          : null;

        if (replacement) {
          const rect = replacement.getBoundingClientRect();
          const containerRect = container.getBoundingClientRect();
          const currentViewY = rect.top - containerRect.top;
          const drift = currentViewY - anchorViewY;
          if (Math.abs(drift) > 1) {
            container.scrollTop += drift;
          }
        } else {
          // Full re-render: restore by ratio or snap to bottom
          const maxScroll = container.scrollHeight - container.clientHeight;
          if (atBottom && maxScroll > 0) {
            container.scrollTop = maxScroll;
          } else if (maxScroll > 0) {
            container.scrollTop = scrollRatio * maxScroll;
          }
        }

        captureAnchor();
        scrolledThisFrame = false;
        idleFrames = 0;
        raf = requestAnimationFrame(onFrame);
        return;
      }

      // Priority 2: User or browser scrolled
      if (scrolledThisFrame) {
        captureAnchor();
        scrolledThisFrame = false;
        idleFrames = 0;
        raf = requestAnimationFrame(onFrame);
        return;
      }

      // Priority 3: No scroll event — check for layout-only drift
      if (anchorEl) {
        const rect = anchorEl.getBoundingClientRect();
        const containerRect = container.getBoundingClientRect();
        const currentViewY = rect.top - containerRect.top;
        const drift = currentViewY - anchorViewY;

        if (atBottom) {
          const maxScroll = container.scrollHeight - container.clientHeight;
          if (maxScroll > 0 && container.scrollTop < maxScroll - 1) {
            container.scrollTop = maxScroll;
            idleFrames = 0;
          }
        } else if (Math.abs(drift) > 2 && !isScrollCorrectionSuppressed()) {
          container.scrollTop += drift;
          idleFrames = 0;
        }
      }

      // Stop polling after idle frames to avoid wasting CPU
      idleFrames++;
      if (idleFrames < 10) {
        raf = requestAnimationFrame(onFrame);
      }
    }

    function onScroll(): void {
      scrolledThisFrame = true;
      idleFrames = 0;
      ensureRunning();
    }

    // Expose reset for contentKey changes
    resetRef.current = () => {
      anchorEl = null;
      anchorHunkId = null;
      anchorViewY = 0;
      scrollRatio = 0;
      atBottom = false;
      scrolledThisFrame = false;
      idleFrames = 0;
      captureAnchor();
      ensureRunning();
    };

    // Initial capture and start loop
    captureAnchor();
    raf = requestAnimationFrame(onFrame);
    scrollContainer.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      scrollContainer!.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
      raf = 0;
      anchorEl = null;
      resetRef.current = null;
    };
  }, [scrollContainer]);

  // Reset anchor state when contentKey changes (file switch).
  useEffect(() => {
    if (prevKeyRef.current !== contentKey) {
      prevKeyRef.current = contentKey;
      resetRef.current?.();
    }
  }, [contentKey, scrollContainer]);
}
