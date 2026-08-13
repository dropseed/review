import { memo, useCallback } from "react";
import { useReviewStore } from "../../stores";
import type { ViewerPr } from "../../types";
import { PrBadge } from "./PrBadge";
import { samePrBadge } from "./pr-format";
import { ActionContextMenu } from "./ActionMenu";
import { refRowActions, useAddToWork } from "./work-actions";
import { useWorkRefDrag } from "./work-row-drag";

interface RemoteBranchItemProps {
  branchName: string;
  remoteRef: string;
  repoPath: string;
  defaultBranch: string;
  lastCommitDate: string;
  /** The user's open PR for this branch, when the tree joined one onto it. */
  openPr?: ViewerPr;
  onActivate: (repoPath: string, branch: string, defaultBranch: string) => void;
}

/** Value-based comparison so rows skip re-render when the tree is rebuilt. */
function arePropsEqual(
  prev: RemoteBranchItemProps,
  next: RemoteBranchItemProps,
): boolean {
  if (prev.branchName !== next.branchName) return false;
  if (prev.remoteRef !== next.remoteRef) return false;
  if (prev.repoPath !== next.repoPath) return false;
  if (prev.defaultBranch !== next.defaultBranch) return false;
  if (prev.lastCommitDate !== next.lastCommitDate) return false;
  if (!samePrBadge(prev.openPr, next.openPr)) return false;
  if (prev.onActivate !== next.onActivate) return false;
  return true;
}

/**
 * Sidebar row for a remote-tracking branch surfaced under "Remote (recent)".
 * No local checkout required — clicking opens a (read-only) comparison against
 * the default branch. Faded styling distinguishes it from local entries.
 */
export const RemoteBranchItem = memo(function RemoteBranchItem({
  branchName,
  remoteRef,
  repoPath,
  defaultBranch,
  lastCommitDate,
  openPr,
  onActivate,
}: RemoteBranchItemProps) {
  // A remote branch's review identity is its (unprefixed) branch name.
  const workDragProps = useWorkRefDrag(repoPath, branchName);
  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.ref === branchName,
  );

  const handleClick = useCallback(() => {
    onActivate(repoPath, branchName, defaultBranch);
  }, [onActivate, repoPath, branchName, defaultBranch]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleClick();
      }
    },
    [handleClick],
  );

  const addToWork = useAddToWork(repoPath, branchName);
  const rowActions = refRowActions({
    ref: branchName,
    addToWork,
    openPr,
    onOpen: handleClick,
  });

  return (
    <ActionContextMenu actions={rowActions}>
      <div
        role="button"
        tabIndex={0}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        {...workDragProps}
        className={`group relative w-full text-left pl-4 pr-2.5 py-1 rounded cursor-default
                    transition-colors duration-100
                    ${isActive ? "bg-fg/[0.04]" : "hover:bg-fg/[0.03]"}`}
        aria-current={isActive ? "true" : undefined}
        title={`${remoteRef} — last commit ${lastCommitDate}`}
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
            {branchName}
          </span>
          {openPr && <PrBadge pr={openPr} />}
          <span className="text-[9px] rounded-full bg-fg/[0.06] text-fg-faint/70 px-1.5 py-px shrink-0">
            remote
          </span>
        </div>
      </div>
    </ActionContextMenu>
  );
}, arePropsEqual);
