import type { MutableRefObject } from "react";
import type { DiffHunk, HunkState } from "../../../types";
import { isHunkTrusted } from "../../../types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "../../ui/dropdown-menu";
import { SimpleTooltip } from "../../ui/tooltip";
import { getFirstChangedLine } from "../hunkUtils";
import { MovePairModal } from "./MovePairModal";
import { SimilarHunksModal } from "./SimilarHunksModal";

/** Returns the appropriate background class for a hunk based on its state */
function getHunkBackgroundClass(
  isRejected: boolean,
  isApproved: boolean,
  isTrusted: boolean,
): string {
  if (isRejected) return "bg-rose-500/10";
  if (isApproved) return "bg-emerald-500/5";
  if (isTrusted) return "bg-sky-500/5";
  return "bg-stone-800/80";
}

interface HunkAnnotationPanelProps {
  hunk: DiffHunk;
  hunkState: HunkState | undefined;
  pairedHunk: DiffHunk | null;
  isSource: boolean;
  focusedHunkId: string | null | undefined;
  focusedHunkRef: MutableRefObject<HTMLDivElement | null>;
  trustList: string[];
  classifyingHunkIds: Set<string>;
  claudeAvailable: boolean | null;
  hunkPosition?: number; // 1-indexed position in file
  totalHunksInFile?: number;
  // Similar hunks data for "N like this" modal
  similarHunks: DiffHunk[];
  allHunkStates: Record<string, HunkState | undefined>;
  onApprove: (hunkId: string) => void;
  onUnapprove: (hunkId: string) => void;
  onReject: (hunkId: string) => void;
  onUnreject: (hunkId: string) => void;
  onApprovePair: (hunkIds: string[]) => void;
  onRejectPair: (hunkIds: string[]) => void;
  onComment: (lineNumber: number, side: "old" | "new", hunkId: string) => void;
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
  classifyingHunkIds,
  claudeAvailable,
  hunkPosition,
  totalHunksInFile,
  similarHunks,
  allHunkStates,
  onApprove,
  onUnapprove,
  onReject,
  onUnreject,
  onApprovePair,
  onRejectPair,
  onComment,
  onAddTrustPattern,
  onRemoveTrustPattern,
  onReclassifyHunks,
  onCopyHunk,
  onViewInFile,
  onApproveAllSimilar,
  onRejectAllSimilar,
  onNavigateToHunk,
}: HunkAnnotationPanelProps) {
  const isApproved = hunkState?.status === "approved";
  const isRejected = hunkState?.status === "rejected";
  const isTrusted = !hunkState?.status && isHunkTrusted(hunkState, trustList);
  const isFocused = hunk.id === focusedHunkId;

  return (
    <div
      data-hunk-id={hunk.id}
      ref={isFocused ? focusedHunkRef : undefined}
      className={`flex items-center gap-2 px-3 py-1.5 border-t border-stone-700/50 ${
        isFocused
          ? "border-l-[2px] border-l-white/50 border-b-[1px] border-b-white/30"
          : ""
      } ${getHunkBackgroundClass(isRejected, isApproved, isTrusted)}`}
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
            className="group flex items-center gap-1.5 rounded-md bg-emerald-500/20 px-2.5 py-1 text-xs font-medium text-emerald-300 transition-all hover:bg-emerald-500/30 inset-ring-1 inset-ring-emerald-500/30"
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
            <span>Approved</span>
          </button>
        </SimpleTooltip>
      ) : isRejected ? (
        <SimpleTooltip content="Click to clear rejection">
          <button
            onClick={() => onUnreject(hunk.id)}
            className="group flex items-center gap-1.5 rounded-md bg-rose-500/20 px-2.5 py-1 text-xs font-medium text-rose-300 transition-all hover:bg-rose-500/30 inset-ring-1 inset-ring-rose-500/30"
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
            <span>Rejected</span>
          </button>
        </SimpleTooltip>
      ) : (
        <div className="flex items-center gap-1">
          <SimpleTooltip
            content={`Reject this change (r)${isTrusted ? " (optional)" : ""}`}
          >
            <button
              onClick={() => onReject(hunk.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all ${
                isTrusted
                  ? "text-stone-500/50 bg-stone-700/20 hover:bg-rose-500/20 hover:text-rose-400"
                  : "text-rose-300 bg-rose-500/10 hover:bg-rose-500/20 hover:text-rose-300"
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
              <span>Reject</span>
              {isFocused && <kbd className="ml-0.5 text-xxs opacity-60">r</kbd>}
            </button>
          </SimpleTooltip>
          <SimpleTooltip
            content={`Approve this change (a)${isTrusted ? " (optional)" : ""}`}
          >
            <button
              onClick={() => onApprove(hunk.id)}
              className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-all ${
                isTrusted
                  ? "text-stone-500/50 bg-stone-700/20 hover:bg-emerald-500/20 hover:text-emerald-400"
                  : "text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 hover:text-emerald-300"
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
              <span>Approve</span>
              {isFocused && <kbd className="ml-0.5 text-xxs opacity-60">a</kbd>}
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

      {/* Comment button - inline after approve/reject */}
      <SimpleTooltip content="Add comment">
        <button
          onClick={() => {
            const { lineNumber, side } = getFirstChangedLine(hunk);
            onComment(lineNumber, side, hunk.id);
          }}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-stone-500 transition-all hover:bg-stone-700/50 hover:text-stone-300"
        >
          <svg
            className="h-3.5 w-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"
            />
          </svg>
          <span className="hidden sm:inline">Comment</span>
        </button>
      </SimpleTooltip>

      {/* Right side: classifying indicator, trust labels, reasoning, overflow menu */}
      <div className="ml-auto flex items-center gap-2">
        {/* Classifying indicator - fixed width container to prevent layout shift */}
        <div className="w-[5.5rem] flex justify-end">
          {classifyingHunkIds.has(hunk.id) && (
            <div className="flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5">
              <svg
                className="h-3 w-3 animate-spin text-violet-400"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="3"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <span className="text-xxs text-violet-400">Classifying…</span>
            </div>
          )}
        </div>

        {/* Trust labels - click to toggle trust */}
        {hunkState?.label && hunkState.label.length > 0 && (
          <div className="flex items-center gap-1.5">
            <SimpleTooltip
              content={
                hunkState.classifiedVia === "ai"
                  ? "Classified by AI"
                  : hunkState.classifiedVia === "static"
                    ? "Classified by rules"
                    : "Classified"
              }
            >
              <span className="flex items-center">
                {hunkState.classifiedVia === "ai" ? (
                  <svg
                    className="h-3 w-3 text-violet-400/70"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M12 2l2.09 6.26L20.18 9l-5 4.09L16.54 20 12 16.27 7.46 20l1.36-6.91L3.82 9l6.09-.74L12 2z" />
                  </svg>
                ) : (
                  <svg
                    className="h-3 w-3 text-stone-500"
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
                )}
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
                    className={`rounded px-1.5 py-0.5 text-xxs font-medium cursor-pointer transition-all hover:ring-1 ${
                      isTrustedLabel
                        ? "bg-sky-500/15 text-sky-400 hover:ring-sky-400/50"
                        : "bg-stone-700/50 text-stone-400 hover:ring-stone-400/50"
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
            <span className="text-stone-600 hover:text-stone-400 cursor-help transition-colors">
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
                className="rounded p-1 text-stone-500 hover:bg-stone-700 hover:text-stone-300 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50"
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
              {claudeAvailable && (
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
              )}
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
            <div className="flex items-center gap-1 text-stone-600 select-none">
              {isFocused && <kbd className="text-stone-600">k</kbd>}
              <span className="text-xxs tabular-nums">
                {hunkPosition}/{totalHunksInFile}
              </span>
              {isFocused && <kbd className="text-stone-600">j</kbd>}
            </div>
          )}
      </div>
    </div>
  );
}
