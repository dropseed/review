import { useEffect, useState } from "react";
import type { DiffViewMode } from "../stores/slices/preferencesSlice";

/**
 * Width (in rem) below which a split diff renders unified — two ~40-char
 * columns is about where side-by-side stops being readable. Rem rather than
 * px so the cutoff tracks the UI scale the way the panel sizes do.
 */
const SPLIT_MIN_WIDTH_REM = 48;

/**
 * `preferred`, except that "split" degrades to "unified" while `node` is too
 * narrow to show two readable columns. The preference itself is untouched, so
 * a pane that widens again (panel closed, divider dragged) gets split back
 * without the user re-choosing it. Other modes ("old"/"new") pass through.
 *
 * Takes the measured element as state (callback ref) rather than a RefObject
 * so the observer attaches on mount and re-attaches if the element is
 * replaced.
 */
export function useResponsiveDiffViewMode(
  preferred: DiffViewMode,
  node: HTMLElement | null,
): DiffViewMode {
  const [narrow, setNarrow] = useState(false);

  useEffect(() => {
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      // Root font size scales with the UI scale preference, so read it per
      // measurement instead of caching a threshold in px.
      const rem =
        parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setNarrow(entry.contentRect.width < SPLIT_MIN_WIDTH_REM * rem);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [node]);

  return narrow && preferred === "split" ? "unified" : preferred;
}
