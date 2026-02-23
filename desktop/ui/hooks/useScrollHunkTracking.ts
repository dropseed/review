import { useEffect, useRef } from "react";
import { useReviewStore } from "../stores";
import type { DiffHunk } from "../types";

/**
 * Tracks which hunk is currently visible during manual scrolling and
 * updates focusedHunkId accordingly. Uses a debounce + RAF pattern
 * to avoid DOM queries during fast scrolling.
 *
 * Only sets `focusedHunkId` — never sets `scrollTarget`, so programmatic
 * scroll in DiffView cannot create a feedback loop.
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

    function cleanup(): void {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      if (rafId !== null) cancelAnimationFrame(rafId);
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
      cleanup();

      debounceTimer = setTimeout(() => {
        rafId = requestAnimationFrame(() => {
          if (fileHunksRef.current.length < 2) return;

          const closest = findClosestHunkElement();
          if (!closest) return;

          const hunkId = closest.getAttribute("data-hunk-id");
          if (!hunkId) return;

          // Validate the hunk belongs to the current file
          if (!fileHunksRef.current.some((h) => h.id === hunkId)) return;

          const { focusedHunkId } = useReviewStore.getState();
          if (focusedHunkId === hunkId) return;

          useReviewStore.setState({ focusedHunkId: hunkId });
        });
      }, 150);
    }

    scrollContainer.addEventListener("scroll", handleScroll, {
      passive: true,
    });

    return () => {
      scrollContainer.removeEventListener("scroll", handleScroll);
      cleanup();
    };
  }, [scrollContainer, hasMultipleHunks]);
}
