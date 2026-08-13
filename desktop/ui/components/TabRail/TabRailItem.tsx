import { useCallback, useState, useRef, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import type { GlobalReviewSummary, ViewerPr } from "../../types";
import { useReviewStore } from "../../stores";
import { PullRequestIcon, WarningIcon } from "../ui/icons";
import { ChangeBaseMenu } from "./ChangeBaseMenu";
import { ButtonActionItems } from "./ActionMenu";
import { refRowActions, useAddToWork } from "./work-actions";
import { useWorkRefDrag } from "./work-row-drag";
import { CheckoutMenuItem } from "./CheckoutMenuItem";
import { RowStatus } from "./RowStatus";
import { PrPreviewCard } from "./PrPreviewCard";
import { SimpleTooltip } from "../ui/tooltip";
import {
  activateOnKey,
  ROW_ACTIONS,
  ROW_LABEL_HOVER_FADE,
  ROW_STATUS,
} from "./row-chrome";
import { PrBadge } from "./PrBadge";
import { samePrBadge } from "./pr-format";

/**
 * Label a review by its identity (ref) for display. Listing is git-free, so
 * there's no resolved base — an explicit override that differs from the default
 * branch is shown as `base..ref`; otherwise just the ref.
 */
function formatReviewLabel(
  review: GlobalReviewSummary,
  defaultBranch?: string,
): string {
  const { ref, baseOverride } = review;
  if (baseOverride != null && baseOverride !== defaultBranch) {
    return `${baseOverride}..${ref}`;
  }
  return ref;
}

interface TabRailItemProps {
  review: GlobalReviewSummary;
  repoName: string;
  defaultBranch?: string;
  missingRefs?: string[];
  /** When set, render `{repoLabel} / ` before the label (zone-1 "Working on"). */
  repoLabel?: string;
  /** The user's open PR for this review's ref, joined on by the tree builder. */
  openPr?: ViewerPr;
  onActivate: (review: GlobalReviewSummary) => void;
  onDelete: (review: GlobalReviewSummary) => void;
}

/** Value-based comparison so items skip re-render when globalReviews is reconstructed. */
function arePropsEqual(
  prev: TabRailItemProps,
  next: TabRailItemProps,
): boolean {
  if (prev.review.repoPath !== next.review.repoPath) return false;
  if (prev.review.ref !== next.review.ref) return false;
  if (prev.review.baseOverride !== next.review.baseOverride) return false;
  if (prev.review.updatedAt !== next.review.updatedAt) return false;
  if (prev.review.totalHunks !== next.review.totalHunks) return false;
  if (prev.review.reviewedHunks !== next.review.reviewedHunks) return false;
  if (prev.review.repoName !== next.review.repoName) return false;
  if (prev.review.githubPr?.number !== next.review.githubPr?.number)
    return false;
  if (prev.review.githubPr?.title !== next.review.githubPr?.title) return false;
  if (prev.repoName !== next.repoName) return false;
  if (prev.repoLabel !== next.repoLabel) return false;
  if (prev.defaultBranch !== next.defaultBranch) return false;
  if (prev.missingRefs?.join() !== next.missingRefs?.join()) return false;
  if (prev.review.tier !== next.review.tier) return false;
  if (prev.review.worktreePath !== next.review.worktreePath) return false;
  if (!samePrBadge(prev.openPr, next.openPr)) return false;
  if (prev.onActivate !== next.onActivate) return false;
  if (prev.onDelete !== next.onDelete) return false;
  return true;
}

export const TabRailItem = memo(function TabRailItem({
  review,
  repoName,
  defaultBranch,
  missingRefs,
  repoLabel,
  openPr,
  onActivate,
  onDelete,
}: TabRailItemProps) {
  const isActive = useReviewStore(
    (s) =>
      s.activeReviewKey?.repoPath === review.repoPath &&
      s.activeReviewKey?.ref === review.ref,
  );
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showChangeBase, setShowChangeBase] = useState(false);
  const [contextMenuPos, setContextMenuPos] = useState({ x: 0, y: 0 });
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const workDragProps = useWorkRefDrag(review.repoPath, review.ref);

  const pr = review.githubPr;
  const isPr = pr != null;
  const hasMissingRefs = missingRefs != null && missingRefs.length > 0;
  // A PR review already leads with a pull-request glyph, so the live state
  // colours *that* one rather than adding a second identical shape to the
  // status cluster. Only a review that isn't itself PR-keyed gets the badge.
  const statusPr = isPr ? undefined : openPr;

  const addToWork = useAddToWork(review.repoPath, review.ref);
  const rowActions = refRowActions({
    ref: review.ref,
    addToWork,
    openPr,
    onOpen: () => onActivate(review),
  });

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
    : formatReviewLabel(review, defaultBranch);

  const titleText = hasMissingRefs
    ? `Branch deleted: ${missingRefs.join(", ")}`
    : isPr
      ? `${repoName} - PR #${pr.number}: ${pr.title}`
      : `${repoName} - ${formatReviewLabel(review, defaultBranch)}`;

  const row = (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onActivate(review)}
      onKeyDown={activateOnKey(() => onActivate(review))}
      onContextMenu={handleContextMenu}
      {...workDragProps}
      className={`group relative w-full text-left px-2.5 py-1 rounded cursor-default
                    transition-colors duration-100
                    ${isActive ? "bg-fg/[0.05]" : "hover:bg-fg/[0.03]"}`}
      aria-current={isActive ? "true" : undefined}
      title={titleText}
    >
      <div className="flex items-center gap-1.5 min-w-0">
        {/* The badge itself when GitHub has told us anything about the PR —
            same octicon, same colours, one place. Without a snapshot the row
            still says "pull request", just without claiming a state. */}
        {isPr &&
          (openPr ? (
            <PrBadge pr={openPr} />
          ) : (
            <PullRequestIcon className="h-3 w-3 shrink-0 text-pr-open" />
          ))}
        <span
          className={`text-xs truncate flex-1 min-w-0 ${ROW_LABEL_HOVER_FADE} ${
            isActive
              ? "text-fg-secondary font-medium"
              : "text-fg-muted/70 group-hover:text-fg-muted"
          }`}
        >
          {repoLabel && <span className="text-fg-muted">{repoLabel} / </span>}
          {primaryLabel}
          {isPr && ` #${pr.number}`}
        </span>
        {/* Status stays in the flow and stays interactive; the overflow button
            appears just left of it, over the label's fading tail (see
            row-chrome), rather than reserving width the label needs. */}
        <span className={ROW_STATUS}>
          <RowStatus
            checkoutPath={review.worktreePath}
            tier={review.tier}
            openPr={statusPr}
          />
          {hasMissingRefs && (
            <WarningIcon className="h-3 w-3 shrink-0 text-status-rejected" />
          )}
          <span
            className={`${ROW_ACTIONS} opacity-0 pointer-events-none
                        group-hover:opacity-100 group-hover:pointer-events-auto`}
          >
            <button
              type="button"
              onClick={handleOverflowClick}
              className="flex items-center justify-center h-5 w-5 rounded
                         text-fg-muted hover:text-fg-secondary hover:bg-fg/[0.08]"
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
        </span>
      </div>
    </div>
  );

  return (
    <>
      {/* Metadata-only preview: answers "is this mine to review?" without
          touching git. Only PR rows carry enough metadata to be worth it. */}
      {isPr ? (
        <SimpleTooltip
          side="right"
          content={
            <PrPreviewCard
              pr={pr}
              tier={review.tier}
              stats={review.diffStats}
            />
          }
        >
          {row}
        </SimpleTooltip>
      ) : (
        row
      )}

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
                refName={review.ref}
                currentBase={review.baseOverride}
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
                    {review.baseOverride ?? defaultBranch ?? "auto"}
                  </span>
                </button>
                <div className="my-1 border-t border-edge/30" />
                <button
                  type="button"
                  onClick={() => {
                    setShowContextMenu(false);
                    onDelete(review);
                  }}
                  className="w-full px-3 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg/[0.08] transition-colors"
                >
                  Mark done
                </button>
                <div className="my-1 border-t border-edge/30" />
                <CheckoutMenuItem
                  repoPath={review.repoPath}
                  reviewRef={review.ref}
                  checkoutPath={review.worktreePath}
                  onDone={() => setShowContextMenu(false)}
                />
                <ButtonActionItems
                  actions={rowActions}
                  onDone={() => setShowContextMenu(false)}
                />
              </>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}, arePropsEqual);
