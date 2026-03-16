import { memo, useCallback } from "react";
import { useReviewStore } from "../../stores";
import type { LocalBranchInfo } from "../../types";
import { makeComparison } from "../../types";
import { formatAge, compactNum } from "../../utils/format-age";
import { makeReviewKey } from "../../stores/slices/groupingSlice";
import {
  makeBranchKey,
  statsHash,
} from "../../stores/slices/localActivitySlice";
import { CircleProgress } from "../ui/circle-progress";

interface LocalBranchItemProps {
  branch: LocalBranchInfo;
  repoPath: string;
  repoName?: string;
  defaultBranch: string;
  /** "changes" = Working Changes view, "all" = All Branches view */
  viewMode: "changes" | "all";
  onActivate: (repoPath: string, branch: string, defaultBranch: string) => void;
}

/** Branch icon (git-branch from Octicons). */
function BranchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M9.5 3.25a2.25 2.25 0 1 1 3 2.122V6A2.5 2.5 0 0 1 10 8.5H6a1 1 0 0 0-1 1v1.128a2.251 2.251 0 1 1-1.5 0V5.372a2.25 2.25 0 1 1 1.5 0v1.836A2.493 2.493 0 0 1 6 7h4a1 1 0 0 0 1-1v-.628A2.25 2.25 0 0 1 9.5 3.25Zm-6 0a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Zm8.25-.75a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5ZM4.25 12a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Z" />
    </svg>
  );
}

export const LocalBranchItem = memo(function LocalBranchItem({
  branch,
  repoPath,
  repoName,
  defaultBranch,
  viewMode,
  onActivate,
}: LocalBranchItemProps) {
  const comparisonKey = makeComparison(defaultBranch, branch.name).key;

  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.comparisonKey === comparisonKey,
  );

  // Look up review progress percent (primitive for stable Zustand equality)
  const reviewPercent = useReviewStore((s) => {
    const key = makeReviewKey(repoPath, comparisonKey);
    const review = s.globalReviewsByKey[key];
    if (!review || review.totalHunks === 0) return -1;
    return Math.round((review.reviewedHunks / review.totalHunks) * 100);
  });
  const hasReviewProgress = reviewPercent >= 0;

  // Check if the working tree diff has changed since the user last viewed this branch.
  // Reads activeReviewKey from store state directly to avoid stale closure issues.
  const isUnseen = useReviewStore((s) => {
    const active =
      s.activeReviewKey?.repoPath === repoPath &&
      s.activeReviewKey?.comparisonKey === comparisonKey;
    if (active) return false;
    const key = makeBranchKey(repoPath, branch.name);
    const seen = s.lastSeenDiffStats[key];
    if (seen === undefined) return true;
    return seen !== statsHash(branch.workingTreeStats);
  });

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

  const age = formatAge(branch.lastCommitDate);
  const isCheckedOut = branch.isCurrent || branch.worktreePath != null;
  const stats = branch.workingTreeStats;

  // In "all" mode, the leading icon distinguishes checked-out vs not.
  // In "changes" mode, everything shown is checked out (implied), so use a uniform style.
  const branchIconClass =
    viewMode === "all" && isCheckedOut
      ? "h-3 w-3 shrink-0 text-fg-secondary"
      : "h-3 w-3 shrink-0 text-fg-faint";

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`group relative w-full text-left px-2.5 py-2 rounded-md mb-0.5 cursor-default
                  transition-colors duration-100
                  ${isActive ? "bg-fg/[0.08]" : "hover:bg-fg/[0.05]"}`}
      aria-current={isActive ? "true" : undefined}
      title={`${branch.name}${branch.worktreePath ? ` (worktree: ${branch.worktreePath})` : ""} — ${branch.commitsAhead} commit${branch.commitsAhead !== 1 ? "s" : ""} ahead of ${defaultBranch}`}
    >
      {/* Active indicator bar */}
      {isActive && (
        <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-status-modified/80" />
      )}

      <div className="flex items-center gap-1.5 min-w-0">
        {/* Leading icon */}
        {viewMode === "changes" ? (
          // Changes view: pulsing unseen dot, or progress circle when seen/active
          isUnseen ? (
            <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
              <span className="h-2 w-2 rounded-full bg-[var(--color-focus-ring)] animate-pulse" />
            </span>
          ) : (
            <CircleProgress percent={hasReviewProgress ? reviewPercent : 0} />
          )
        ) : // All view: progress circle if reviewed, branch icon otherwise
        hasReviewProgress ? (
          <CircleProgress percent={reviewPercent} />
        ) : (
          <BranchIcon className={branchIconClass} />
        )}

        {/* Branch name (with optional repo prefix for Working Changes) */}
        <span
          className={`text-xs truncate flex-1 min-w-0 ${
            isActive
              ? "text-fg font-medium"
              : "text-fg-secondary group-hover:text-fg-secondary"
          }`}
        >
          {repoName && <span className="text-fg-muted">{repoName} / </span>}
          {branch.name}
        </span>

        {/* Right side */}
        <span className="flex items-center gap-1.5 shrink-0">
          {viewMode === "changes" && stats && (
            <span className="text-2xs tabular-nums">
              {stats.additions > 0 || stats.deletions > 0 ? (
                <>
                  <span className="text-[var(--color-diff-added)]">
                    +{compactNum(stats.additions)}
                  </span>{" "}
                  <span className="text-[var(--color-diff-removed)]">
                    -{compactNum(stats.deletions)}
                  </span>
                </>
              ) : (
                <span className="text-fg-faint">
                  {stats.fileCount} file{stats.fileCount !== 1 ? "s" : ""}
                </span>
              )}
            </span>
          )}
          {viewMode === "all" && (
            <>
              <span className="text-2xs tabular-nums text-fg-faint">{age}</span>
              {branch.hasWorkingTreeChanges && (
                <span className="text-2xs text-status-modified">M</span>
              )}
              {branch.commitsAhead > 0 && (
                <span className="text-2xs tabular-nums text-fg-faint bg-fg/[0.06] rounded px-1">
                  {branch.commitsAhead}
                </span>
              )}
            </>
          )}
        </span>
      </div>
    </div>
  );
});
