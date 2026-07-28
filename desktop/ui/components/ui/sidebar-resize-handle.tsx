import { type ReactNode, useCallback, useRef } from "react";
import { useReviewStore } from "../../stores";
import {
  SIDEBAR_LIMITS,
  clampSidebarWidth,
  rootFontSize,
  toggleToCanonical,
  type SidebarPosition,
} from "../../utils/resize";

export function SidebarResizeHandle({
  position,
  onMouseDown,
}: {
  position: "left" | "right";
  onMouseDown: (e: React.MouseEvent) => void;
}): ReactNode {
  // `position` is which edge of its own panel the handle sits on, so the panel
  // is on the opposite side: the left rail's handle lives on the rail's right
  // edge, and the right files panel's on its left. One panel per side, so that
  // is enough to know which panel's width this handle governs.
  const panel: SidebarPosition = position === "left" ? "right" : "left";
  const limits = SIDEBAR_LIMITS[panel];

  const width = useReviewStore((s) => s[limits.key]);
  const setSidebarWidth = useReviewStore((s) => s.setSidebarWidth);
  const rememberedRef = useRef<number | null>(null);

  // Double-click snaps the panel to its default width, and double-clicking
  // again puts it back where it was — the gesture undoes itself. From the
  // default with nothing to restore it widens as far as this window allows, so
  // the first double-click is never a dud.
  const handleDoubleClick = useCallback(() => {
    const widest = clampSidebarWidth(limits.maxRem, {
      minRem: limits.minRem,
      maxRem: limits.maxRem,
      viewportPx: window.innerWidth,
      rootFontSizePx: rootFontSize(),
    });
    const { next, remember } = toggleToCanonical(
      width,
      limits.defaultRem,
      rememberedRef.current,
      widest,
      0.01,
    );
    rememberedRef.current = remember;
    setSidebarWidth(limits.key, next);
  }, [width, limits, setSidebarWidth]);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      title="Drag to resize · double-click to reset"
      onMouseDown={onMouseDown}
      onDoubleClick={handleDoubleClick}
      className={`absolute top-0 ${position === "left" ? "left-0" : "right-0"} h-full w-1 cursor-col-resize hover:bg-status-modified/50 active:bg-status-modified`}
    />
  );
}
