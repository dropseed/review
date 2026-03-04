import { useEffect, useRef } from "react";

const BOTTOM_THRESHOLD = 5; // px

/**
 * Preserves the user's "at bottom" scroll position when `scrollHeight`
 * fluctuates due to CSS custom property updates from the diffs library's
 * ResizeObserver (e.g. `--diffs-column-content-width`).
 *
 * Without this, a brief decrease in `scrollHeight` clamps `scrollTop`,
 * pulling the user away from the bottom even after `scrollHeight` recovers.
 */
export function useScrollBottomPreserver(
  scrollContainer: HTMLDivElement | null,
): void {
  const atBottomRef = useRef(false);

  useEffect(() => {
    if (!scrollContainer) return;

    function isAtBottom(el: HTMLElement): boolean {
      return (
        el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD
      );
    }

    function handleScroll(): void {
      atBottomRef.current = isAtBottom(scrollContainer!);
    }

    // Seed initial value
    atBottomRef.current = isAtBottom(scrollContainer);

    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });

    const ro = new ResizeObserver(() => {
      if (atBottomRef.current) {
        // Re-snap to bottom after layout shift
        scrollContainer!.scrollTop = scrollContainer!.scrollHeight;
      }
    });

    // Observe the scroll container's first child (the content) so we
    // detect when scrollHeight changes without the container itself resizing.
    const content = scrollContainer.firstElementChild;
    if (content) {
      ro.observe(content);
    }
    // Also observe the container itself for viewport-level resizes.
    ro.observe(scrollContainer);

    return () => {
      scrollContainer!.removeEventListener("scroll", handleScroll);
      ro.disconnect();
    };
  }, [scrollContainer]);
}
