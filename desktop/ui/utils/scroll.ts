/**
 * Scroll utilities for navigating virtualized diff views.
 *
 * @pierre/diffs virtualizes lines outside the viewport — off-screen elements
 * have no layout, so scrollIntoView() is a no-op. These helpers implement the
 * standard virtualization scroll-to pattern: compute an approximate offset
 * from line metadata, scroll the container (which triggers the virtualizer to
 * render lines at the new position), then optionally refine with a precise
 * scrollIntoView once the target element has layout.
 */

/** Walk up from an element to find the nearest scrollable ancestor. */
export function findScrollContainer(
  el: HTMLElement | null,
): HTMLElement | null {
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
 * Returns the container that was scrolled, or null if none was found.
 *
 * When `totalLines` is provided, uses proportion-based scrolling that
 * accounts for word wrap: `(lineNumber / totalLines) * scrollHeight`.
 * This is significantly more accurate than fixed line-height math when
 * lines wrap to multiple visual rows.
 */
export function scrollToLinePosition(
  el: HTMLElement | null,
  lineNumber: number,
  lineHeight: number,
  behavior: ScrollBehavior = "smooth",
  totalLines?: number,
): HTMLElement | null {
  const scrollContainer = findScrollContainer(el);
  if (!scrollContainer) return null;

  let approxTop: number;
  if (totalLines && totalLines > 1) {
    // Proportion-based: the virtualizer's scrollHeight already reflects
    // actual rendered heights (including word-wrapped lines), so this
    // naturally handles variable line heights.
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
  return scrollContainer;
}
