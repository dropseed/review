import { useCallback, useState, useRef, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import type {
  Comparison,
  DiffShortStat,
  GlobalReviewSummary,
} from "../../types";
import type { ReviewSortOrder } from "../../stores/slices/preferencesSlice";
import { useReviewStore } from "../../stores";
import { CircleProgress } from "../ui/circle-progress";
import { formatAge, compactNum } from "../../utils/format-age";
import { makeReviewKey } from "../../stores/slices/groupingSlice";
import { computeReviewProgress } from "../../hooks/useReviewProgress";

/** Format a branch comparison for display. */
function formatBranchComparison(
  comparison: Comparison,
  defaultBranch?: string,
): string {
  const baseIsDefault =
    defaultBranch !== undefined && comparison.base === defaultBranch;

  if (baseIsDefault) {
    return comparison.head;
  }
  return `${comparison.base}..${comparison.head}`;
}

/** GitHub pull request icon (open state style). */
function PullRequestIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z" />
    </svg>
  );
}

interface TabRailItemProps {
  review: GlobalReviewSummary;
  repoName: string;
  defaultBranch?: string;
  avatarUrl?: string | null;
  sortOrder?: ReviewSortOrder;
  diffStats?: DiffShortStat;
  missingRefs?: string[];
  onActivate: (review: GlobalReviewSummary) => void;
  onDelete: (review: GlobalReviewSummary) => void;
}

/** Value-based comparison so items skip re-render when globalReviews is reconstructed. */
function arePropsEqual(
  prev: TabRailItemProps,
  next: TabRailItemProps,
): boolean {
  if (prev.review.repoPath !== next.review.repoPath) return false;
  if (prev.review.comparison.key !== next.review.comparison.key) return false;
  if (prev.review.updatedAt !== next.review.updatedAt) return false;
  if (prev.review.totalHunks !== next.review.totalHunks) return false;
  if (prev.review.reviewedHunks !== next.review.reviewedHunks) return false;
  if (prev.review.repoName !== next.review.repoName) return false;
  if (prev.review.githubPr?.number !== next.review.githubPr?.number)
    return false;
  if (prev.review.githubPr?.title !== next.review.githubPr?.title) return false;
  if (prev.repoName !== next.repoName) return false;
  if (prev.defaultBranch !== next.defaultBranch) return false;
  if (prev.avatarUrl !== next.avatarUrl) return false;
  if (prev.sortOrder !== next.sortOrder) return false;
  if (prev.diffStats?.additions !== next.diffStats?.additions) return false;
  if (prev.diffStats?.deletions !== next.diffStats?.deletions) return false;
  if (prev.missingRefs?.join() !== next.missingRefs?.join()) return false;
  if (prev.onActivate !== next.onActivate) return false;
  if (prev.onDelete !== next.onDelete) return false;
  return true;
}

