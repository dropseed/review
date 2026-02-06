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

interface MovePairModalProps {
  /** The current hunk being viewed */
  currentHunk: DiffHunk;
  /** The paired hunk (other side of the move) */
  pairedHunk: DiffHunk;
  /** Whether the current hunk is the source (removed) side */
  isSource: boolean;
  /** Hunk states for showing approval status */
  hunkStates: Record<string, HunkState | undefined>;
  /** Callback to approve both hunks in the pair */
  onApprovePair: (hunkIds: string[]) => void;
  /** Callback to reject both hunks in the pair */
  onRejectPair: (hunkIds: string[]) => void;
  /** Callback when user wants to navigate to the paired hunk */
  onNavigateToHunk?: (hunkId: string) => void;
}

export function MovePairModal({
  currentHunk,
  pairedHunk,
  isSource,
  hunkStates,
  onApprovePair,
  onRejectPair,
  onNavigateToHunk,
}: MovePairModalProps) {
  const [open, setOpen] = useState(false);

  const sourceHunk = isSource ? currentHunk : pairedHunk;
  const destHunk = isSource ? pairedHunk : currentHunk;

  const handleApprovePair = () => {
    onApprovePair([currentHunk.id, pairedHunk.id]);
    setOpen(false);
  };

  const handleRejectPair = () => {
    onRejectPair([currentHunk.id, pairedHunk.id]);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Trigger: pill with clickable file name for navigation + expand button for modal */}
      <div className="flex items-center gap-0 rounded-full bg-sky-500/15 text-xs font-medium text-sky-400">
        {/* Navigate to paired hunk */}
        <SimpleTooltip
          content={`Jump to ${isSource ? "destination" : "source"} in ${pairedHunk.filePath}`}
        >
          <button
            onClick={() => onNavigateToHunk?.(pairedHunk.id)}
            className="flex items-center gap-1.5 rounded-l-full py-0.5 pl-2 pr-1.5 transition-all hover:bg-sky-500/25"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              {isSource ? (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                />
              ) : (
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                />
              )}
            </svg>
            <span>{isSource ? "Moved to" : "Moved from"}</span>
            <span className="opacity-60">
              {pairedHunk.filePath.split("/").pop()}
            </span>
          </button>
        </SimpleTooltip>
        {/* Open modal for details + batch approve/reject */}
        <SimpleTooltip content="View move pair details">
          <button
            onClick={() => setOpen(true)}
            className="flex items-center rounded-r-full py-0.5 pr-2 pl-1 transition-all hover:bg-sky-500/25"
          >
            <svg
              className="h-3 w-3"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9"
              />
            </svg>
          </button>
        </SimpleTooltip>
      </div>

      <DialogContent
        className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg"
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Move Pair</span>
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

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {/* Source (removed) side */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="rounded bg-rose-500/20 px-1.5 py-0.5 text-xxs font-medium text-rose-400">
                Removed from
              </span>
              <span className="text-xs text-stone-400 truncate">
                {sourceHunk.filePath}
              </span>
            </div>
            <HunkPreview
              hunk={sourceHunk}
              hunkState={hunkStates[sourceHunk.id]}
              highlighted={sourceHunk.id === currentHunk.id}
            />
          </div>

          {/* Arrow divider */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 border-t border-stone-700/50" />
            <svg
              className="h-4 w-4 text-sky-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3"
              />
            </svg>
            <div className="flex-1 border-t border-stone-700/50" />
          </div>

          {/* Destination (added) side */}
          <div className="group relative">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-xxs font-medium text-emerald-400">
                Added to
              </span>
              <span className="text-xs text-stone-400 truncate">
                {destHunk.filePath}
              </span>
            </div>
            <HunkPreview
              hunk={destHunk}
              hunkState={hunkStates[destHunk.id]}
              highlighted={destHunk.id === currentHunk.id}
            />
            {onNavigateToHunk && pairedHunk.id === destHunk.id && (
              <button
                className="absolute top-8 right-2 rounded bg-stone-700/80 px-2 py-1 text-xxs text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-stone-600"
                onClick={() => {
                  onNavigateToHunk(pairedHunk.id);
                  setOpen(false);
                }}
              >
                Go to file
              </button>
            )}
          </div>
        </div>

        {/* Action footer */}
        <div className="flex items-center justify-between border-t border-stone-800 px-4 py-3 bg-stone-900/50">
          <div className="flex items-center gap-2">
            {onNavigateToHunk && (
              <button
                onClick={() => {
                  onNavigateToHunk(pairedHunk.id);
                  setOpen(false);
                }}
                className="flex items-center gap-1.5 rounded-md bg-stone-700/50 px-3 py-1.5 text-sm text-stone-300 transition-all hover:bg-stone-700 active:scale-[0.98]"
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
                    d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                  />
                </svg>
                Go to paired file
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRejectPair}
              className="flex items-center gap-1.5 rounded-md bg-rose-500/15 px-3 py-1.5 text-sm font-medium text-rose-400 transition-all hover:bg-rose-500/25 active:scale-[0.98]"
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
              Reject Pair
            </button>
            <button
              onClick={handleApprovePair}
              className="flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-3 py-1.5 text-sm font-medium text-emerald-300 transition-all hover:bg-emerald-500/30 active:scale-[0.98]"
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
              Approve Pair
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
