import { memo, useCallback } from "react";
import { useReviewStore } from "../../stores";
import { makeComparison } from "../../types";

interface RemoteBranchItemProps {
  branchName: string;
  remoteRef: string;
  repoPath: string;
  defaultBranch: string;
  lastCommitDate: string;
  onActivate: (repoPath: string, branch: string, defaultBranch: string) => void;
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
  onActivate,
}: RemoteBranchItemProps) {
  const comparisonKey = makeComparison(defaultBranch, branchName).key;
  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.comparisonKey === comparisonKey,
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

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
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
        <span className="text-[9px] rounded-full bg-fg/[0.06] text-fg-faint/70 px-1.5 py-px shrink-0">
          remote
        </span>
      </div>
    </div>
  );
});
