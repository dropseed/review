import { useState, useMemo, useCallback, memo } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import { StatusLetter, HunkCount } from "./StatusIndicators";
import type { FileHunkStatus } from "./types";
import type { HunkContext } from "./FileNode";
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
    <div className="select-none">
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
            className={`min-w-0 truncate text-xs ${
              isSelected
                ? "text-stone-100"
                : isComplete
                  ? "text-lime-400"
                  : "text-stone-300"
            }`}
          >
            {dirPath && <span className="text-stone-500">{dirPath}</span>}
            {fileName}
          </span>
        </button>

        {/* Approval buttons on hover */}
        {onApproveAll && onUnapproveAll && hasReviewableContent && (
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {hasPending && (
              <SimpleTooltip content="Approve all">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onApproveAll(filePath, false);
                  }}
                  className="flex items-center justify-center w-5 h-5 rounded
                             text-stone-500 hover:text-lime-400 hover:bg-lime-500/20
                             transition-colors"
                >
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                </button>
              </SimpleTooltip>
            )}
            {hasApproved && (
              <SimpleTooltip content="Unapprove all">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onUnapproveAll(filePath, false);
                  }}
                  className="flex items-center justify-center w-5 h-5 rounded
                             text-lime-400 hover:text-stone-400 hover:bg-stone-700/50
                             transition-colors"
                >
                  <svg
                    className="w-3 h-3"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
                    />
                  </svg>
                </button>
              </SimpleTooltip>
            )}
          </div>
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
