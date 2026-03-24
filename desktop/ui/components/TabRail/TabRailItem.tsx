import { useCallback, useState, useRef, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import type { Comparison, GlobalReviewSummary } from "../../types";
import { useReviewStore } from "../../stores";
import { Spinner } from "../ui/spinner";
import { WarningIcon } from "../ui/icons";
import { makeReviewKey } from "../../stores/slices/groupingSlice";
import { ChangeBaseMenu } from "./ChangeBaseMenu";

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
  if (prev.missingRefs?.join() !== next.missingRefs?.join()) return false;
  if (prev.onActivate !== next.onActivate) return false;
  if (prev.onDelete !== next.onDelete) return false;
  return true;
}

export const TabRailItem = memo(function TabRailItem({
  review,
  repoName,
  defaultBranch,
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
  const [showChangeBase, setShowChangeBase] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const pr = review.githubPr;
  const isPr = pr != null;
  const hasMissingRefs = missingRefs != null && missingRefs.length > 0;

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenuPos({ x: e.clientX, y: e.clientY });
    setShowContextMenu(true);
    setShowChangeBase(false);
  }, []);

  const handleOverflowClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setContextMenuPos({ x: rect.left, y: rect.bottom + 2 });
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
        className={`group relative w-full text-left px-2.5 py-1 rounded cursor-default
                    transition-colors duration-100
                    ${isActive ? "bg-fg/[0.05]" : "hover:bg-fg/[0.03]"}`}
        aria-current={isActive ? "true" : undefined}
        title={titleText}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {isBusy && (
            <Spinner className="h-3 w-3 shrink-0 border-[1.5px] border-edge-strong border-t-status-modified" />
          )}
          {isPr && !isBusy && (
            <PullRequestIcon className="h-3 w-3 shrink-0 text-status-approved" />
          )}
          <span
            className={`text-xs truncate flex-1 min-w-0 ${
              isActive
                ? "text-fg-secondary font-medium"
                : "text-fg-muted/70 group-hover:text-fg-muted"
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
              {hasMissingRefs && (
                <WarningIcon className="h-3 w-3 shrink-0 text-status-rejected" />
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
            {showChangeBase ? (
              <ChangeBaseMenu
                repoPath={review.repoPath}
                comparison={review.comparison}
                onClose={() => {
                  setShowContextMenu(false);
                  setShowChangeBase(false);
                }}
              />
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowChangeBase(true)}
                  className="w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] transition-colors flex items-center justify-between"
                >
                  <span>Change Base…</span>
                  <span className="text-[10px] text-fg-faint ml-3 truncate max-w-[80px]">
                    {review.comparison.base}
                  </span>
                </button>
                <div className="my-1 border-t border-edge/30" />
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
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}, arePropsEqual);
