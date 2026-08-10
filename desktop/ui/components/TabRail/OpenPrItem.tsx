import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useReviewStore } from "../../stores";
import type { ViewerPr } from "../../types";
import { openPrRowRef } from "../../utils/sidebar-tree";
import { RowStatus } from "./RowStatus";
import { SidebarHideMenuItem } from "./SidebarHideMenuItem";
import { ROW_STATUS } from "./row-chrome";

interface OpenPrItemProps {
  pr: ViewerPr;
  repoPath: string;
  onActivate: (pr: ViewerPr) => void;
}

/**
 * A PR of yours that this repo has no local row for.
 *
 * It renders at the listed tier — faint, with the "nothing fetched yet" dot —
 * because that is exactly what it is: Review knows the PR exists and nothing
 * more. Clicking it fetches the head and writes the review, at which point the
 * tree stops synthesizing this row and the real one takes over. Nothing is
 * created before that click, so a sidebar full of these costs nothing on disk.
 */
export const OpenPrItem = memo(function OpenPrItem({
  pr,
  repoPath,
  onActivate,
}: OpenPrItemProps) {
  // Its review identity is the PR's head branch — the ref the review will be
  // keyed by once it exists, so the row highlights the moment it's activated.
  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.ref === pr.headRefName,
  );

  const handleClick = useCallback(() => onActivate(pr), [onActivate, pr]);

  // Context menu, for the one control this row needs: hide. A blocked PR is
  // live at any age by design, so without a way to park it a PR you have
  // decided not to act on sits at the top of the sidebar forever.
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  useEffect(() => {
    if (!showContextMenu) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [showContextMenu]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        className={`group relative w-full text-left px-2.5 py-1 rounded cursor-default
                  transition-colors duration-100
                  ${isActive ? "bg-fg/[0.04]" : "hover:bg-fg/[0.03]"}`}
        aria-current={isActive ? "true" : undefined}
        title={`${pr.repoNameWithOwner} — #${pr.number}: ${pr.title}\n${pr.headRefName} → ${pr.baseRefName}`}
      >
        {isActive && (
          <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-full bg-fg/30" />
        )}
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`text-xs truncate flex-1 min-w-0 ${
              isActive
                ? "text-fg-secondary font-medium"
                : "text-fg-faint/60 group-hover:text-fg-faint"
            }`}
          >
            <span className="tabular-nums">#{pr.number}</span> {pr.title}
          </span>
          <span className={ROW_STATUS}>
            <RowStatus checkoutPath={null} tier="listed" openPr={pr} />
          </span>
        </div>
      </div>

      {showContextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-50 min-w-[160px] rounded-lg border border-edge-default bg-surface-raised/90 backdrop-blur-xl py-1 shadow-xl"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          >
            {/* Hidden by PR number, the key the tree gives this row — hiding it
                by head branch would take every PR on that branch with it. */}
            <SidebarHideMenuItem
              repoPath={repoPath}
              reviewRef={openPrRowRef(pr)}
              onDone={() => setShowContextMenu(false)}
            />
          </div>,
          document.body,
        )}
    </>
  );
});
