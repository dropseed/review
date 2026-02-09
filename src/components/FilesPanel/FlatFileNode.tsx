import { useState, useMemo, useCallback, memo } from "react";
import { StatusLetter, HunkCount } from "./StatusIndicators";
import type { FileHunkStatus } from "./types";
import { ApprovalButtons, type HunkContext } from "./FileNode";
import type { FileSymbolDiff } from "../../types";
import {
  ChangeIndicator,
  ReviewStatusDot,
  sortSymbols,
  collectAllHunkIds,
  getHunkIdsStatus,
  SymbolRow,
} from "../symbols";
import { useReviewData } from "../ReviewDataContext";

function flatFileNameColor(
  isSelected: boolean,
  isComplete: boolean,
  hasRejections: boolean,
): string {
  if (isSelected) return "text-stone-100";
  if (isComplete && hasRejections) return "text-rose-400";
  if (isComplete) return "text-emerald-400";
  return "text-stone-300";
}

// --- Props ---

interface FlatFileNodeProps {
  filePath: string;
  fileStatus: string | undefined;
  hunkStatus: FileHunkStatus;
  symbolDiff: FileSymbolDiff | null;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  hunkContext: HunkContext;
  onApproveAll?: (path: string, isDir: boolean) => void;
  onUnapproveAll?: (path: string, isDir: boolean) => void;
  movedFilePaths?: Set<string>;
}

// --- Flat file node ---

export const FlatFileNode = memo(function FlatFileNode({
  filePath,
  fileStatus,
  hunkStatus,
  symbolDiff,
  selectedFile,
  onSelectFile,
  hunkContext,
  onApproveAll,
  onUnapproveAll,
  movedFilePaths,
}: FlatFileNodeProps) {
  const {
    hunkStates,
    trustList,
    onNavigate: onNavigateToHunk,
  } = useReviewData();
  const [expanded, setExpanded] = useState(false);

  const isSelected = selectedFile === filePath;
  const hasReviewableContent = hunkStatus.total > 0;
  const hasPending = hunkStatus.pending > 0;
  const hasApproved = hunkStatus.approved > 0;
  const isComplete = hasReviewableContent && hunkStatus.pending === 0;

  // Split path into dir + filename
  const lastSlash = filePath.lastIndexOf("/");
  const dirPath = lastSlash >= 0 ? filePath.substring(0, lastSlash + 1) : "";
  const fileName =
    lastSlash >= 0 ? filePath.substring(lastSlash + 1) : filePath;

  // Symbol data
  const hasGrammar = symbolDiff?.hasGrammar ?? false;
  const sortedSymbols = useMemo(
    () => (hasGrammar && symbolDiff ? sortSymbols(symbolDiff.symbols) : []),
    [hasGrammar, symbolDiff],
  );

  // All file hunk IDs for no-grammar fallback
  const allFileHunkIds = useMemo(() => {
    if (!symbolDiff) return [];
    const ids = [...symbolDiff.topLevelHunkIds];
    for (const sym of symbolDiff.symbols) {
      ids.push(...collectAllHunkIds(sym));
    }
    return ids;
  }, [symbolDiff]);

  const topLevelStatus = useMemo(
    () =>
      symbolDiff
        ? getHunkIdsStatus(symbolDiff.topLevelHunkIds, hunkStates, trustList)
        : null,
    [symbolDiff, hunkStates, trustList],
  );

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((v) => !v);
  }, []);

  return (
    <div className="file-node-item select-none">
      {/* File row */}
      <div
        className={`group flex w-full items-center gap-1.5 py-0.5 pr-2 pl-2 transition-colors ${
          isSelected
            ? "bg-amber-500/15 border-l-2 border-l-amber-400"
            : "border-l-2 border-l-transparent hover:bg-stone-800/40"
        }`}
      >
        {/* Chevron for expand/collapse */}
        <button className="flex-shrink-0" onClick={handleToggle}>
          <svg
            className={`h-3 w-3 text-stone-600 transition-transform ${expanded ? "rotate-90" : ""}`}
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M10 6l6 6-6 6" />
          </svg>
        </button>

        {/* Git status letter */}
        <StatusLetter status={fileStatus} />

        {/* File path: dir (dim) + name (bright) */}
        <button
          className="flex flex-1 items-center text-left min-w-0"
          onClick={() => onSelectFile(filePath)}
        >
          <span
            className={`min-w-0 truncate text-xs ${flatFileNameColor(isSelected, isComplete, hunkStatus.rejected > 0)}`}
          >
            {dirPath && <span className="text-stone-500">{dirPath}</span>}
            {fileName}
          </span>
          {movedFilePaths?.has(filePath) && (
            <span className="flex-shrink-0 rounded bg-sky-500/15 px-1 py-0.5 text-xxs font-medium text-sky-400">
              Moved
            </span>
          )}
        </button>

        {/* Approval buttons on hover */}
        {onApproveAll && onUnapproveAll && hasReviewableContent && (
          <ApprovalButtons
            hasPending={hasPending}
            hasApproved={hasApproved}
            onApprove={() => onApproveAll(filePath, false)}
            onUnapprove={() => onUnapproveAll(filePath, false)}
          />
        )}

        {/* Hunk count */}
        <HunkCount status={hunkStatus} context={hunkContext} />
      </div>

      {/* Symbol subtree (when expanded) */}
      {expanded && (
        <div className="pb-0.5">
          {hasGrammar && sortedSymbols.length > 0 ? (
            <>
              {sortedSymbols.map((symbol) => (
                <SymbolRow
                  key={`${symbol.changeType}-${symbol.name}-${symbol.newRange?.startLine ?? symbol.oldRange?.startLine ?? 0}`}
                  symbol={symbol}
                  depth={2}
                  filePath={filePath}
                />
              ))}

              {/* Top-level changes outside symbols */}
              {topLevelStatus && topLevelStatus.total > 0 && (
                <div
                  className="group flex w-full items-center gap-1 py-0.5 pr-2 hover:bg-stone-800/40 transition-colors cursor-pointer"
                  style={{ paddingLeft: "2.1rem" }}
                  onClick={() => {
                    if (symbolDiff && symbolDiff.topLevelHunkIds.length > 0) {
                      onNavigateToHunk(filePath, symbolDiff.topLevelHunkIds[0]);
                    }
                  }}
                >
                  <span className="w-3 flex-shrink-0" />
                  <ChangeIndicator changeType="modified" />
                  <span className="min-w-0 flex-1 truncate text-left text-xs italic text-stone-400">
                    top-level changes
                  </span>
                  <ReviewStatusDot status={topLevelStatus} />
                </div>
              )}
            </>
          ) : (
            /* No grammar or no symbols — show summary */
            <div
              className="flex items-center gap-1.5 py-1 pl-8 pr-2 text-xs text-stone-400 italic cursor-pointer hover:bg-stone-800/40 transition-colors"
              onClick={() => {
                if (allFileHunkIds.length > 0) {
                  onNavigateToHunk(filePath, allFileHunkIds[0]);
                }
              }}
            >
              <ChangeIndicator changeType="modified" />
              <span>
                {allFileHunkIds.length}{" "}
                {allFileHunkIds.length === 1 ? "hunk" : "hunks"}
              </span>
              {allFileHunkIds.length > 0 && (
                <ReviewStatusDot
                  status={getHunkIdsStatus(
                    allFileHunkIds,
                    hunkStates,
                    trustList,
                  )}
                />
              )}
              {symbolDiff && !symbolDiff.hasGrammar && (
                <span className="text-xxs text-stone-600 italic ml-1">
                  no grammar
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
});
