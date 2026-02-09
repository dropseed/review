import { useState, useMemo } from "react";
import type { DiffHunk, HunkState } from "../../../types";
import { isHunkTrusted } from "../../../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../../ui/dialog";
import { SimpleTooltip } from "../../ui/tooltip";

/**
 * Group hunks by file path, filtered to files matching a given basename.
 * Returns a Map of filePath → DiffHunk[].
 * Designed so matching logic can be swapped to glob later.
 */
export function getFilesByBasename(
  hunks: DiffHunk[],
  basename: string,
): Map<string, DiffHunk[]> {
  const map = new Map<string, DiffHunk[]>();
  for (const hunk of hunks) {
    const name = hunk.filePath.split("/").pop();
    if (name === basename) {
      const arr = map.get(hunk.filePath) ?? [];
      arr.push(hunk);
      map.set(hunk.filePath, arr);
    }
  }
  return map;
}

/** Status indicator with colored dot */
export function StatusIndicator({
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

/** Per-file review progress badge */
export function FileProgress({
  approved,
  rejected,
  total,
}: {
  approved: number;
  rejected: number;
  total: number;
}) {
  const reviewed = approved + rejected;
  const isComplete = reviewed === total;
  const badgeClass = isComplete
    ? "bg-emerald-500/15 text-emerald-300"
    : "bg-amber-500/15 text-amber-300";

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xxs font-medium tabular-nums ${badgeClass}`}
    >
      {reviewed}/{total}
    </span>
  );
}

/** Count approved/rejected/total for a set of hunks */
export function getFileProgress(
  fileHunks: DiffHunk[],
  hunkStates: Record<string, HunkState | undefined>,
  trustList: string[],
) {
  let approved = 0;
  let rejected = 0;
  for (const h of fileHunks) {
    const state = hunkStates[h.id];
    if (state?.status === "approved") approved++;
    else if (state?.status === "rejected") rejected++;
    else if (isHunkTrusted(state, trustList)) approved++;
  }
  return { approved, rejected, total: fileHunks.length };
}

interface SimilarFilesModalProps {
  /** Current file being viewed (highlighted in the list) */
  currentFilePath: string;
  /** All hunks in the diff (used to find matching files) */
  hunks: DiffHunk[];
  /** Hunk states for computing review progress */
  hunkStates: Record<string, HunkState | undefined>;
  /** Trust list for determining trusted status */
  trustList: string[];
  /** Callback to approve hunk IDs */
  onApproveAll: (hunkIds: string[]) => void;
  /** Callback to reject hunk IDs */
  onRejectAll: (hunkIds: string[]) => void;
  /** Callback to navigate to a file */
  onNavigateToFile?: (filePath: string) => void;
  /** Controlled open state (for sidebar entry point) */
  open?: boolean;
  /** Controlled open change handler */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Modal for viewing and batch-acting on files sharing the same basename.
 * Uses compound pattern with built-in trigger button.
 */
export function SimilarFilesModal({
  currentFilePath,
  hunks,
  hunkStates,
  trustList,
  onApproveAll,
  onRejectAll,
  onNavigateToFile,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: SimilarFilesModalProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled
    ? (v: boolean) => controlledOnOpenChange?.(v)
    : setInternalOpen;

  const basename = currentFilePath.split("/").pop() ?? "";

  // Group hunks by file path for files matching this basename
  const matchingFiles = useMemo(
    () => getFilesByBasename(hunks, basename),
    [hunks, basename],
  );

  const filePaths = useMemo(
    () => Array.from(matchingFiles.keys()),
    [matchingFiles],
  );
  const otherFilePaths = filePaths.filter((p) => p !== currentFilePath);
  const totalFileCount = filePaths.length;

  // Collect all hunk IDs across matching files
  const allHunkIds = useMemo(() => {
    const ids: string[] = [];
    for (const fileHunks of matchingFiles.values()) {
      for (const h of fileHunks) ids.push(h.id);
    }
    return ids;
  }, [matchingFiles]);

  // Count hunks by status across all matching files
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const id of allHunkIds) {
    const state = hunkStates[id];
    if (state?.status === "approved") approvedCount++;
    else if (state?.status === "rejected") rejectedCount++;
    else if (isHunkTrusted(state, trustList)) approvedCount++;
  }
  const pendingCount = allHunkIds.length - approvedCount - rejectedCount;

  // Don't render trigger if there are no other files sharing this name
  if (otherFilePaths.length === 0 && !isControlled) {
    return null;
  }

  const handleApproveAll = () => {
    onApproveAll(allHunkIds);
    setOpen(false);
  };

  const handleRejectAll = () => {
    onRejectAll(allHunkIds);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Trigger button - only render when uncontrolled */}
      {!isControlled && (
        <SimpleTooltip content={`${totalFileCount} files named "${basename}"`}>
          <button
            onClick={() => setOpen(true)}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xxs text-stone-500 transition-all hover:bg-stone-700/50 hover:text-stone-300"
          >
            <span className="tabular-nums">
              {totalFileCount} {basename}
            </span>
          </button>
        </SimpleTooltip>
      )}

      <DialogContent
        className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg"
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Similar Files</span>
            <span className="rounded-full bg-stone-700/50 px-2 py-0.5 text-xs font-normal text-stone-400 tabular-nums">
              {totalFileCount} files
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

        {/* Scrollable file list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 scrollbar-thin">
          {/* Current file first, highlighted */}
          {matchingFiles.has(currentFilePath) && (
            <div>
              <div className="flex items-center gap-2 mb-1.5">
                <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-xxs font-medium text-amber-400">
                  Current
                </span>
              </div>
              <FileRow
                filePath={currentFilePath}
                progress={getFileProgress(
                  matchingFiles.get(currentFilePath)!,
                  hunkStates,
                  trustList,
                )}
                highlighted
              />
            </div>
          )}

          {/* Divider */}
          {otherFilePaths.length > 0 && (
            <div className="flex items-center gap-3 py-1">
              <div className="flex-1 border-t border-stone-700/50" />
              <span className="text-xxs text-stone-600">
                {otherFilePaths.length} other
                {otherFilePaths.length === 1 ? "" : "s"}
              </span>
              <div className="flex-1 border-t border-stone-700/50" />
            </div>
          )}

          {/* Other files */}
          {otherFilePaths.map((filePath) => (
            <div
              key={filePath}
              className="group relative"
              onClick={() => {
                onNavigateToFile?.(filePath);
                setOpen(false);
              }}
            >
              <FileRow
                filePath={filePath}
                progress={getFileProgress(
                  matchingFiles.get(filePath)!,
                  hunkStates,
                  trustList,
                )}
              />
              {onNavigateToFile && (
                <button
                  className="absolute top-2 right-2 rounded bg-stone-700/80 px-2 py-1 text-xxs text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-stone-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNavigateToFile(filePath);
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
            Applies to all {allHunkIds.length} hunks across {totalFileCount}{" "}
            files
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRejectAll}
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
              Reject All
            </button>
            <button
              onClick={handleApproveAll}
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
              Approve All
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A single file row showing path and review progress */
export function FileRow({
  filePath,
  progress,
  highlighted,
}: {
  filePath: string;
  progress: { approved: number; rejected: number; total: number };
  highlighted?: boolean;
}) {
  // Show directory path dimmed, filename normal
  const parts = filePath.split("/");
  const fileName = parts.pop()!;
  const dirPath = parts.join("/");

  return (
    <div
      className={`flex items-center gap-2 rounded-md border px-3 py-2 ${
        highlighted
          ? "border-amber-500/30 bg-amber-500/5"
          : "border-stone-700/50 bg-stone-800/30 cursor-pointer hover:border-stone-600 hover:bg-stone-800/50"
      }`}
    >
      {/* File icon */}
      <svg
        className="h-3.5 w-3.5 shrink-0 text-stone-500"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z"
        />
      </svg>

      {/* File path */}
      <div className="min-w-0 flex-1 truncate text-xs">
        {dirPath && <span className="text-stone-600">{dirPath}/</span>}
        <span className="text-stone-300">{fileName}</span>
      </div>

      {/* Review progress */}
      <FileProgress
        approved={progress.approved}
        rejected={progress.rejected}
        total={progress.total}
      />
    </div>
  );
}
