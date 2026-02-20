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

/** Format a date as relative age: "2m", "3h", "5d", "2w", "3mo" */
function formatAge(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const seconds = Math.floor((now - then) / 1000);

  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

/** Format a number compactly: 1234 → "1.2k" */
function compactNum(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
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
  isInactive?: boolean;
  avatarUrl?: string | null;
  sortOrder?: ReviewSortOrder;
  diffStats?: DiffShortStat;
  onActivate: (review: GlobalReviewSummary) => void;
  onDelete: (review: GlobalReviewSummary) => void;
}

/** Value-based comparison so items skip re-render when globalReviews is reconstructed. */
function arePropsEqual(
  prev: TabRailItemProps,
  next: TabRailItemProps,
): boolean {
  // Review identity + rendered data (objects are new refs on each loadGlobalReviews)
  if (prev.review.repoPath !== next.review.repoPath) return false;
  if (prev.review.comparison.key !== next.review.comparison.key) return false;
  if (prev.review.updatedAt !== next.review.updatedAt) return false;
  if (prev.review.totalHunks !== next.review.totalHunks) return false;
  if (prev.review.reviewedHunks !== next.review.reviewedHunks) return false;
  if (prev.review.repoName !== next.review.repoName) return false;
  if (prev.review.githubPr?.number !== next.review.githubPr?.number)
    return false;
  if (prev.review.githubPr?.title !== next.review.githubPr?.title) return false;
  // Scalar props
  if (prev.repoName !== next.repoName) return false;
  if (prev.defaultBranch !== next.defaultBranch) return false;
  if (prev.isInactive !== next.isInactive) return false;
  if (prev.avatarUrl !== next.avatarUrl) return false;
  if (prev.sortOrder !== next.sortOrder) return false;
  // DiffStats (object ref may change)
  if (prev.diffStats?.additions !== next.diffStats?.additions) return false;
  if (prev.diffStats?.deletions !== next.diffStats?.deletions) return false;
  // Callbacks
  if (prev.onActivate !== next.onActivate) return false;
  if (prev.onDelete !== next.onDelete) return false;
  return true;
}

export const TabRailItem = memo(function TabRailItem({
  review,
  repoName,
  defaultBranch,
  isInactive,
  avatarUrl,
  sortOrder,
  diffStats,
  onActivate,
  onDelete,
}: TabRailItemProps) {
  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === review.repoPath &&
      s.activeReviewKey?.comparisonKey === review.comparison.key,
  );
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const pr = review.githubPr;
  const isPr = pr != null;

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

  const reviewedPercent =
    review.totalHunks > 0
      ? Math.round((review.reviewedHunks / review.totalHunks) * 100)
      : 0;

  const showProgress = !isInactive && review.totalHunks > 0;

  const age = formatAge(review.updatedAt);

  // Line 1: the most identifying info
  const primaryLabel = isPr
    ? pr.title || `PR #${pr.number}`
    : formatBranchComparison(review.comparison, defaultBranch);

  const titleText = isPr
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
        className={`group relative w-full text-left px-2 py-1.5 rounded-md mb-px cursor-default
                    transition-colors duration-100
                    ${isActive ? "bg-fg/[0.08]" : "hover:bg-fg/[0.05]"}
                    ${isInactive ? "opacity-60" : ""}`}
        aria-current={isActive ? "true" : undefined}
        title={titleText}
      >
        {/* Active indicator bar */}
        {isActive && (
          <span className="absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-status-modified/80" />
        )}

        <div className="flex items-center gap-1.5 min-w-0">
          {showProgress ? (
            <CircleProgress percent={reviewedPercent} />
          ) : (
            avatarUrl && (
              <img
                src={avatarUrl}
                alt=""
                className="h-3 w-3 shrink-0 rounded-sm"
              />
            )
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
