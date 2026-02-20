import { useCallback, useEffect, useRef } from "react";
import type { SplitOrientation } from "../../stores/slices/navigationSlice";

interface ResizeHandleProps {
  orientation: SplitOrientation;
  onResize: (fraction: number) => void;
}

export function ResizeHandle({ orientation, onResize }: ResizeHandleProps) {
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
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;

      const parent = containerRef.current.parentElement;
      if (!parent) return;

      const rect = parent.getBoundingClientRect();

      let fraction: number;
      if (orientation === "horizontal") {
        fraction = (e.clientX - rect.left) / rect.width;
      } else {
        fraction = (e.clientY - rect.top) / rect.height;
      }

      // Clamp between 20% and 80%
      fraction = Math.max(0.2, Math.min(0.8, fraction));
      onResize(fraction);
    };

    const handleMouseUp = () => {
      if (isDragging.current) {
        isDragging.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);

    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [orientation, onResize]);

  const isHorizontal = orientation === "horizontal";

  return (
    <div
      ref={containerRef}
      onMouseDown={handleMouseDown}
      className={`group flex-shrink-0 ${
        isHorizontal
          ? "w-1 cursor-col-resize hover:bg-status-modified/50 active:bg-status-modified"
          : "h-1 cursor-row-resize hover:bg-status-modified/50 active:bg-status-modified"
      } bg-surface-raised transition-colors`}
    />
  );
}