export const TabRailItem = memo(function TabRailItem({
  review,
  repoName,
  defaultBranch,
  avatarUrl,
  sortOrder,
  diffStats,
  missingRefs,
  onActivate,
  onDelete,
}: TabRailItemProps) {
  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === review.repoPath &&
      s.activeReviewKey?.comparisonKey === review.comparison.key,
  );
  const reviewKey = makeReviewKey(review.repoPath, review.comparison.key);
  const isBusy = useReviewStore(
    useCallback((s) => s.isReviewBusy(reviewKey), [reviewKey]),
  );
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const pr = review.githubPr;
  const isPr = pr != null;
  const hasMissingRefs = missingRefs != null && missingRefs.length > 0;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
  }, []);

  const handleOverflowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenuPos({ x: rect.left, y: rect.bottom + 2 });
    setShowContextMenu(true);
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
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showContextMenu]);

  // For the active review, derive progress from live hunks to avoid stale summary data.
  const livePercent = useReviewStore((s) => {
    if (!isActive || s.hunks.length === 0) return null;
    const progress = computeReviewProgress(s.hunks, s.reviewState);
    return progress.totalHunks > 0 ? progress.reviewedPercent : 0;
  });

  const reviewedPercent =
    livePercent !== null
      ? livePercent
      : review.totalHunks > 0
        ? Math.round((review.reviewedHunks / review.totalHunks) * 100)
        : 0;

  const showProgress = livePercent !== null ? true : review.totalHunks > 0;

  const age = formatAge(review.updatedAt);

  // Line 1: the most identifying info
  const primaryLabel = isPr
    ? pr.title || `PR #${pr.number}`
    : formatBranchComparison(review.comparison, defaultBranch);

  const titleText = hasMissingRefs
    ? `Branch deleted: ${missingRefs.join(", ")}`
    : isPr
      ? `${repoName} - PR #${pr.number}: ${pr.title}`
      : `${repoName} - ${formatBranchComparison(review.comparison, defaultBranch)}`;

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onActivate(review)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onActivate(review);
          }
        }}
        onContextMenu={handleContextMenu}
        className={`group relative w-full text-left px-2.5 py-2 rounded-md mb-0.5 cursor-default
                    transition-colors duration-100
                    ${isActive ? "bg-fg/[0.08]" : "hover:bg-fg/[0.05]"}`}
        aria-current={isActive ? "true" : undefined}
        title={titleText}
      >
        {/* Active indicator bar */}
        {isActive && (
          <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-status-modified/80" />
        )}

        <div className="flex items-center gap-1.5 min-w-0">
          {isBusy && (
            <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] border-edge-strong border-t-status-modified animate-spin" />
          )}
          {!isBusy && hasMissingRefs && (
            <svg
              className="h-3.5 w-3.5 shrink-0 text-status-rejected"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          )}
          {!isBusy && !hasMissingRefs && showProgress && (
            <CircleProgress percent={reviewedPercent} />
          )}
          {!isBusy && !hasMissingRefs && !showProgress && avatarUrl && (
            <img
              src={avatarUrl}
              alt=""
              className="h-3 w-3 shrink-0 rounded-sm"
            />
          )}
          <span className="text-xs text-fg-muted truncate min-w-0">
            {review.repoName}
          </span>
          <span className="text-xs text-fg-muted shrink-0 -mx-0.5">/</span>
          {isPr && (
            <PullRequestIcon className="h-3 w-3 shrink-0 text-status-approved" />
          )}
          <span
            className={`text-xs truncate flex-1 min-w-0 ${
              isActive
                ? "text-fg font-medium"
                : "text-fg-secondary group-hover:text-fg-secondary"
            }`}
          >
            {primaryLabel}
            {isPr && ` #${pr.number}`}
          </span>
          {/* Right side: contextual metadata / overflow — stacked grid for no layout shift */}
          <span className="relative grid shrink-0 justify-items-end items-center">
            <span
              className="col-start-1 row-start-1 flex items-center gap-1.5
                             transition-opacity duration-100 group-hover:opacity-0 group-hover:pointer-events-none"
            >
              {sortOrder === "size" && diffStats ? (
                <span className="text-2xs tabular-nums">
                  <span className="text-[var(--color-diff-added)]">
                    +{compactNum(diffStats.additions)}
                  </span>{" "}
                  <span className="text-[var(--color-diff-removed)]">
                    -{compactNum(diffStats.deletions)}
                  </span>
                </span>
              ) : (
                <span className="text-2xs tabular-nums text-fg-faint">
                  {age}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={handleOverflowClick}
              className="col-start-1 row-start-1 flex items-center justify-center
                         h-5 w-5 rounded text-fg-muted hover:text-fg-secondary
                         hover:bg-fg/[0.08] opacity-0 pointer-events-none
                         group-hover:opacity-100 group-hover:pointer-events-auto
                         transition-opacity duration-100"
              aria-label="Review options"
            >
              <svg
                className="h-3 w-3"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
          </span>
        </div>
      </div>

      {/* Context menu — portaled to body to escape backdrop-blur containing block */}
      {showContextMenu &&
        createPortal(
          <div
            ref={contextMenuRef}
            className="fixed z-50 min-w-[160px] rounded-lg border border-edge-default bg-surface-raised/90 backdrop-blur-xl py-1 shadow-xl"
            style={{ left: contextMenuPos.x, top: contextMenuPos.y }}
          >
            <button
              type="button"
              onClick={() => {
                setShowContextMenu(false);
                onDelete(review);
              }}
              className="w-full px-3 py-1.5 text-left text-xs text-status-rejected hover:bg-fg/[0.08] transition-colors"
            >
              Delete Review
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}, arePropsEqual);
