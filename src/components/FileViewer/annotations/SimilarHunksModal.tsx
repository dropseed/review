import { useState } from "react";
import type { DiffHunk, HunkState } from "../../../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../../ui/dialog";
import { SimpleTooltip } from "../../ui/tooltip";
import { HunkPreview } from "./HunkPreview";

interface SimilarHunksModalProps {
  /** The current hunk being viewed */
  currentHunk: DiffHunk;
  /** All hunks with identical changes */
  similarHunks: DiffHunk[];
  /** Hunk states for showing approval status */
  hunkStates: Record<string, HunkState | undefined>;
  /** Callback to approve all hunks */
  onApproveAll: (hunkIds: string[]) => void;
  /** Callback to reject all hunks */
  onRejectAll: (hunkIds: string[]) => void;
  /** Callback when user wants to navigate to a specific hunk */
  onNavigateToHunk?: (hunkId: string) => void;
}

/** Status indicator with colored dot */
function StatusIndicator({
  count,
  label,
  variant,
}: {
  count: number;
  label: string;
  variant: "pending" | "approved" | "rejected";
}) {
  if (count === 0) return null;

  const colors = {
    pending: { dot: "bg-stone-500", text: "text-stone-400" },
    approved: { dot: "bg-emerald-500", text: "text-emerald-400" },
    rejected: { dot: "bg-rose-500", text: "text-rose-400" },
  };

  const { dot, text } = colors[variant];

  return (
    <span className={`flex items-center gap-1.5 ${text}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {count} {label}
    </span>
  );
}

/**
 * Modal for viewing and batch-acting on similar hunks.
 * Uses compound pattern with trigger button built-in.
 */
export function SimilarHunksModal({
  currentHunk,
  similarHunks,
  hunkStates,
  onApproveAll,
  onRejectAll,
  onNavigateToHunk,
}: SimilarHunksModalProps) {
  const [open, setOpen] = useState(false);

  const otherHunks = similarHunks.filter((h) => h.id !== currentHunk.id);
  const totalCount = similarHunks.length;

  // Count hunks by status in a single pass
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const h of similarHunks) {
    const status = hunkStates[h.id]?.status;
    if (status === "approved") approvedCount++;
    else if (status === "rejected") rejectedCount++;
  }
  const pendingCount = totalCount - approvedCount - rejectedCount;

  // Don't render if there are no similar hunks
  if (otherHunks.length === 0) {
    return null;
  }

  const handleApproveAll = () => {
    onApproveAll(similarHunks.map((h) => h.id));
    setOpen(false);
  };

  const handleRejectAll = () => {
    onRejectAll(similarHunks.map((h) => h.id));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Trigger button - subtle "N like this" indicator */}
      <SimpleTooltip content={`${totalCount} identical changes across files`}>
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xxs text-stone-500 transition-colors hover:bg-stone-700/50 hover:text-stone-300"
        >
          <span className="tabular-nums">{totalCount} identical</span>
        </button>
      </SimpleTooltip>

      <DialogContent
        className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg"
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Identical Changes</span>
            <span className="rounded-full bg-stone-700/50 px-2 py-0.5 text-xs font-normal text-stone-400 tabular-nums">
              {totalCount} hunks
            </span>
          </DialogTitle>
          <DialogClose className="rounded p-1 text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors">
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </DialogClose>
        </DialogHeader>

        {/* Status summary */}
        <div className="flex items-center gap-4 border-b border-stone-800 px-4 py-2 text-xs">
          <StatusIndicator
            count={pendingCount}
            label="pending"
            variant="pending"
          />
          <StatusIndicator
            count={approvedCount}
            label="approved"
            variant="approved"
          />
          <StatusIndicator
            count={rejectedCount}
            label="rejected"
            variant="rejected"
          />
        </div>

        {/* Scrollable list of hunk previews */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {/* Current hunk first, highlighted */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xxs font-medium text-amber-400">
                Current
              </span>
            </div>
            <HunkPreview
              hunk={currentHunk}
              hunkState={hunkStates[currentHunk.id]}
              highlighted
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 border-t border-stone-700/50" />
            <span className="text-xxs text-stone-600">
              {otherHunks.length} other{otherHunks.length === 1 ? "" : "s"}
            </span>
            <div className="flex-1 border-t border-stone-700/50" />
          </div>

          {/* Other hunks */}
          {otherHunks.map((hunk) => (
            <div
              key={hunk.id}
              className="group relative"
              onClick={() => onNavigateToHunk?.(hunk.id)}
            >
              <HunkPreview hunk={hunk} hunkState={hunkStates[hunk.id]} />
              {onNavigateToHunk && (
                <button
                  className="absolute top-2 right-2 rounded bg-stone-700/80 px-2 py-1 text-xxs text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-stone-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToHunk(hunk.id);
                    setOpen(false);
                  }}
                >
                  Go to file
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Action footer */}
        <div className="flex items-center justify-between border-t border-stone-800 px-4 py-3 bg-stone-900/50">
          <div className="text-xs text-stone-500">
            Batch action applies to all {totalCount} hunks
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRejectAll}
              className="flex items-center gap-1.5 rounded-md bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-400 transition-colors hover:bg-rose-500/25 active:scale-[0.98]"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Reject All
            </button>
            <button
              onClick={handleApproveAll}
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-300 transition-colors hover:bg-emerald-500/30 active:scale-[0.98]"
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
                  d="M5 13l4 4L19 7"
                />
              </svg>
              Approve All
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
