import { useCallback } from "react";
import { makeComparison } from "../../types";
import { useSidebarData } from "./SidebarDataContext";

export function WorkingTreeSection() {
  const { gitStatus, defaultBranch, savedReviews, onSelectReview } =
    useSidebarData();

  const handleClick = useCallback(() => {
    if (!defaultBranch || !gitStatus) return;

    const key = `${defaultBranch}..${gitStatus.currentBranch}+working-tree`;
    const existing = savedReviews.find((r) => r.comparison.key === key);
    const comparison =
      existing?.comparison ??
      makeComparison(defaultBranch, gitStatus.currentBranch, true);
    onSelectReview(comparison);
  }, [defaultBranch, gitStatus, savedReviews, onSelectReview]);

  // Show skeleton while loading
  if (!defaultBranch || !gitStatus) {
    return (
      <section className="mb-6" aria-label="Local changes loading">
        <div className="w-full rounded-lg border border-stone-800/60 bg-stone-900/50 p-3">
          <div className="space-y-2">
            <div className="h-4 w-32 bg-stone-800 rounded animate-pulse" />
            <div className="h-3 w-24 bg-stone-800/60 rounded animate-pulse" />
          </div>
        </div>
      </section>
    );
  }

  const { currentBranch } = gitStatus;
  const stagedCount = gitStatus.staged.length;
  const modifiedCount = gitStatus.unstaged.length;
  const untrackedCount = gitStatus.untracked.length;
  const totalChanges = stagedCount + modifiedCount + untrackedCount;

  // Find existing review for progress display
  const existingReview = savedReviews.find(
    (r) =>
      r.comparison.key === `${defaultBranch}..${currentBranch}+working-tree`,
  );

  const progress = existingReview?.totalHunks
    ? Math.round(
        (existingReview.reviewedHunks / existingReview.totalHunks) * 100,
      )
    : 0;
  const progressWidth = progress > 0 ? Math.max(progress, 3) : 0;

  return (
    <section className="mb-6" aria-label="Local changes">
      <button
        onClick={handleClick}
        className="group w-full rounded-lg border border-stone-800/60 bg-stone-900/50
                   transition-all duration-150
                   hover:border-green-500/30 hover:bg-stone-900/80
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-green-500/50
                   p-3 text-left"
        aria-label={`Open local changes on ${currentBranch}`}
      >
        {/* Row 1: Title + branch */}
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-2 min-w-0">
            <svg
              className="w-4 h-4 text-green-400 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="6" y1="3" x2="6" y2="15" />
              <circle cx="18" cy="6" r="3" />
              <circle cx="6" cy="18" r="3" />
              <path d="M18 9a9 9 0 0 1-9 9" />
            </svg>
            <span className="text-sm font-medium text-stone-200">
              Local Changes
            </span>
          </div>
          <span className="font-mono text-xs text-green-400/80 truncate max-w-[120px]">
            {currentBranch}
          </span>
        </div>

        {/* Row 2: Change counts */}
        <div className="flex items-center gap-2 text-xs mb-2">
          {totalChanges === 0 ? (
            <span className="text-stone-500">No uncommitted changes</span>
          ) : (
            <>
              {stagedCount > 0 && (
                <span className="text-green-500">{stagedCount} staged</span>
              )}
              {modifiedCount > 0 && (
                <span className="text-amber-500">{modifiedCount} modified</span>
              )}
              {untrackedCount > 0 && (
                <span className="text-stone-500">
                  {untrackedCount} untracked
                </span>
              )}
            </>
          )}
        </div>

        {/* Row 3: Progress bar (full width) */}
        {existingReview && existingReview.totalHunks > 0 && (
          <div className="flex items-center gap-2">
            <div
              className="flex-1 h-1 overflow-hidden rounded-full bg-stone-800/80"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full rounded-full bg-gradient-to-r from-sage-500 to-sage-400 transition-[width] duration-300"
                style={{ width: `${progressWidth}%` }}
              />
            </div>
            <span className="text-xs text-stone-500 whitespace-nowrap">
              {existingReview.reviewedHunks} / {existingReview.totalHunks}
            </span>
          </div>
        )}
      </button>
    </section>
  );
}
