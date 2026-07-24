import { type RefObject, useCallback, useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { SplitDirection } from "./pane-tree";

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

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const fraction = isRow
        ? (e.clientX - rect.left) / rect.width
        : (e.clientY - rect.top) / rect.height;
      onResize(Math.max(0, Math.min(1, fraction)));
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
    };
  }, [isRow, containerRef, onResize]);

  return (
    <div
      onMouseDown={handleMouseDown}
      className={clsx(
        "shrink-0 bg-transparent transition-colors hover:bg-focus-ring/30 active:bg-focus-ring/50",
        isRow ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
      )}
    />
  );
}
