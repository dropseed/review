import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
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
export function FilesPanelDock(): ReactNode {
  const collapsed = useReviewStore((s) => s.filesPanelCollapsed);
  const { sidebarWidth, isResizing, handleResizeStart } = useSidebarResize({
    sidebarPosition: "right",
  });

  return (
    <>
      {collapsed && <FilesRail />}

      <aside
        className={`relative flex flex-shrink-0 flex-col overflow-hidden
                    ${
                      isResizing
                        ? ""
                        : "transition-[width,opacity] duration-200 ease-out"
                    }`}
        style={{
          width: collapsed ? 0 : `${sidebarWidth}rem`,
          // Faded as it narrows, like the sidebar: a right-edge panel that only
          // clips reads as content being cut off rather than put away.
          opacity: collapsed ? 0 : 1,
        }}
        aria-hidden={collapsed}
      >
        <div
          className="flex flex-col flex-1 overflow-hidden border-l border-edge/60 bg-surface"
          style={{
            width: `${sidebarWidth}rem`,
            contentVisibility: collapsed ? "hidden" : "visible",
          }}
        >
          <div className="flex-1 overflow-hidden">
            <FilesPanel />
          </div>

          {!collapsed && (
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
