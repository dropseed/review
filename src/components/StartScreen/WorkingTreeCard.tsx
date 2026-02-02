import { useState, useEffect, useCallback } from "react";
import { makeComparison } from "../../types";
import type { Comparison, GitStatusSummary, ReviewSummary } from "../../types";
import { getApiClient } from "../../api";

interface WorkingTreeCardProps {
  repoPath: string;
  gitStatus: GitStatusSummary | null;
  savedReviews: ReviewSummary[];
  onSelectReview: (comparison: Comparison) => void;
}

export function WorkingTreeCard({
  repoPath,
  gitStatus,
  savedReviews,
  onSelectReview,
}: WorkingTreeCardProps) {
  const [defaultBranch, setDefaultBranch] = useState<string | null>(null);

  // Fetch default branch on mount
  useEffect(() => {
    let cancelled = false;
    const apiClient = getApiClient();
    apiClient
      .getDefaultBranch(repoPath)
      .then((branch) => {
        if (!cancelled) setDefaultBranch(branch);
      })
      .catch(() => {
        if (!cancelled) setDefaultBranch("main");
      });
    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  const handleClick = useCallback(() => {
    if (!defaultBranch || !gitStatus) return;

    const key = `${defaultBranch}..${gitStatus.currentBranch}+working-tree`;
    const existing = savedReviews.find((r) => r.comparison.key === key);
    const comparison =
      existing?.comparison ??
      makeComparison(defaultBranch, gitStatus.currentBranch, true);
    onSelectReview(comparison);
  }, [defaultBranch, gitStatus, savedReviews, onSelectReview]);

  // Don't render until we have both defaultBranch and gitStatus
  if (!defaultBranch || !gitStatus) return null;

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

  return (
    <section className="mb-6" aria-label="Local changes">
      <button
        onClick={handleClick}
        className="group w-full rounded-xl border border-stone-800/80 bg-gradient-to-br from-stone-900/80 to-stone-900/40
                   backdrop-blur-xs shadow-lg shadow-black/20
                   transition-all duration-200
                   hover:border-green-500/25 hover:shadow-green-900/10
                   hover:from-stone-900 hover:to-stone-900/60 hover:shadow-xl
                   hover:-translate-y-0.5
                   focus:outline-hidden focus:inset-ring-2 focus:inset-ring-green-500/50
                   px-5 py-4 text-left"
        aria-label={`Open local changes on ${currentBranch}`}
      >
        <div className="flex items-center gap-3">
          {/* Branch icon */}
          <div className="shrink-0 w-8 h-8 rounded-lg bg-green-500/10 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-green-400"
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
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-stone-200">
                Local Changes
              </span>
              <span className="font-mono text-xs text-green-400 truncate">
                {currentBranch}
              </span>
            </div>

            {/* Change counts */}
            <div className="mt-1 flex items-center gap-3 text-xs text-stone-500">
              {totalChanges === 0 ? (
                <span>No uncommitted changes</span>
              ) : (
                <>
                  {stagedCount > 0 && (
                    <span className="text-green-500">{stagedCount} staged</span>
                  )}
                  {modifiedCount > 0 && (
                    <span className="text-amber-500">
                      {modifiedCount} modified
                    </span>
                  )}
                  {untrackedCount > 0 && (
                    <span className="text-stone-500">
                      {untrackedCount} untracked
                    </span>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Right side: progress if existing review */}
          {existingReview &&
            existingReview.totalHunks > 0 &&
            (() => {
              const progress = Math.round(
                (existingReview.reviewedHunks / existingReview.totalHunks) *
                  100,
              );
              const progressWidth = progress > 0 ? Math.max(progress, 5) : 0;
              return (
                <div className="flex items-center gap-3">
                  <div className="h-1 w-24 overflow-hidden rounded-full bg-stone-800/80">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-sage-500 to-sage-400"
                      style={{ width: `${progressWidth}%` }}
                    />
                  </div>
                  <span className="text-xs text-stone-400 whitespace-nowrap">
                    {existingReview.reviewedHunks === 0
                      ? `${existingReview.totalHunks} to review`
                      : `${existingReview.reviewedHunks} of ${existingReview.totalHunks}`}
                  </span>
                </div>
              );
            })()}

          {/* Arrow icon */}
          <svg
            className="w-4 h-4 text-stone-600 group-hover:text-stone-400 transition-colors"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </button>
    </section>
  );
}
