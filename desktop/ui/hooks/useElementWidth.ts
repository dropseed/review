import { useEffect, useState } from "react";
import { rafThrottle } from "../utils/resize";

/**
 * The measured width of an element, in px, kept current as it resizes.
 *
 * Both resizable panes need this and for the same reason: a width chosen on a
 * big display is most of a small one, and the honest cap is a share of *the box
 * the panel is in*, not of the window. The window is only the right measure for
 * something on the window's own edge.
 *
 * Takes the node as state (a callback ref) rather than a `RefObject`, so the
 * observer attaches on mount and re-attaches if the element is replaced — the
 * same shape `useResponsiveDiffViewMode` uses. Returns 0 until the first
 * measurement, which callers must read as "not measured yet" rather than "no
 * room".
 */
export function useElementWidth(node: HTMLElement | null): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!node) return;
    const update = rafThrottle(setWidth);
    const observer = new ResizeObserver((entries) => {
      update(entries[0].contentRect.width);
    });
    observer.observe(node);
    setWidth(node.clientWidth);
    return () => {
      observer.disconnect();
      update.cancel();
    };
  }, [node]);

  return width;
}
