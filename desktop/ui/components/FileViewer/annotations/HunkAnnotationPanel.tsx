import type { MutableRefObject } from "react";
import type { DiffHunk, HunkState } from "../../../types";
import { isHunkTrusted } from "../../../types";
import { useReviewStore } from "../../../stores";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu";
import { SimpleTooltip } from "../../ui/tooltip";
import { MovePairModal } from "./MovePairModal";
import { SimilarHunksModal } from "./SimilarHunksModal";

type ReviewStatus =
  | "approved"
  | "rejected"
  | "saved_for_later"
  | "trusted"
  | "pending";

function getReviewStatus(
  hunkState: HunkState | undefined,
  trustList: string[],
): ReviewStatus {
  if (hunkState?.status === "rejected") return "rejected";
  if (hunkState?.status === "approved") return "approved";
  if (hunkState?.status === "saved_for_later") return "saved_for_later";
  if (!hunkState?.status && isHunkTrusted(hunkState, trustList))
    return "trusted";
  return "pending";
}

function getHunkBackgroundClass(status: ReviewStatus): string {
  switch (status) {
    case "rejected":
      return "bg-status-rejected/10";
    case "approved":
      return "bg-status-approved/8";
    case "saved_for_later":
      return "bg-status-modified/10";
    case "trusted":
      return "bg-status-renamed/8";
    case "pending":
      return "bg-surface-raised/90";
  }
}

interface HunkAnnotationPanelProps {
  hunk: DiffHunk;
  hunkState: HunkState | undefined;
  pairedHunk: DiffHunk | null;
  isSource: boolean;
  focusedHunkId: string | null | undefined;
  focusedHunkRef: MutableRefObject<HTMLDivElement | null>;
  trustList: string[];
  hunkPosition?: number; // 1-indexed position in file
  totalHunksInFile?: number;
  // Similar hunks data for "N like this" modal
  similarHunks: DiffHunk[];
  allHunkStates: Record<string, HunkState | undefined>;
  onApprove: (hunkId: string) => void;
  onUnapprove: (hunkId: string) => void;
  onReject: (hunkId: string) => void;
  onUnreject: (hunkId: string) => void;
  onSaveForLater: (hunkId: string) => void;
  onUnsaveForLater: (hunkId: string) => void;
  onApprovePair: (hunkIds: string[]) => void;
  onRejectPair: (hunkIds: string[]) => void;
  onAddTrustPattern: (pattern: string) => void;
  onRemoveTrustPattern: (pattern: string) => void;
  onReclassifyHunks: (hunkIds: string[]) => void;
  onCopyHunk: (hunk: DiffHunk) => void;
  onViewInFile?: (line: number) => void;
  onApproveAllSimilar: (hunkIds: string[]) => void;
  onRejectAllSimilar: (hunkIds: string[]) => void;
  onNavigateToHunk?: (hunkId: string) => void;
}

