import { type ReactNode, useState, useCallback, useMemo, memo } from "react";
import { SimpleTooltip } from "../ui/tooltip";
import type {
  FileSymbolDiff,
  SymbolDiff,
  SymbolKind,
  SymbolChangeType,
  HunkState,
} from "../../types";
import { isHunkTrusted } from "../../types";

export { SymbolRow, StatusToggle } from "./SymbolRow";

// --- Symbol kind icons ---

const SYMBOL_ICONS: Record<SymbolKind, { label: string; color: string }> = {
  function: { label: "fn", color: "text-status-modified" },
  method: { label: "fn", color: "text-status-modified" },
  class: { label: "C", color: "text-status-renamed" },
  struct: { label: "S", color: "text-status-renamed" },
  trait: { label: "T", color: "text-guide" },
  impl: { label: "I", color: "text-guide" },
  enum: { label: "E", color: "text-status-approved" },
  interface: { label: "I", color: "text-status-trusted" },
  module: { label: "M", color: "text-fg-muted" },
  type: { label: "T", color: "text-status-trusted" },
};

export function SymbolKindBadge({
  kind,
}: {
  kind: SymbolKind | null;
}): ReactNode {
  if (!kind) return <span className="w-4 flex-shrink-0" />;
  const config = SYMBOL_ICONS[kind];
  return (
    <SimpleTooltip content={kind}>
      <span
        className={`flex-shrink-0 font-mono text-xxs font-bold ${config.color}`}
      >
        {config.label}
      </span>
    </SimpleTooltip>
  );
}

// --- Change type indicator ---

const CHANGE_INDICATORS: Record<
  SymbolChangeType,
  { prefix: string; color: string }
> = {
  added: { prefix: "+", color: "text-diff-added" },
  removed: { prefix: "-", color: "text-diff-removed" },
  modified: { prefix: "~", color: "text-status-modified" },
};

export function ChangeIndicator({
  changeType,
}: {
  changeType: SymbolChangeType;
}): ReactNode {
  const config = CHANGE_INDICATORS[changeType];
  return (
    <span
      className={`flex-shrink-0 font-mono text-xxs font-bold w-3 text-center ${config.color}`}
    >
      {config.prefix}
    </span>
  );
}

// --- Status helpers ---

export interface SymbolHunkStatus {
  pending: number;
  reviewed: number;
  total: number;
}

export function getHunkIdsStatus(
  hunkIds: string[],
  hunkStates: Record<string, HunkState>,
  trustList: string[],
): SymbolHunkStatus {
  let pending = 0;
  let reviewed = 0;

  for (const hunkId of hunkIds) {
    const state = hunkStates[hunkId];
    if (state?.status === "approved" || state?.status === "rejected") {
      reviewed++;
    } else if (isHunkTrusted(state, trustList)) {
      reviewed++;
    } else {
      pending++;
    }
  }

  return { pending, reviewed, total: pending + reviewed };
}

export function collectAllHunkIds(symbol: SymbolDiff): string[] {
  const ids = [...symbol.hunkIds];
  for (const child of symbol.children) {
    ids.push(...collectAllHunkIds(child));
  }
  return ids;
}

export function StatusBadge({
  status,
}: {
  status: SymbolHunkStatus;
}): ReactNode {
  if (status.total === 0) return null;

  const isComplete = status.pending === 0;
  return (
    <span
      className={`font-mono text-xxs tabular-nums ${isComplete ? "text-status-approved" : "text-fg-muted"}`}
    >
      {status.total === 1 ? `${status.total} hunk` : `${status.total} hunks`}
    </span>
  );
}

export function ReviewStatusDot({
  status,
}: {
  status: SymbolHunkStatus;
}): ReactNode {
  if (status.total === 0) return null;

  const isComplete = status.pending === 0;
  return (
    <span
      className={`text-xxs ${isComplete ? "text-status-approved" : "text-fg-faint"}`}
    >
      {isComplete ? "\u2713" : "\u25CB"}
    </span>
  );
}

// --- Sort symbols by: modified first, then added, then removed, within group by line ---

