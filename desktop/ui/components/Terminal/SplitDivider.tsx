import { type RefObject, useCallback, useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { SplitDirection } from "./pane-tree";
import { rafThrottle, toggleToCanonical } from "../../utils/resize";

interface SplitDividerProps {
  /** The parent split's direction: "row" → vertical bar, "column" → horizontal bar. */
  direction: SplitDirection;
  /** The split's flex container, measured to turn the pointer into a fraction. */
  containerRef: RefObject<HTMLDivElement | null>;
  /** Called with the pointer's fraction (0..1) along the split axis while dragging. */
  onResize: (fraction: number) => void;
}

/**
 * Draggable divider between two panes of a split. Mirrors ContentArea's
 * ResizeHandle drag pattern, but measures a supplied container (the split) and
 * reports a fraction along the split axis so the parent can re-slice the two
 * adjacent panes. xterm refits itself via its ResizeObserver as the flex sizes
 * change, so there's no fit call here.
 */
export function SplitDivider({
  direction,
  containerRef,
  onResize,
}: SplitDividerProps) {
  const isDragging = useRef(false);
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const rememberedRef = useRef<number | null>(null);
  const isRow = direction === "row";

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      isDragging.current = true;
      document.body.style.cursor = isRow ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isRow],
  );

  /**
   * Double-click evens out the two panes this divider separates, and
   * double-clicking again restores the sizes they had — the gesture undoes
   * itself.
   *
   * The pair is measured off the DOM siblings rather than read from the pane
   * tree: the divider is handed one callback that takes a fraction of the whole
   * split, and its own neighbours are the only thing here that knows which two
   * panes that fraction is about to move.
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const container = containerRef.current;
      const divider = dividerRef.current;
      const before = divider?.previousElementSibling;
      const after = divider?.nextElementSibling;
      if (!container || !divider || !before || !after) return;

      const containerRect = container.getBoundingClientRect();
      const span = isRow ? containerRect.width : containerRect.height;
      if (span <= 0) return;

      const origin = isRow ? containerRect.left : containerRect.top;
      const pairStart = isRow
        ? before.getBoundingClientRect().left
        : before.getBoundingClientRect().top;
      const pairEnd = isRow
        ? after.getBoundingClientRect().right
        : after.getBoundingClientRect().bottom;
      const boundary = isRow
        ? divider.getBoundingClientRect().left
        : divider.getBoundingClientRect().top;

      const current = (boundary - origin) / span;
      const even = ((pairStart + pairEnd) / 2 - origin) / span;

      const { next, remember } = toggleToCanonical(
        current,
        even,
        rememberedRef.current,
        even,
        0.005,
      );
      rememberedRef.current = remember;
      onResize(next);
    },
    [containerRef, isRow, onResize],
  );

  useEffect(() => {
    // One update per frame, not one per pointer event: each update re-slices the
    // split, and every terminal in it refits to the new size.
    const commit = rafThrottle(onResize);
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fraction = isRow
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      commit(Math.max(0, Math.min(1, fraction)));
    };
    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      commit.cancel();
    };
  }, [isRow, containerRef, onResize]);

  return (
    <div
      ref={dividerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      title="Drag to resize · double-click to even out"
      className={clsx(
        "group/divider relative shrink-0 bg-transparent",
        isRow ? "w-1.5 cursor-col-resize" : "h-1.5 cursor-row-resize",
      )}
    >
      {/* Panes share one surface, so without a drawn line two terminals sitting
          side by side read as one. The hairline is the seam; the hit area
          around it stays wider than the line so it's still easy to grab. */}
      <span
        className={clsx(
          "pointer-events-none absolute bg-edge-strong transition-colors",
          "group-hover/divider:bg-focus-ring/70 group-active/divider:bg-focus-ring",
          isRow
            ? "inset-y-0 left-1/2 w-px -translate-x-1/2"
            : "inset-x-0 top-1/2 h-px -translate-y-1/2",
        )}
      />
    </div>
  );
}