export function HunkAnnotationPanel({
  hunk,
  hunkState,
  pairedHunk,
  isSource,
  focusedHunkId,
  focusedHunkRef,
  trustList,
  hunkPosition,
  totalHunksInFile,
  similarHunks,
  allHunkStates,
  onApprove,
  onUnapprove,
  onReject,
  onUnreject,
  onSaveForLater,
  onUnsaveForLater,
  onApprovePair,
  onRejectPair,
  onAddTrustPattern,
  onRemoveTrustPattern,
  onReclassifyHunks,
  onCopyHunk,
  onViewInFile,
  onApproveAllSimilar,
  onRejectAllSimilar,
  onNavigateToHunk,
}: HunkAnnotationPanelProps) {
  const reviewStatus = getReviewStatus(hunkState, trustList);
  const isApproved = reviewStatus === "approved";
  const isRejected = reviewStatus === "rejected";
  const isSavedForLater = reviewStatus === "saved_for_later";
  const isTrusted = reviewStatus === "trusted";
  const isFocused = hunk.id === focusedHunkId;

  const borderClass = isFocused
    ? "border border-edge-strong/60 ring-1 ring-fg/25"
    : "border border-edge-default/40";

  return (
    <div
      data-hunk-id={hunk.id}
      ref={isFocused ? focusedHunkRef : undefined}
      className={`@container flex items-center gap-2 overflow-x-auto px-3 py-1.5 mx-2 my-1.5 rounded-lg shadow-depth transition-[border-color,box-shadow] duration-150 ${borderClass} ${getHunkBackgroundClass(reviewStatus)}`}
    >
      {/* Move pair indicator */}
      {pairedHunk && (
        <MovePairModal
          currentHunk={hunk}
          pairedHunk={pairedHunk}
          isSource={isSource}
          hunkStates={allHunkStates}
          onApprovePair={onApprovePair}
          onRejectPair={onRejectPair}
          onNavigateToHunk={onNavigateToHunk}
        />
      )}

      {/* Action buttons - grouped with keyboard shortcuts */}
      {isApproved ? (
        <SimpleTooltip content="Click to unapprove">
          <button
            onClick={() => onUnapprove(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-status-approved/20 px-2.5 py-1 text-xs font-medium text-status-approved transition-colors hover:bg-status-approved/30 inset-ring-1 inset-ring-status-approved/30 animate-in fade-in zoom-in-95 duration-200"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M5 13l4 4L19 7"
              />
            </svg>
            <span className="hidden @md:inline">Approved</span>
          </button>
        </SimpleTooltip>
      ) : isRejected ? (
        <SimpleTooltip content="Click to clear rejection">
          <button
            onClick={() => onUnreject(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-status-rejected/20 px-2.5 py-1 text-xs font-medium text-status-rejected transition-colors hover:bg-status-rejected/30 inset-ring-1 inset-ring-status-rejected/30 animate-in fade-in zoom-in-95 duration-200"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span className="hidden @md:inline">Rejected</span>
          </button>
        </SimpleTooltip>
      ) : isSavedForLater ? (
        <SimpleTooltip content="Click to clear saved for later">
          <button
            onClick={() => onUnsaveForLater(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-status-modified/20 px-2.5 py-1 text-xs font-medium text-status-modified transition-colors hover:bg-status-modified/30 inset-ring-1 inset-ring-status-modified/30 animate-in fade-in zoom-in-95 duration-200"
          >
            <svg
              className="h-3.5 w-3.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="hidden @md:inline">Saved for Later</span>
          </button>
        </SimpleTooltip>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <SimpleTooltip
            content={`Approve this change (a)${isTrusted ? " (optional)" : ""}`}
          >
            <button
              onClick={() => onApprove(hunk.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors active:scale-95 ${
                isTrusted
                  ? "text-fg-muted/50 bg-surface-hover/20 hover:bg-status-approved/20 hover:text-status-approved"
                  : "text-status-approved bg-status-approved/10 hover:bg-status-approved/20 hover:text-status-approved"
              }`}
              aria-label="Approve change"
            >
              <svg
                className={`h-3 w-3${isTrusted ? " opacity-50" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
              <span className="hidden @md:inline">Approve</span>
              {isFocused && (
                <kbd className="ml-0.5 text-xxs opacity-60 hidden @md:inline">
                  a
                </kbd>
              )}
            </button>
          </SimpleTooltip>
          <SimpleTooltip
            content={`Reject this change (r)${isTrusted ? " (optional)" : ""}`}
          >
            <button
              onClick={() => onReject(hunk.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors active:scale-95 ${
                isTrusted
                  ? "text-fg-muted/50 bg-surface-hover/20 hover:bg-status-rejected/20 hover:text-status-rejected"
                  : "text-status-rejected bg-status-rejected/10 hover:bg-status-rejected/20 hover:text-status-rejected"
              }`}
              aria-label="Reject change"
            >
              <svg
                className={`h-3 w-3${isTrusted ? " opacity-50" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              <span className="hidden @md:inline">Reject</span>
              {isFocused && (
                <kbd className="ml-0.5 text-xxs opacity-60 hidden @md:inline">
                  r
                </kbd>
              )}
            </button>
          </SimpleTooltip>
          <SimpleTooltip content="Save for later (s)">
            <button
              onClick={() => onSaveForLater(hunk.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors active:scale-95 ${
                isTrusted
                  ? "text-fg-muted/50 bg-surface-hover/20 hover:bg-status-modified/20 hover:text-status-modified"
                  : "text-status-modified bg-status-modified/10 hover:bg-status-modified/20 hover:text-status-modified"
              }`}
              aria-label="Save for later"
            >
              <svg
                className={`h-3 w-3${isTrusted ? " opacity-50" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="hidden @md:inline">Later</span>
              {isFocused && (
                <kbd className="ml-0.5 text-xxs opacity-60 hidden @md:inline">
                  s
                </kbd>
              )}
            </button>
          </SimpleTooltip>
          {/* Similar hunks modal trigger - "N like this" */}
          <SimilarHunksModal
            currentHunk={hunk}
            similarHunks={similarHunks}
            hunkStates={allHunkStates}
            onApproveAll={onApproveAllSimilar}
            onRejectAll={onRejectAllSimilar}
            onNavigateToHunk={onNavigateToHunk}
          />
        </div>
      )}

      {/* Right side: trust labels, reasoning, overflow menu */}
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {/* Trust labels - click to toggle trust */}
        {hunkState?.label && hunkState.label.length > 0 && (
          <div className="flex items-center gap-1.5">
            <SimpleTooltip
              content={
                hunkState.classifiedVia === "static"
                  ? "Classified by rules"
                  : "Classified"
              }
            >
              <span className="flex items-center">
                <svg
                  className="h-3 w-3 text-fg-muted"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
              </span>
            </SimpleTooltip>
            {hunkState.label.map((lbl, i) => {
              const isTrustedLabel = trustList.includes(lbl);
              return (
                <SimpleTooltip
                  key={i}
                  content={`${isTrustedLabel ? "Click to untrust" : "Click to trust"} "${lbl}"`}
                >
                  <button
                    onClick={() => {
                      if (isTrustedLabel) {
                        onRemoveTrustPattern(lbl);
                      } else {
                        onAddTrustPattern(lbl);
                      }
                    }}
                    className={`rounded px-1.5 py-0.5 text-xxs font-medium cursor-pointer transition-colors hover:ring-1 ${
                      isTrustedLabel
                        ? "bg-status-renamed/15 text-status-renamed hover:ring-status-renamed/50"
                        : "bg-surface-hover/50 text-fg-muted hover:ring-fg-muted/50"
                    }`}
                  >
                    {lbl}
                  </button>
                </SimpleTooltip>
              );
            })}
          </div>
        )}

        {/* Reasoning indicator - shows when reasoning exists */}
        {hunkState?.reasoning && (
          <SimpleTooltip content={hunkState.reasoning}>
            <span className="text-fg-faint hover:text-fg-muted cursor-help transition-colors">
              <svg
                className="h-3 w-3"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z"
                />
              </svg>
            </span>
          </SimpleTooltip>
        )}

        {/* Overflow menu */}
        <div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg-secondary transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring/50"
                aria-label="More options"
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 6.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 12.75a.75.75 0 110-1.5.75.75 0 010 1.5zM12 18.75a.75.75 0 110-1.5.75.75 0 010 1.5z"
                  />
                </svg>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {onViewInFile && (
                <DropdownMenuItem
                  onClick={() => {
                    // Find first changed line to jump to
                    const firstChanged = hunk.lines.find(
                      (l) => l.type === "added" || l.type === "removed",
                    );
                    const targetLine =
                      firstChanged?.newLineNumber ?? hunk.newStart;
                    onViewInFile(targetLine);
                  }}
                >
                  <svg
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
                    />
                  </svg>
                  View in file
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => onReclassifyHunks([hunk.id])}>
                <svg
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
                Reclassify
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onCopyHunk(hunk)}>
                <svg
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
                Copy hunk
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Hunk position with j/k hints */}
        {hunkPosition !== undefined &&
          totalHunksInFile !== undefined &&
          totalHunksInFile > 1 && (
            <div className="flex items-center gap-1 text-fg-faint select-none">
              {isFocused && (
                <button
                  onClick={() => useReviewStore.getState().prevHunk()}
                  className="hover:text-fg-secondary transition-colors"
                  aria-label="Previous hunk"
                >
                  <kbd className="text-fg-faint">k</kbd>
                </button>
              )}
              <span className="text-xxs tabular-nums">
                {hunkPosition}/{totalHunksInFile}
              </span>
              {isFocused && (
                <button
                  onClick={() => useReviewStore.getState().nextHunk()}
                  className="hover:text-fg-secondary transition-colors"
                  aria-label="Next hunk"
                >
                  <kbd className="text-fg-faint">j</kbd>
                </button>
              )}
            </div>
          )}
      </div>
    </div>
  );
}
