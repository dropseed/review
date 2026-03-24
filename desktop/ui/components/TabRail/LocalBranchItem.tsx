import { memo, useCallback, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { useReviewStore } from "../../stores";
import type { Comparison, LocalBranchInfo } from "../../types";
import { makeComparison } from "../../types";
import type { SidebarItemKind } from "../../utils/sidebar-ordering";
import { XIcon } from "../ui/icons";
import { Spinner } from "../ui/spinner";
import { useAsyncAction } from "../../hooks/useAsyncAction";
import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";
import { ChangeBaseMenu } from "./ChangeBaseMenu";

interface LocalBranchItemProps {
  branch: LocalBranchInfo;
  repoPath: string;
  repoName?: string;
  defaultBranch: string;
  itemKind: SidebarItemKind;
  onActivate: (repoPath: string, branch: string, defaultBranch: string) => void;
}

export const LocalBranchItem = memo(function LocalBranchItem({
  branch,
  repoPath,
  repoName,
  defaultBranch,
  itemKind,
  onActivate,
}: LocalBranchItemProps) {
  const comparison: Comparison = makeComparison(defaultBranch, branch.name);
  const comparisonKey = comparison.key;

  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.comparisonKey === comparisonKey,
  );

  // Show stale badge only for the active worktree review
  const isWorktreeStale = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.comparisonKey === comparisonKey &&
      s.worktreeStale,
  );

  // Context menu state
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showChangeBase, setShowChangeBase] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
    setShowChangeBase(false);
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setShowContextMenu(false);
        setShowChangeBase(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showContextMenu]);

  const handleClick = useCallback(() => {
    onActivate(repoPath, branch.name, defaultBranch);
  }, [onActivate, repoPath, branch.name, defaultBranch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const removeWorktreeAction = useCallback(async () => {
    if (!branch.worktreePath) return;

    const client = getApiClient();
    const { dialogs } = getPlatformServices();

    try {
      const hasChanges = await client.hasWorktreeChanges(
        repoPath,
        branch.worktreePath,
      );
      if (hasChanges) {
        const confirmed = await dialogs.confirm(
          `The worktree for "${branch.name}" has uncommitted changes. Remove it anyway?`,
        );
        if (!confirmed) return;
      }
    } catch {
      const confirmed = await dialogs.confirm(
        `Remove the worktree for "${branch.name}"?`,
      );
      if (!confirmed) return;
    }

    await client.removeReviewWorktree(repoPath, branch.worktreePath);

    const state = useReviewStore.getState();
    if (
      state.reviewState &&
      state.activeReviewKey?.repoPath === repoPath &&
      state.activeReviewKey?.comparisonKey === comparisonKey
    ) {
      const updatedState = { ...state.reviewState, worktreePath: undefined };
      state.setReviewState(updatedState);
      await state.saveReviewState();
    }

    await Promise.all([state.loadLocalActivity(), state.loadGlobalReviews()]);
  }, [branch.worktreePath, branch.name, repoPath, comparisonKey]);
  const [handleRemoveWorktreeClick, removing] = useAsyncAction(
    removeWorktreeAction,
    "remove worktree",
  );

  const handleRemoveWorktree = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      handleRemoveWorktreeClick();
    },
    [handleRemoveWorktreeClick],
  );

  const isCheckedOut = itemKind === "working-tree" || itemKind === "worktree";
  const nameClass = isActive
    ? "text-fg-secondary font-medium"
    : itemKind === "working-tree"
      ? "text-fg-muted font-medium"
      : itemKind === "worktree"
        ? "text-fg-muted/80 group-hover:text-fg-muted"
        : "text-fg-faint/60 group-hover:text-fg-faint";

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        className={`group relative w-full text-left pl-4 pr-2.5 py-1 rounded cursor-default
                    transition-colors duration-100
                    ${isActive ? "bg-fg/[0.04]" : "hover:bg-fg/[0.03]"}`}
        aria-current={isActive ? "true" : undefined}
        title={`${branch.name}${branch.worktreePath ? ` (worktree: ${branch.worktreePath})` : ""} — ${branch.commitsAhead} commit${branch.commitsAhead !== 1 ? "s" : ""} ahead of ${defaultBranch}`}
      >
        {isActive && (
          <span className="absolute left-0.5 top-1.5 bottom-1.5 w-[2px] rounded-full bg-fg/30" />
        )}

        <div className="flex items-center gap-1.5 min-w-0">
          <span className={`text-xs truncate flex-1 min-w-0 ${nameClass}`}>
            {repoName && <span className="text-fg-muted">{repoName} / </span>}
            {branch.name}
          </span>

          <span className="relative grid shrink-0 justify-items-end items-center">
            <span
              className={`col-start-1 row-start-1 flex items-center gap-1.5
                          transition-opacity duration-100 ${
                            itemKind === "worktree"
                              ? "group-hover:opacity-0 group-hover:pointer-events-none"
                              : ""
                          }`}
            >
              {isCheckedOut && (
                <span className="text-[9px] rounded-full bg-fg/[0.08] text-fg-faint px-1.5 py-px">
                  {itemKind === "working-tree" ? "local" : "worktree"}
                </span>
              )}
              {branch.hasWorkingTreeChanges && (
                <span className="text-2xs text-status-modified">M</span>
              )}
              {isActive && isWorktreeStale && (
                <span
                  className="text-2xs text-amber-500"
                  title="Worktree is behind branch tip"
                >
                  stale
                </span>
              )}
            </span>
            {itemKind === "worktree" && branch.worktreePath && (
              <button
                type="button"
                onClick={handleRemoveWorktree}
                disabled={removing}
                className="col-start-1 row-start-1 flex items-center justify-center
                           h-5 w-5 rounded text-fg-muted hover:text-status-rejected
                           hover:bg-fg/[0.08] opacity-0 pointer-events-none
                           group-hover:opacity-100 group-hover:pointer-events-auto
                           transition-opacity duration-100 disabled:opacity-50"
                aria-label="Remove worktree"
                title="Remove worktree"
              >
                {removing ? (
                  <Spinner className="h-3 w-3 border-[1.5px] border-edge-strong border-t-fg-muted" />
                ) : (
                  <XIcon className="h-3 w-3" />
                )}
              </button>
            )}
          </span>
        </div>
      </div>

      {/* Context menu */}
      {showContextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-50 min-w-[160px] rounded-lg border border-edge-default bg-surface-raised/90 backdrop-blur-xl py-1 shadow-xl"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          >
            {showChangeBase ? (
              <ChangeBaseMenu
                repoPath={repoPath}
                comparison={comparison}
                onClose={() => {
                  setShowContextMenu(false);
                  setShowChangeBase(false);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setShowChangeBase(true)}
                className="w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] transition-colors flex items-center justify-between"
              >
                <span>Change Base…</span>
                <span className="text-[10px] text-fg-faint ml-3 truncate max-w-[80px]">
                  {defaultBranch}
                </span>
              </button>
            )}
          </div>,
          document.body,
        )}
    </>
  );
});
