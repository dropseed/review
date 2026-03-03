import type { ReactNode } from "react";

export function SidebarResizeHandle({
  position,
  onMouseDown,
}: {
  position: "left" | "right";
  onMouseDown: (e: React.MouseEvent) => void;
}): ReactNode {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      onMouseDown={onMouseDown}
      className={`absolute top-0 ${position === "left" ? "left-0" : "right-0"} h-full w-1 cursor-col-resize hover:bg-status-modified/50 active:bg-status-modified`}
    />
  );
}