export function sortSymbols(symbols: SymbolDiff[]): SymbolDiff[] {
  const order: Record<SymbolChangeType, number> = {
    modified: 0,
    added: 1,
    removed: 2,
  };

  return [...symbols].sort((a, b) => {
    const orderDiff = order[a.changeType] - order[b.changeType];
    if (orderDiff !== 0) return orderDiff;
    // Within same type, sort by line number
    const aLine = a.newRange?.startLine ?? a.oldRange?.startLine ?? 0;
    const bLine = b.newRange?.startLine ?? b.oldRange?.startLine ?? 0;
    return aLine - bLine;
  });
}

// --- Symbol node ---

export const SymbolNode = memo(function SymbolNode({
  symbol,
  depth,
  hunkStates,
  trustList,
  onNavigate,
  filePath,
}: {
  symbol: SymbolDiff;
  depth: number;
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  onNavigate: (filePath: string, hunkId: string) => void;
  filePath: string;
}) {
  const [expanded, setExpanded] = useState(true);

  const allHunkIds = useMemo(() => collectAllHunkIds(symbol), [symbol]);
  const status = useMemo(
    () => getHunkIdsStatus(allHunkIds, hunkStates, trustList),
    [allHunkIds, hunkStates, trustList],
  );

  const hasChildren = symbol.children.length > 0;
  const paddingLeft = `${depth * 0.8 + 0.5}rem`;
  const sortedChildren = useMemo(
    () => (hasChildren ? sortSymbols(symbol.children) : []),
    [symbol.children, hasChildren],
  );

  const firstHunkId = symbol.hunkIds[0] ?? null;

  const handleClick = useCallback(() => {
    if (firstHunkId) {
      onNavigate(filePath, firstHunkId);
    } else if (hasChildren) {
      // For containers with no direct hunks, navigate to first child's hunk
      for (const child of symbol.children) {
        if (child.hunkIds.length > 0) {
          onNavigate(filePath, child.hunkIds[0]);
          return;
        }
      }
    }
  }, [firstHunkId, filePath, onNavigate, hasChildren, symbol.children]);

  return (
    <div className="select-none">
      <div
        className="group flex w-full items-center gap-1 py-0.5 pr-2 hover:bg-surface-raised/40 transition-colors cursor-pointer"
        style={{ paddingLeft }}
        onClick={hasChildren ? () => setExpanded(!expanded) : handleClick}
      >
        {/* Chevron for containers, spacer for leaves */}
        {hasChildren ? (
          <button
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <svg
              className={`h-3 w-3 text-fg-faint transition-transform ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Change type indicator */}
        <ChangeIndicator changeType={symbol.changeType} />

        {/* Symbol kind */}
        <SymbolKindBadge kind={symbol.kind} />

        {/* Symbol name */}
        <SimpleTooltip content={symbol.name}>
          <button
            className="min-w-0 flex-1 truncate text-left text-xs text-fg-secondary"
            onClick={(e) => {
              e.stopPropagation();
              handleClick();
            }}
          >
            {symbol.name}
          </button>
        </SimpleTooltip>

        {/* Hunk count & review status */}
        <StatusBadge status={status} />
        <ReviewStatusDot status={status} />
      </div>

      {/* Children */}
      {expanded && sortedChildren.length > 0 && (
        <div>
          {sortedChildren.map((child) => (
            <SymbolNode
              key={`${child.changeType}-${child.name}-${child.newRange?.startLine ?? child.oldRange?.startLine ?? 0}`}
              symbol={child}
              depth={depth + 1}
              hunkStates={hunkStates}
              trustList={trustList}
              onNavigate={onNavigate}
              filePath={filePath}
            />
          ))}
        </div>
      )}
    </div>
  );
});

// --- File section ---

export const FileSection = memo(function FileSection({
  fileDiff,
  hunkStates,
  trustList,
  onNavigate,
  defaultExpanded,
}: {
  fileDiff: FileSymbolDiff;
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  onNavigate: (filePath: string, hunkId: string) => void;
  defaultExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const fileName = fileDiff.filePath.split("/").pop() || fileDiff.filePath;
  const dirPath = fileDiff.filePath.includes("/")
    ? fileDiff.filePath.substring(0, fileDiff.filePath.lastIndexOf("/"))
    : "";

  const topLevelStatus = useMemo(
    () => getHunkIdsStatus(fileDiff.topLevelHunkIds, hunkStates, trustList),
    [fileDiff.topLevelHunkIds, hunkStates, trustList],
  );

  const sortedSymbols = useMemo(
    () => sortSymbols(fileDiff.symbols),
    [fileDiff.symbols],
  );

  const totalHunks = useMemo(() => {
    let count = fileDiff.topLevelHunkIds.length;
    for (const sym of fileDiff.symbols) {
      count += collectAllHunkIds(sym).length;
    }
    return count;
  }, [fileDiff]);

  const handleTopLevelClick = useCallback(() => {
    if (fileDiff.topLevelHunkIds.length > 0) {
      onNavigate(fileDiff.filePath, fileDiff.topLevelHunkIds[0]);
    }
  }, [fileDiff, onNavigate]);

  if (totalHunks === 0 && fileDiff.symbols.length === 0) return null;

  return (
    <div className="border-b border-edge/50">
      {/* File header */}
      <button
        className="group flex w-full items-center gap-1.5 px-3 py-1.5 text-left hover:bg-surface-raised/40 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`h-3 w-3 flex-shrink-0 text-fg-faint transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 6l6 6-6 6" />
        </svg>

        <span className="min-w-0 flex-1 truncate text-xs">
          {dirPath && <span className="text-fg-muted">{dirPath}/</span>}
          <span className="text-fg-secondary font-medium">{fileName}</span>
        </span>

        {!fileDiff.hasGrammar && (
          <span className="text-xxs text-fg-faint italic flex-shrink-0">
            no grammar
          </span>
        )}

        <span className="font-mono text-xxs tabular-nums text-fg-muted flex-shrink-0">
          {totalHunks}
        </span>
      </button>

      {/* Symbols */}
      {expanded && (
        <div className="pb-1">
          {fileDiff.hasGrammar ? (
            <>
              {sortedSymbols.map((symbol) => (
                <SymbolNode
                  key={`${symbol.changeType}-${symbol.name}-${symbol.newRange?.startLine ?? symbol.oldRange?.startLine ?? 0}`}
                  symbol={symbol}
                  depth={1}
                  hunkStates={hunkStates}
                  trustList={trustList}
                  onNavigate={onNavigate}
                  filePath={fileDiff.filePath}
                />
              ))}

              {/* Top-level changes (outside any symbol) */}
              {topLevelStatus.total > 0 && (
                <div
                  className="group flex w-full items-center gap-1 py-0.5 pr-2 hover:bg-surface-raised/40 transition-colors cursor-pointer"
                  style={{ paddingLeft: "1.3rem" }}
                  onClick={handleTopLevelClick}
                >
                  <span className="w-3 flex-shrink-0" />
                  <ChangeIndicator changeType="modified" />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-xs italic text-fg-muted"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleTopLevelClick();
                    }}
                  >
                    top-level changes
                  </button>
                  <StatusBadge status={topLevelStatus} />
                  <ReviewStatusDot status={topLevelStatus} />
                </div>
              )}
            </>
          ) : (
            /* No grammar - show all changes as one group */
            <div
              className="group flex w-full items-center gap-1 py-0.5 pr-2 hover:bg-surface-raised/40 transition-colors cursor-pointer"
              style={{ paddingLeft: "1.3rem" }}
              onClick={handleTopLevelClick}
            >
              <span className="w-3 flex-shrink-0" />
              <ChangeIndicator changeType="modified" />
              <button
                className="min-w-0 flex-1 truncate text-left text-xs italic text-fg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  handleTopLevelClick();
                }}
              >
                all changes
              </button>
              <StatusBadge status={topLevelStatus} />
              <ReviewStatusDot status={topLevelStatus} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
