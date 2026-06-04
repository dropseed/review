import { useState, useMemo } from "react";
import type { DiffHunk, HunkState } from "../../types";
import { isHunkTrusted } from "../../types";
import { getFilesByGlob } from "../../utils/glob";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../ui/dialog";
import {
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

interface Suggestion {
  /** The glob/exact pattern this suggestion fills into the input. */
  pattern: string;
  /** Number of distinct files the pattern matches. */
  fileCount: number;
}

/**
 * Modal for approving/unapproving files by filename glob.
 *
 * The text input is a glob pattern (see {@link getFilesByGlob}): a bare name
 * like `index.ts` matches that basename at any depth, `*.test.ts` matches by
 * extension, and a pattern with a slash like `src/**` matches the full path.
 * Matching files update live, and the footer action applies to every hunk in
 * the matched set. Repeated filenames and per-extension globs are offered as
 * clickable suggestions for discoverability.
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
  const [pattern, setPattern] = useState("");

  // Suggestions: repeated basenames and per-extension globs that cover 2+
  // files, so the user can fill the input without knowing glob syntax.
  const suggestions = useMemo(() => {
    const nameToFiles = new Map<string, Set<string>>();
    const extToFiles = new Map<string, Set<string>>();
    for (const hunk of hunks) {
      const name = hunk.filePath.split("/").pop() ?? "";
      addTo(nameToFiles, name, hunk.filePath);
      const dot = name.lastIndexOf(".");
      if (dot > 0) addTo(extToFiles, name.slice(dot), hunk.filePath);
    }
    const repeatedNames = toSuggestions(nameToFiles, (name) => name);
    const extensions = toSuggestions(extToFiles, (ext) => `*${ext}`);
    return { repeatedNames, extensions };
  }, [hunks]);

  // Filter suggestions by the typed text so they stay relevant while refining.
  const visibleSuggestions = useMemo(() => {
    const q = pattern.trim().toLowerCase();
    const filter = (s: Suggestion) => !q || s.pattern.toLowerCase().includes(q);
    return {
      repeatedNames: suggestions.repeatedNames.filter(filter),
      extensions: suggestions.extensions.filter(filter),
    };
  }, [suggestions, pattern]);

  // Files (and their hunks) matched by the current pattern.
  const matchingFiles = useMemo(
    () => getFilesByGlob(hunks, pattern),
    [hunks, pattern],
  );

  const filePaths = useMemo(
    () => Array.from(matchingFiles.keys()),
    [matchingFiles],
  );

  const allHunkIds = useMemo(() => {
    const ids: string[] = [];
    for (const fileHunks of matchingFiles.values()) {
      for (const h of fileHunks) ids.push(h.id);
    }
    return ids;
  }, [matchingFiles]);

  // Count hunks by status across the matched set.
  let approvedCount = 0;
  let rejectedCount = 0;
  for (const id of allHunkIds) {
    const state = hunkStates[id];
    if (state?.status === "approved") approvedCount++;
    else if (state?.status === "rejected") rejectedCount++;
    else if (isHunkTrusted(state, trustList)) approvedCount++;
  }
  const pendingCount = allHunkIds.length - approvedCount - rejectedCount;

  const hasQuery = pattern.trim().length > 0;
  const hasMatches = allHunkIds.length > 0;

  const handleClose = (v: boolean) => {
    onOpenChange(v);
    if (!v) setPattern("");
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
          <DialogClose className="rounded p-1 text-fg-muted hover:bg-surface-hover hover:text-fg-secondary transition-colors">
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

        {/* Glob input */}
        <div className="border-b border-edge px-4 py-2 space-y-1">
          <input
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="Filename or glob — e.g. index.ts, *.test.ts, src/**/*.py"
            className="w-full rounded-md border border-edge-default bg-surface-raised/50 px-3 py-1.5 text-sm font-mono text-fg-secondary placeholder:text-fg-muted placeholder:font-sans focus:border-focus-ring/50 focus:outline-none focus:ring-1 focus:ring-focus-ring/50"
            autoFocus
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
          {hasQuery && (
            <p className="text-xxs text-fg-muted px-0.5">
              {hasMatches
                ? `${allHunkIds.length} hunks across ${filePaths.length} file${
                    filePaths.length === 1 ? "" : "s"
                  }`
                : "No files match this pattern"}
            </p>
          )}
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {hasMatches ? (
            /* Matched file list */
            <div className="p-4 space-y-2">
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
                      className="absolute top-2 right-2 rounded bg-surface-hover/80 px-2 py-1 text-xxs text-fg-secondary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-active"
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
          ) : (
            /* Suggestions — shown until a pattern matches something */
            <SuggestionList
              hasQuery={hasQuery}
              suggestions={visibleSuggestions}
              onPick={setPattern}
            />
          )}
        </div>

        {/* Action footer — only when the pattern matches hunks */}
        {hasMatches && (
          <div className="flex items-center justify-between border-t border-edge px-4 py-3 bg-surface-panel/50">
            <div className="text-xs text-fg-muted">
              Applies to all {allHunkIds.length} hunks across {filePaths.length}{" "}
              files
            </div>
            <div className="flex items-center gap-2">
              {mode === "approve" ? (
                <>
                  <button
                    onClick={() => handleBatchAction(onRejectAll)}
                    className="flex items-center gap-1.5 rounded-md bg-status-rejected/15 px-3 py-1.5 text-sm font-medium text-status-rejected transition-colors hover:bg-status-rejected/25 active:scale-[0.98]"
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
                    className="flex items-center gap-1.5 rounded-md bg-status-approved/20 px-3 py-1.5 text-sm font-medium text-status-approved transition-colors hover:bg-status-approved/30 active:scale-[0.98]"
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
                  className="flex items-center gap-1.5 rounded-md bg-surface-hover px-3 py-1.5 text-sm font-medium text-fg-secondary transition-colors hover:bg-surface-active active:scale-[0.98]"
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

/** Clickable glob suggestions, grouped by repeated names and extensions. */
function SuggestionList({
  hasQuery,
  suggestions,
  onPick,
}: {
  hasQuery: boolean;
  suggestions: { repeatedNames: Suggestion[]; extensions: Suggestion[] };
  onPick: (pattern: string) => void;
}) {
  const { repeatedNames, extensions } = suggestions;
  const isEmpty = repeatedNames.length === 0 && extensions.length === 0;

  if (isEmpty) {
    return (
      <p className="text-center text-xs text-fg-muted py-6">
        {hasQuery
          ? "No matching files or suggestions"
          : "Type a filename or glob to match files"}
      </p>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {repeatedNames.length > 0 && (
        <SuggestionGroup
          label="Repeated filenames"
          items={repeatedNames}
          onPick={onPick}
        />
      )}
      {extensions.length > 0 && (
        <SuggestionGroup
          label="By extension"
          items={extensions}
          onPick={onPick}
        />
      )}
    </div>
  );
}

function SuggestionGroup({
  label,
  items,
  onPick,
}: {
  label: string;
  items: Suggestion[];
  onPick: (pattern: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xxs uppercase tracking-wide text-fg-faint">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((s) => (
          <button
            key={s.pattern}
            onClick={() => onPick(s.pattern)}
            className="flex items-center gap-1.5 rounded-md border border-edge-default/50 bg-surface-raised/30 px-2 py-1 text-xs text-fg-secondary hover:border-edge-strong hover:bg-surface-raised/50 transition-colors"
          >
            <span className="font-mono">{s.pattern}</span>
            <span className="rounded-full bg-surface-hover/50 px-1.5 text-xxs text-fg-muted tabular-nums">
              {s.fileCount}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function addTo(map: Map<string, Set<string>>, key: string, value: string) {
  const set = map.get(key) ?? new Set<string>();
  set.add(value);
  map.set(key, set);
}

/** Keep keys covering 2+ files, mapped to a pattern and sorted by frequency. */
function toSuggestions(
  map: Map<string, Set<string>>,
  toPattern: (key: string) => string,
): Suggestion[] {
  const result: Suggestion[] = [];
  for (const [key, files] of map) {
    if (files.size >= 2) {
      result.push({ pattern: toPattern(key), fileCount: files.size });
    }
  }
  return result.sort((a, b) => b.fileCount - a.fileCount);
}
