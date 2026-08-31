import type { ReactNode } from "react";
import { useSpurStore } from "../../stores";
import { useSidebarResize } from "../../hooks/useSidebarResize";
import { SidebarResizeHandle } from "../ui/sidebar-resize-handle";
import { FilesPanel } from "./index";
import { FilesRail } from "./FilesRail";

/**
 * The files panel and the strip it collapses to, as one thing the review screen
 * can place — the shape `TabRail` already has on the other side, where the
 * sidebar owns both of its states and the screen around it knows only that a
 * column goes there.
 *
 * The panel is kept mounted rather than unmounted: it holds which directories
 * you have expanded, and collapsing to make room should not be the thing that
 * forgets them. `content-visibility` is what makes that cheap — React state
 * survives, but a file tree nobody can see skips layout and paint.
 */
export function FilesPanelDock({
  full = false,
  availablePx,
}: {
  full?: boolean;
  availablePx?: number;
} = {}): ReactNode {
  const stored = useSpurStore((s) => s.filesPanelCollapsed);
  // `full` is the phone: the panel *is* the code half there, so it fills it and
  // the persisted collapse has no say — a preference about how to share a row
  // means nothing in a layout with one column. Reading it would let a desktop
  // choice blank the only thing on screen.
  const collapsed = full ? false : stored;
  // Measured against the code half rather than the window: this column shares
  // a row with the diff, not with the screen. See `useSidebarResize`.
  const { sidebarWidth, isResizing, handleResizeStart } = useSidebarResize({
    sidebarPosition: "right",
    availablePx,
  });

  return (
    <>
      {collapsed && !full && <FilesRail />}

      <aside
        className={`relative flex flex-col overflow-hidden
                    ${full ? "min-w-0 flex-1" : "flex-shrink-0"}
                    ${
                      isResizing || full
                        ? ""
                        : "transition-[width,opacity] duration-200 ease-out"
                    }`}
        style={
          full
            ? undefined
            : {
                width: collapsed ? 0 : `${sidebarWidth}rem`,
                // Faded as it narrows, like the sidebar: a right-edge panel
                // that only clips reads as content being cut off rather than
                // put away.
                opacity: collapsed ? 0 : 1,
              }
        }
        aria-hidden={collapsed}
      >
        <div
          className={`flex flex-col flex-1 overflow-hidden bg-surface
                      ${full ? "min-w-0" : "border-l border-edge/60"}`}
          style={
            full
              ? undefined
              : {
                  width: `${sidebarWidth}rem`,
                  contentVisibility: collapsed ? "hidden" : "visible",
                }
          }
        >
          <div className="flex-1 overflow-hidden">
            <FilesPanel />
          </div>

          {!collapsed && !full && (
            <SidebarResizeHandle
              position="left"
              onMouseDown={handleResizeStart}
            />
          )}
        </div>
      </aside>
    </>
  );
}
