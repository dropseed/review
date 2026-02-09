import { useEffect, useRef } from "react";
import { useReviewStore } from "../stores";
import type { DiffHunk } from "../types";

/**
 * Tracks which hunk is currently visible during manual scrolling and
 * updates focusedHunkIndex accordingly. Uses a debounce + RAF pattern
 * to avoid DOM queries during fast scrolling.
 *
 * Sets `scrollDrivenNavigation: true` so the DiffView scrollIntoView
 * effect can skip, preventing a feedback loop.
 */
export function useScrollHunkTracking(
  scrollContainer: HTMLDivElement | null,
  fileHunkIndices: number[],
  allHunks: DiffHunk[],
): void {
  // Store latest values in refs so the scroll handler always sees
  // current data without needing to re-attach the listener.
  const fileHunkIndicesRef = useRef(fileHunkIndices);
  fileHunkIndicesRef.current = fileHunkIndices;

  const allHunksRef = useRef(allHunks);
  allHunksRef.current = allHunks;

  const hasMultipleHunks = fileHunkIndices.length >= 2;

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
      const targetX = containerRect.left + containerRect.width / 2;

      let el = document.elementFromPoint(
        targetX,
        targetY,
      ) as HTMLElement | null;
      while (el && el !== scrollContainer) {
        if (el.hasAttribute("data-hunk-id")) return el;
        el = el.parentElement;
      }

      return null;
    }

    function handleScroll(): void {
      cleanup();

      debounceTimer = setTimeout(() => {
        rafId = requestAnimationFrame(() => {
          const indices = fileHunkIndicesRef.current;
          if (indices.length < 2) return;

          const closest = findClosestHunkElement();
          if (!closest) return;

          const hunkId = closest.getAttribute("data-hunk-id");
          if (!hunkId) return;

          const globalIndex = allHunksRef.current.findIndex(
            (h) => h.id === hunkId,
          );
          if (globalIndex === -1) return;

          if (!indices.includes(globalIndex)) return;

          const { focusedHunkIndex } = useReviewStore.getState();
          if (focusedHunkIndex === globalIndex) return;

          useReviewStore.setState({
            focusedHunkIndex: globalIndex,
            scrollDrivenNavigation: true,
          });
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
