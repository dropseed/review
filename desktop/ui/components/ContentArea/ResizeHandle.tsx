import { useCallback, useEffect, useRef } from "react";
import type { SplitOrientation } from "../../stores/slices/navigationSlice";
import { clampFraction, rafThrottle } from "../../utils/resize";

interface ResizeHandleProps {
  orientation: SplitOrientation;
  onResize: (fraction: number) => void;
  /** Double-click action. Owners use it to snap the split even and back again. */
  onReset?: () => void;
}

export function ResizeHandle({
  orientation,
  onResize,
  onReset,
}: ResizeHandleProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const isDragging = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      isDragging.current = true;
      document.body.style.cursor =
        orientation === "horizontal" ? "col-resize" : "row-resize";
      document.body.style.userSelect = "none";
    },
    [orientation],
  );

  useEffect(() => {
    // Coalesced to one update per frame: the panes on either side are diff
    // viewers, and re-rendering them per pointer event (which a fast mouse
    // fires several of per frame) was work no one could ever see.
    const commit = rafThrottle(onResize);

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const parent = containerRef.current.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();

      const fraction =
        orientation === "horizontal"
          ? (e.clientX - rect.left) / rect.width
          : (e.clientY - rect.top) / rect.height;

      commit(clampFraction(fraction));
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
      // Drop any move that hasn't been committed yet. This element is also the
      // double-click target, and a frame left in flight here would land *after*
      // the dblclick handler has evened the split — undoing the reset with the
      // fraction the pointer happened to wobble to.
      commit.cancel();
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      commit.cancel();
    };
  }, [orientation, onResize]);

  const isHorizontal = orientation === "horizontal";

  // Transparent at rest: the panes it separates are already distinct cards with
  // a gutter between them, so a permanent bar only adds a line to look past.
  // The cursor change plus the hover tint carry the affordance on approach.
  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onDoubleClick={onReset}
      title={onReset ? "Drag to resize · double-click to even out" : undefined}
      className={`group flex-shrink-0 bg-transparent transition-colors ${
        isHorizontal
          ? "w-1 cursor-col-resize hover:bg-status-modified/50 active:bg-status-modified"
          : "h-1 cursor-row-resize hover:bg-status-modified/50 active:bg-status-modified"
      }`}
    />
  );
}
