import { useState, useMemo } from "react";
import type { DiffHunk, HunkState } from "../../types";
import { isHunkTrusted } from "../../types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../ui/dialog";
import {
  getFilesByBasename,
  getFileProgress,
  StatusIndicator,
  FileRow,
} from "../FileViewer/annotations/SimilarFilesModal";

interface FilenameModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "approve" | "unapprove";
  hunks: DiffHunk[];
  hunkStates: Record<string, HunkState | undefined>;
  trustList: string[];
  onApproveAll: (hunkIds: string[]) => void;
  onRejectAll: (hunkIds: string[]) => void;
  onUnapproveAll: (hunkIds: string[]) => void;
  onNavigateToFile?: (filePath: string) => void;
}

/**
 * Modal for approving/unapproving files by filename pattern.
 * Shows a text input for typing a filename with live-updating file list.
 */
export function FilenameModal({
  open,
  onOpenChange,
  mode,
  hunks,
  hunkStates,
  trustList,
  onApproveAll,
  onRejectAll,
  onUnapproveAll,
  onNavigateToFile,
}: FilenameModalProps) {
  const [query, setQuery] = useState("");
  const [selectedBasename, setSelectedBasename] = useState<string | null>(null);

  // Get all unique basenames that appear in 2+ files
  const availableBasenames = useMemo(() => {
    const nameToFiles = new Map<string, Set<string>>();
    for (const hunk of hunks) {
      const name = hunk.filePath.split("/").pop() ?? "";
      const set = nameToFiles.get(name) ?? new Set();
      set.add(hunk.filePath);
      nameToFiles.set(name, set);
    }
    const result: { name: string; fileCount: number }[] = [];
    for (const [name, files] of nameToFiles) {
      if (files.size >= 2) {
        result.push({ name, fileCount: files.size });
      }
    }
    return result.sort((a, b) => b.fileCount - a.fileCount);
  }, [hunks]);

  // Filter basenames by query
  const filteredBasenames = useMemo(() => {
    if (!query.trim()) return availableBasenames;
    const q = query.toLowerCase();
    return availableBasenames.filter((b) => b.name.toLowerCase().includes(q));
  }, [availableBasenames, query]);

  // Matching files for selected basename
  const matchingFiles = useMemo(() => {
    if (!selectedBasename) return new Map<string, DiffHunk[]>();
    return getFilesByBasename(hunks, selectedBasename);
  }, [hunks, selectedBasename]);

  const filePaths = useMemo(
    () => Array.from(matchingFiles.keys()),
    [matchingFiles],
  );

  // Collect all hunk IDs across matching files
  const allHunkIds = useMemo(() => {
    const ids: string[] = [];
    for (const fileHunks of matchingFiles.values()) {
      for (const h of fileHunks) ids.push(h.id);
    }
    return ids;
  }, [matchingFiles]);

  // Count hunks by status
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const id of allHunkIds) {
    const state = hunkStates[id];
    if (state?.status === "approved") approvedCount++;
    else if (state?.status === "rejected") rejectedCount++;
    else if (isHunkTrusted(state, trustList)) approvedCount++;
  }
  const pendingCount = allHunkIds.length - approvedCount - rejectedCount;

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) {
      setSelectedBasename(null);
      setQuery("");
    }
  };

  const handleBatchAction = (actionFn: (ids: string[]) => void) => {
    actionFn(allHunkIds);
    handleClose(false);
  };

  const title =
    mode === "approve" ? "Approve by Filename" : "Unapprove by Filename";

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg"
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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

        {/* Search input */}
        <div className="border-b border-stone-800 px-4 py-2">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedBasename(null);
            }}
            placeholder="Search filenames…"
            className="w-full rounded-md border border-stone-700 bg-stone-800/50 px-3 py-1.5 text-sm text-stone-200 placeholder:text-stone-500 focus:border-amber-500/50 focus:outline-none focus:ring-1 focus:ring-amber-500/50"
            autoFocus
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!selectedBasename ? (
            /* Basename list */
            <div className="p-4 space-y-1">
              {filteredBasenames.length === 0 ? (
                <p className="text-center text-xs text-stone-500 py-4">
                  {query
                    ? "No matching filenames found"
                    : "No filenames appear in multiple files"}
                </p>
              ) : (
                filteredBasenames.map((b) => (
                  <button
                    key={b.name}
                    onClick={() => setSelectedBasename(b.name)}
                    className="flex w-full items-center gap-2 rounded-md border border-stone-700/50 bg-stone-800/30 px-3 py-2 text-left hover:border-stone-600 hover:bg-stone-800/50 transition-colors"
                  >
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
                    <span className="flex-1 text-xs text-stone-300">
                      {b.name}
                    </span>
                    <span className="rounded-full bg-stone-700/50 px-1.5 py-0.5 text-xxs text-stone-400 tabular-nums">
                      {b.fileCount} files
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : (
            /* File list for selected basename */
            <div className="p-4 space-y-2">
              {/* Back button */}
              <button
                onClick={() => setSelectedBasename(null)}
                className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200 transition-colors mb-2"
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
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
                Back to filenames
              </button>

              {/* Status summary */}
              <div className="flex items-center gap-4 text-xs mb-2">
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

              {/* File rows */}
              {filePaths.map((filePath) => (
                <div
                  key={filePath}
                  className="group relative"
                  onClick={() => {
                    onNavigateToFile?.(filePath);
                    handleClose(false);
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
                        handleClose(false);
                      }}
                    >
                      Go to file
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Action footer - only shown when a basename is selected */}
        {selectedBasename && allHunkIds.length > 0 && (
          <div className="flex items-center justify-between border-t border-stone-800 px-4 py-3 bg-stone-900/50">
            <div className="text-xs text-stone-500">
              Applies to all {allHunkIds.length} hunks across {filePaths.length}{" "}
              files
            </div>
            <div className="flex items-center gap-2">
              {mode === "approve" ? (
                <>
                  <button
                    onClick={() => handleBatchAction(onRejectAll)}
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
                    onClick={() => handleBatchAction(onApproveAll)}
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
                </>
              ) : (
                <button
                  onClick={() => handleBatchAction(onUnapproveAll)}
                  className="flex items-center gap-1.5 rounded-md bg-stone-700 px-3 py-1.5 text-sm font-medium text-stone-300 transition-colors hover:bg-stone-600 active:scale-[0.98]"
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
                      d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                    />
                  </svg>
                  Unapprove All
                </button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
