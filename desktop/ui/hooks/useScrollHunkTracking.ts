import { useEffect, useRef } from "react";
import { useReviewStore } from "../stores";
import type { DiffHunk } from "../types";
import { isScrollTrackingSuppressed } from "./scrollState";

/**
 * Toggle `data-scroll-focused` attribute on [data-hunk-id] elements.
 * DOM-only — no React re-render.
 */
function syncDOMFocus(container: HTMLElement, hunkId: string | null): void {
  const prev = container.querySelector("[data-scroll-focused]");
  if (prev) {
    if (prev.getAttribute("data-hunk-id") === hunkId) return;
    prev.removeAttribute("data-scroll-focused");
  }
  if (hunkId) {
    container
      .querySelector(`[data-hunk-id="${CSS.escape(hunkId)}"]`)
      ?.setAttribute("data-scroll-focused", "");
  }
}

/**
 * Tracks which hunk is currently visible during manual scrolling and
 * updates focus accordingly. Uses a two-phase approach:
 *
 * 1. **Visual focus** (immediate, DOM-only): Sets `data-scroll-focused`
 *    attribute on the closest hunk element. Annotation panels use CSS
 *    `data-[scroll-focused]:` variants for visual changes (border, ring,
 *    button visibility). No React re-renders during active scrolling.
 *
 * 2. **Logical focus** (debounced, store): Updates `focusedHunkId` in the
 *    Zustand store after scrolling settles. This triggers React re-renders
 *    for non-visual concerns (ref assignment, tabIndex) but only when the
 *    user has stopped scrolling.
 *
 * A store subscriber also syncs `data-scroll-focused` when focus changes
 * from non-scroll sources (keyboard navigation, minimap click, file open).
 */
export function useScrollHunkTracking(
  scrollContainer: HTMLDivElement | null,
  fileHunks: DiffHunk[],
): void {
  const fileHunksRef = useRef(fileHunks);
  fileHunksRef.current = fileHunks;

  const hasMultipleHunks = fileHunks.length >= 2;

  useEffect(() => {
    if (!scrollContainer || !hasMultipleHunks) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let rafId: number | null = null;
    let storeTimer: ReturnType<typeof setTimeout> | null = null;

    function clearTimers(): void {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
      if (storeTimer !== null) clearTimeout(storeTimer);
    }

    function findClosestHunkElement(): HTMLElement | null {
      const containerRect = scrollContainer!.getBoundingClientRect();
      const targetY = containerRect.top + containerRect.height / 3;
      const hunkElements =
        scrollContainer!.querySelectorAll<HTMLElement>("[data-hunk-id]");
      let closest: HTMLElement | null = null;
      let closestDist = Infinity;
      for (const el of hunkElements) {
        const rect = el.getBoundingClientRect();
        const dist = Math.abs(rect.top - targetY);
        if (dist < closestDist) {
          closestDist = dist;
          closest = el;
        }
      }
      return closest;
    }

    function handleScroll(): void {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);

      debounceTimer = setTimeout(() => {
        rafId = requestAnimationFrame(() => {
          if (isScrollTrackingSuppressed()) return;
          if (fileHunksRef.current.length < 2) return;

          const closest = findClosestHunkElement();
          if (!closest) return;

          const hunkId = closest.getAttribute("data-hunk-id");
          if (!hunkId) return;

          // Validate the hunk belongs to the current file
          if (!fileHunksRef.current.some((h) => h.id === hunkId)) return;

          // Phase 1: Immediate visual update (DOM-only)
          syncDOMFocus(scrollContainer!, hunkId);

          // Phase 2: Debounced store update after scrolling settles
          if (storeTimer !== null) clearTimeout(storeTimer);
          storeTimer = setTimeout(() => {
            const { focusedHunkId } = useReviewStore.getState();
            if (focusedHunkId !== hunkId) {
              useReviewStore.setState({ focusedHunkId: hunkId });
            }
          }, 200);
        });
      }, 100);
    }

    scrollContainer.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    // Sync DOM focus when store changes from non-scroll sources
    const unsubStore = useReviewStore.subscribe((state, prev) => {
      if (state.focusedHunkId !== prev.focusedHunkId && state.focusedHunkId) {
        syncDOMFocus(scrollContainer, state.focusedHunkId);
      }
    });

    // Deferred initial sync so annotation panels have time to mount
    const initialRaf = requestAnimationFrame(() => {
      const { focusedHunkId } = useReviewStore.getState();
      if (focusedHunkId) {
        syncDOMFocus(scrollContainer, focusedHunkId);
      }
    });

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      unsubStore();
      cancelAnimationFrame(initialRaf);
      clearTimers();
      const focused = scrollContainer.querySelector("[data-scroll-focused]");
      if (focused) focused.removeAttribute("data-scroll-focused");
    };
  }, [scrollContainer, hasMultipleHunks]);
}
