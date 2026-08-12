import { useCallback, useEffect, useRef } from "react";
import { clsx } from "clsx";
import type { SplitDirection } from "./pane-tree";
import { rafThrottle, toggleToCanonical } from "../../utils/resize";

interface SplitDividerProps {
  /** The parent split's direction: "row" → vertical bar, "column" → horizontal bar. */
  direction: SplitDirection;
  /**
   * `data-pane-slot` of the two panes this divider trades space between. Not
   * always its immediate neighbours: a folded pane may sit in between, holding
   * a fixed bar that neither side can take.
   */
  leftSlot: number;
  rightSlot: number;
  /** Called with the boundary's position within the pair (0..1) while dragging. */
  onResize: (fractionOfPair: number) => void;
}

/** The two panes a drag moves the boundary between, measured along the axis. */
interface PairBounds {
  start: number;
  /** The first pane's size — where the boundary sits right now. */
  first: number;
  /** Where the second pane starts; anything between the two is fixed. */
  secondStart: number;
  /** Both panes' sizes added: the span the boundary moves within. */
  total: number;
}

/**
 * Where a pointer lands within the pair, 0..1 — measured across the two panes
 * only, so whatever sits between them (the divider itself, a folded pane's bar)
 * is space the boundary steps over rather than space it can be dragged into.
 */
function fractionAt(pair: PairBounds, pos: number): number {
  const local =
    pos <= pair.start + pair.first
      ? pos - pair.start
      : pair.first + Math.max(0, pos - pair.secondStart);
  return Math.max(0, Math.min(1, local / pair.total));
}

/**
 * Draggable divider between two panes of a split. Mirrors ContentArea's
 * ResizeHandle drag pattern, but reports where the boundary sits *between its
 * own two neighbours* rather than along the whole split.
 *
 * That pair is the only thing a drag moves, and it's the only thing the divider
 * can measure without being told about the tree — which matters once a split can
 * also hold collapsed panes, whose fixed-width bars make "fraction of the
 * container" and "fraction of the fractions" two different numbers.
 *
 * The pair's outer edges don't move while dragging (the two panes trade space,
 * they don't take any), so they're measured once per gesture instead of once per
 * pointer event — over a document that also holds a streaming terminal, a
 * forced reflow per frame is worth avoiding. xterm refits itself via its
 * ResizeObserver as the flex sizes change, so there's no fit call here.
 */
export function SplitDivider({
  direction,
  leftSlot,
  rightSlot,
  onResize,
}: SplitDividerProps) {
  const dividerRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<PairBounds | null>(null);
  const rememberedRef = useRef<number | null>(null);
  const isRow = direction === "row";

  const measurePair = useCallback((): PairBounds | null => {
    const parent = dividerRef.current?.parentElement;
    if (!parent) return null;
    const slot = (n: number) =>
      Array.from(parent.children).find(
        (el) => el.getAttribute("data-pane-slot") === String(n),
      );
    const before = slot(leftSlot);
    const after = slot(rightSlot);
    if (!before || !after) return null;

    const a = before.getBoundingClientRect();
    const b = after.getBoundingClientRect();
    const first = isRow ? a.width : a.height;
    const second = isRow ? b.width : b.height;
    const total = first + second;
    if (total <= 0) return null;
    return {
      start: isRow ? a.left : a.top,
      first,
      secondStart: isRow ? b.left : b.top,
      total,
    };
  }, [isRow, leftSlot, rightSlot]);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = measurePair();
      if (!dragRef.current) return;
      document.body.style.cursor = isRow ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [isRow, measurePair],
  );

  /**
   * Double-click evens out the two panes this divider separates, and
   * double-clicking again restores the sizes they had — the gesture undoes
   * itself.
   */
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      const pair = measurePair();
      if (!pair) return;

      // The boundary is the first pane's own edge, so "even" is exactly 0.5 —
      // no allowance for the divider's width, which belongs to neither pane.
      const current = pair.first / pair.total;

      const { next, remember } = toggleToCanonical(
        current,
        0.5,
        rememberedRef.current,
        0.5,
        0.005,
      );
      rememberedRef.current = remember;
      onResize(next);
    },
    [measurePair, onResize],
  );

  useEffect(() => {
    // One update per frame, not one per pointer event: each update re-slices the
    // split, and every terminal in it refits to the new size.
    const commit = rafThrottle(onResize);
    const handleMouseMove = (e: MouseEvent) => {
      const pair = dragRef.current;
      if (!pair) return;
      commit(fractionAt(pair, isRow ? e.clientX : e.clientY));
    };
    const handleMouseUp = () => {
      if (!dragRef.current) return;
      dragRef.current = null;
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
  }, [isRow, onResize]);

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
