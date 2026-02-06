import { useCallback, useState, useRef, useEffect, memo } from "react";
import type { Comparison } from "../../types";
import type { OpenReview } from "../../stores/slices/tabRailSlice";

/** Format a comparison for display in the tab rail. */
function formatComparison(
  comparison: Comparison,
  defaultBranch?: string,
): string {
  if (comparison.githubPr) {
    return `PR #${comparison.githubPr.number}`;
  }

  const baseIsDefault =
    defaultBranch !== undefined && comparison.old === defaultBranch;

  if (comparison.workingTree) {
    return baseIsDefault ? "Working Tree" : `${comparison.old}..Working Tree`;
  }
  if (comparison.stagedOnly) {
    return baseIsDefault ? "Staged" : `${comparison.old}..Staged`;
  }

  // Branch comparison
  if (baseIsDefault) {
    return comparison.new;
  }
  return `${comparison.old}..${comparison.new}`;
}

interface TabRailItemProps {
  review: OpenReview;
  isActive: boolean;
  onActivate: () => void;
  onClose: () => void;
  onNewReviewInRepo: () => void;
}

export const TabRailItem = memo(function TabRailItem({
  review,
  isActive,
  onActivate,
  onClose,
  onNewReviewInRepo,
}: TabRailItemProps) {
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const comparisonDisplay = formatComparison(
    review.comparison,
    review.defaultBranch,
  );

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleCloseClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  // Close context menu on outside click
  useEffect(() => {
    if (!showContextMenu) return;
    const handleClick = (e: MouseEvent) => {
      if (
        contextMenuRef.current &&
        !contextMenuRef.current.contains(e.target as Node)
      ) {
        setShowContextMenu(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showContextMenu]);

  const stats = review.diffStats;

  return (
    <>
      <button
        onClick={onActivate}
        onContextMenu={handleContextMenu}
        className={`group relative w-full text-left px-3 py-2 rounded-md mb-px
                    transition-colors duration-100
                    ${isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"}`}
        aria-current={isActive ? "true" : undefined}
        title={`${review.repoName} - ${comparisonDisplay}`}
      >
        {/* Active indicator bar */}
        {isActive && (
          <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-amber-500/80" />
        )}
        {/* Repo name */}
        <div className="flex items-center justify-between gap-1 min-w-0">
          <span
            className={`text-xs font-medium truncate ${
              isActive
                ? "text-stone-100"
                : "text-stone-300 group-hover:text-stone-200"
            }`}
          >
            {review.repoName}
          </span>
          {/* Close button — appears on hover */}
          <span
            role="button"
            tabIndex={-1}
            onClick={handleCloseClick}
            className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100
                       text-stone-500 hover:text-stone-200 hover:bg-white/[0.08]
                       transition-opacity duration-75"
            aria-label={`Close ${review.repoName}`}
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </span>
        </div>
        {/* Comparison + stats */}
        <div className="flex items-center justify-between gap-1.5 mt-0.5 min-w-0">
          <span
            className={`text-2xs truncate ${
              isActive ? "text-stone-400" : "text-stone-500"
            }`}
          >
            {comparisonDisplay}
          </span>
          {stats && (stats.additions > 0 || stats.deletions > 0) && (
            <span className="flex items-center gap-1 font-mono text-xxs tabular-nums shrink-0">
              {stats.additions > 0 && (
                <span className="text-emerald-500/70">+{stats.additions}</span>
              )}
              {stats.deletions > 0 && (
                <span className="text-red-400/60">-{stats.deletions}</span>
              )}
            </span>
          )}
        </div>
        {/* Review progress bar */}
        {review.reviewProgress && review.reviewProgress.totalHunks > 0 && (
          <div className="flex items-center gap-1.5 mt-1">
            <div className="flex-1 h-[2px] rounded-full bg-white/[0.06] overflow-hidden flex">
              {review.reviewProgress.trustedHunks > 0 && (
                <div
                  className="h-full bg-cyan-500 transition-all duration-300"
                  style={{
                    width: `${(review.reviewProgress.trustedHunks / review.reviewProgress.totalHunks) * 100}%`,
                  }}
                />
              )}
              {review.reviewProgress.approvedHunks > 0 && (
                <div
                  className="h-full bg-emerald-500 transition-all duration-300"
                  style={{
                    width: `${(review.reviewProgress.approvedHunks / review.reviewProgress.totalHunks) * 100}%`,
                  }}
                />
              )}
              {review.reviewProgress.rejectedHunks > 0 && (
                <div
                  className="h-full bg-rose-500 transition-all duration-300"
                  style={{
                    width: `${(review.reviewProgress.rejectedHunks / review.reviewProgress.totalHunks) * 100}%`,
                  }}
                />
              )}
            </div>
            <span className="text-xxs tabular-nums text-stone-600 shrink-0">
              {review.reviewProgress.reviewedPercent}%
            </span>
          </div>
        )}
      </button>

      {/* Context menu */}
      {showContextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-lg border border-white/[0.08] bg-stone-800/90 backdrop-blur-xl py-1 shadow-xl"
          style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
        >
          <button
            onClick={() => {
              setShowContextMenu(false);
              onNewReviewInRepo();
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-white/[0.08] transition-colors"
          >
            New Review in This Repo...
          </button>
          <button
            onClick={() => {
              setShowContextMenu(false);
              onClose();
            }}
            className="w-full px-3 py-1.5 text-left text-xs text-stone-300 hover:bg-white/[0.08] transition-colors"
          >
            Close Tab
          </button>
        </div>
      )}
    </>
  );
});
