import { useState, useMemo, useCallback, memo } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import { StatusLetter, HunkCount } from "./StatusIndicators";
import type { FileHunkStatus } from "./types";
import type { HunkContext } from "./FileNode";
import type { FileSymbolDiff, SymbolDiff, HunkState } from "../../types";
import {
  SymbolKindBadge,
  ChangeIndicator,
  ReviewStatusDot,
  sortSymbols,
  collectAllHunkIds,
  getHunkIdsStatus,
} from "../symbols";
import { useReviewStore } from "../../stores/reviewStore";

// --- Props ---

interface FlatFileNodeProps {
  filePath: string;
  fileStatus: string | undefined;
  hunkStatus: FileHunkStatus;
  symbolDiff: FileSymbolDiff | null;
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  hunkContext: HunkContext;
  onApproveAll?: (path: string, isDir: boolean) => void;
  onUnapproveAll?: (path: string, isDir: boolean) => void;
  onNavigateToHunk: (filePath: string, hunkId: string) => void;
}

// --- Compact symbol row (recursive, for sidebar) ---

const CompactSymbolRow = memo(function CompactSymbolRow({
  symbol,
  depth,
  hunkStates,
  trustList,
  filePath,
  onNavigate,
}: {
  symbol: SymbolDiff;
  depth: number;
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  filePath: string;
  onNavigate: (filePath: string, hunkId: string) => void;
}) {
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const [expanded, setExpanded] = useState(true);

  const allHunkIds = useMemo(() => collectAllHunkIds(symbol), [symbol]);
  const status = useMemo(
    () => getHunkIdsStatus(allHunkIds, hunkStates, trustList),
    [allHunkIds, hunkStates, trustList],
  );

  const hasChildren = symbol.children.length > 0;
  const sortedChildren = useMemo(
    () => (hasChildren ? sortSymbols(symbol.children) : []),
    [symbol.children, hasChildren],
  );

  const firstHunkId = symbol.hunkIds[0] ?? null;

  const handleClick = useCallback(() => {
    if (firstHunkId) {
      onNavigate(filePath, firstHunkId);
    } else if (hasChildren) {
      for (const child of symbol.children) {
        if (child.hunkIds.length > 0) {
          onNavigate(filePath, child.hunkIds[0]);
          return;
        }
      }
    }
  }, [firstHunkId, filePath, onNavigate, hasChildren, symbol.children]);

  const handleApprove = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      approveHunkIds(allHunkIds);
    },
    [approveHunkIds, allHunkIds],
  );

  const paddingLeft = `${depth * 0.8 + 0.5}rem`;

  return (
    <div className="select-none">
      <div
        className="group flex w-full items-center gap-1 py-0.5 pr-2 hover:bg-stone-800/40 transition-colors cursor-pointer"
        style={{ paddingLeft }}
        onClick={hasChildren ? () => setExpanded(!expanded) : handleClick}
      >
        {hasChildren ? (
          <button
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <svg
              className={`h-3 w-3 text-stone-600 transition-transform ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        <ChangeIndicator changeType={symbol.changeType} />
        <SymbolKindBadge kind={symbol.kind} />

        <SimpleTooltip content={symbol.name}>
          <button
            className="min-w-0 flex-1 truncate text-left text-xs text-stone-300"
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
          >
            {symbol.name}
          </button>
        </SimpleTooltip>

        <ReviewStatusDot status={status} />

        {status.pending > 0 && (
          <SimpleTooltip content="Approve all hunks">
            <button
              onClick={handleApprove}
              className="flex items-center justify-center w-5 h-5 rounded
                         text-stone-500 hover:text-lime-400 hover:bg-lime-500/20
                         transition-colors opacity-0 group-hover:opacity-100"
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
      </div>

      {expanded && sortedChildren.length > 0 && (
        <div>
          {sortedChildren.map((child) => (
            <CompactSymbolRow
              key={`${child.changeType}-${child.name}-${child.newRange?.startLine ?? child.oldRange?.startLine ?? 0}`}
              symbol={child}
              depth={depth + 1}
              hunkStates={hunkStates}
              trustList={trustList}
              filePath={filePath}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// --- Flat file node ---

export const FlatFileNode = memo(function FlatFileNode({
  filePath,
  fileStatus,
  hunkStatus,
  symbolDiff,
  hunkStates,
  trustList,
  selectedFile,
  onSelectFile,
  hunkContext,
  onApproveAll,
  onUnapproveAll,
  onNavigateToHunk,
}: FlatFileNodeProps) {
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
                <CompactSymbolRow
                  key={`${symbol.changeType}-${symbol.name}-${symbol.newRange?.startLine ?? symbol.oldRange?.startLine ?? 0}`}
                  symbol={symbol}
                  depth={2}
                  hunkStates={hunkStates}
                  trustList={trustList}
                  filePath={filePath}
                  onNavigate={onNavigateToHunk}
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
