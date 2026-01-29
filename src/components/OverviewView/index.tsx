import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { useReviewStore } from "../../stores/reviewStore";
import type {
  FileSymbolDiff,
  SymbolDiff,
  DiffHunk,
  HunkState,
} from "../../types";
import {
  FileSection,
  SymbolKindBadge,
  ChangeIndicator,
  sortSymbols,
  collectAllHunkIds,
  getHunkIdsStatus,
  StatusBadge,
  ReviewStatusDot,
} from "../FilesPanel/SymbolsPanel";
import { calculateFileHunkStatus } from "../FilesPanel/FileTree.utils";
import type { FileHunkStatus } from "../FilesPanel/types";
import { isHunkTrusted } from "../../types";

type OverviewLayout = "list" | "split";

// --- Line stats helpers ---

interface LineStats {
  added: number;
  removed: number;
}

function buildLineStatsMap(hunks: DiffHunk[]): Map<string, LineStats> {
  const map = new Map<string, LineStats>();
  for (const h of hunks) {
    let added = 0;
    let removed = 0;
    for (const line of h.lines) {
      if (line.type === "added") added++;
      else if (line.type === "removed") removed++;
    }
    map.set(h.id, { added, removed });
  }
  return map;
}

function getSymbolLineStats(
  symbol: SymbolDiff,
  statsMap: Map<string, LineStats>,
): LineStats {
  let added = 0;
  let removed = 0;
  for (const id of symbol.hunkIds) {
    const s = statsMap.get(id);
    if (s) {
      added += s.added;
      removed += s.removed;
    }
  }
  for (const child of symbol.children) {
    const cs = getSymbolLineStats(child, statsMap);
    added += cs.added;
    removed += cs.removed;
  }
  return { added, removed };
}

function getHunkIdsLineStats(
  hunkIds: string[],
  statsMap: Map<string, LineStats>,
): LineStats {
  let added = 0;
  let removed = 0;
  for (const id of hunkIds) {
    const s = statsMap.get(id);
    if (s) {
      added += s.added;
      removed += s.removed;
    }
  }
  return { added, removed };
}

function LineStatsBadge({
  stats,
  side,
}: {
  stats: LineStats;
  side?: "left" | "right";
}) {
  // In split view: left shows only removals, right shows only additions
  const showAdded = side !== "left" && stats.added > 0;
  const showRemoved = side !== "right" && stats.removed > 0;
  if (!showAdded && !showRemoved) return null;
  return (
    <span className="flex-shrink-0 font-mono text-xxs tabular-nums flex items-center gap-1">
      {showAdded && <span className="text-emerald-500">+{stats.added}</span>}
      {showRemoved && <span className="text-red-400">-{stats.removed}</span>}
    </span>
  );
}

// --- Main component ---

export function OverviewView() {
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);
  const setMainViewMode = useReviewStore((s) => s.setMainViewMode);

  const [layout, setLayout] = useState<OverviewLayout>("split");
  const [symbolsExpanded, setSymbolsExpanded] = useState(true);

  const hunkStates = reviewState?.hunks ?? {};
  const trustList = reviewState?.trustList ?? [];

  const lineStatsMap = useMemo(() => buildLineStatsMap(hunks), [hunks]);

  // Global progress
  const totalHunks = hunks.length;
  const trustedHunks = reviewState
    ? hunks.filter((h) => {
        const state = reviewState.hunks[h.id];
        return !state?.status && isHunkTrusted(state, reviewState.trustList);
      }).length
    : 0;
  const approvedHunks = reviewState
    ? hunks.filter((h) => reviewState.hunks[h.id]?.status === "approved").length
    : 0;
  const pendingHunks = totalHunks - trustedHunks - approvedHunks;
  const reviewedPercent =
    totalHunks > 0
      ? Math.round(((trustedHunks + approvedHunks) / totalHunks) * 100)
      : 0;

  // Per-file breakdown
  const fileHunkStatus = useMemo(
    () => calculateFileHunkStatus(hunks, reviewState),
    [hunks, reviewState],
  );
  const pendingFiles = useMemo(() => {
    const entries: Array<{ path: string; status: FileHunkStatus }> = [];
    for (const [path, status] of fileHunkStatus) {
      if (status.pending > 0) entries.push({ path, status });
    }
    entries.sort((a, b) => b.status.pending - a.status.pending);
    return entries;
  }, [fileHunkStatus]);

  useEffect(() => {
    if (!symbolsLoaded && !symbolsLoading) {
      loadSymbols();
    }
  }, [symbolsLoaded, symbolsLoading, loadSymbols]);

  const handleNavigate = useCallback(
    (filePath: string, hunkId: string) => {
      setSelectedFile(filePath);
      const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
      if (hunkIndex >= 0) {
        useReviewStore.setState({ focusedHunkIndex: hunkIndex });
      }
      setMainViewMode("single");
    },
    [setSelectedFile, hunks, setMainViewMode],
  );

  const handleFileNavigate = useCallback(
    (filePath: string) => {
      setSelectedFile(filePath);
      setMainViewMode("single");
    },
    [setSelectedFile, setMainViewMode],
  );

  const filesWithChanges = useMemo(
    () =>
      symbolDiffs.filter(
        (d) => d.symbols.length > 0 || d.topLevelHunkIds.length > 0,
      ),
    [symbolDiffs],
  );

  return (
    <div className="flex-1 overflow-y-auto scrollbar-thin">
      <div className="max-w-5xl mx-auto py-4">
        {/* Section 1: Summary Stats */}
        <SummaryStats
          totalHunks={totalHunks}
          trustedHunks={trustedHunks}
          approvedHunks={approvedHunks}
          pendingHunks={pendingHunks}
          reviewedPercent={reviewedPercent}
        />

        {/* Section 2: Needs Review — File Breakdown */}
        {pendingFiles.length > 0 && (
          <div className="px-4 mb-6">
            <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide mb-2">
              Needs Review
            </h3>
            <div className="rounded-lg border border-stone-800 overflow-hidden">
              {pendingFiles.map((entry) => (
                <PendingFileRow
                  key={entry.path}
                  path={entry.path}
                  status={entry.status}
                  onNavigate={handleFileNavigate}
                />
              ))}
            </div>
          </div>
        )}

        {/* Section 3: Symbol Changes */}
        <div className="px-4">
          <button
            className="flex items-center gap-1.5 mb-2 group"
            onClick={() => setSymbolsExpanded(!symbolsExpanded)}
          >
            <svg
              className={`h-3 w-3 text-stone-600 transition-transform ${symbolsExpanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6l6 6-6 6" />
            </svg>
            <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide">
              Symbol Changes
            </h3>
            {filesWithChanges.length > 0 && (
              <span className="text-xxs text-stone-600 tabular-nums">
                {filesWithChanges.length} file
                {filesWithChanges.length !== 1 ? "s" : ""}
              </span>
            )}
          </button>

          {symbolsExpanded && (
            <>
              {symbolsLoading && (
                <div className="flex items-center justify-center py-8">
                  <div className="flex flex-col items-center gap-3">
                    <div className="h-6 w-6 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
                    <span className="text-xs text-stone-500">
                      Extracting symbols...
                    </span>
                  </div>
                </div>
              )}

              {symbolsLoaded && filesWithChanges.length === 0 && (
                <p className="text-xs text-stone-600 py-4">
                  No changed symbols found in this comparison.
                </p>
              )}

              {filesWithChanges.length > 0 && (
                <div>
                  <div className="flex items-center justify-end mb-2">
                    <div className="flex items-center rounded-md bg-stone-800/50 p-0.5">
                      <button
                        onClick={() => setLayout("list")}
                        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                          layout === "list"
                            ? "bg-stone-700 text-stone-200"
                            : "text-stone-500 hover:text-stone-300"
                        }`}
                        title="List view"
                      >
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <line x1="3" y1="6" x2="21" y2="6" />
                          <line x1="3" y1="12" x2="21" y2="12" />
                          <line x1="3" y1="18" x2="21" y2="18" />
                        </svg>
                        <span>List</span>
                      </button>
                      <button
                        onClick={() => setLayout("split")}
                        className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                          layout === "split"
                            ? "bg-stone-700 text-stone-200"
                            : "text-stone-500 hover:text-stone-300"
                        }`}
                        title="Split old/new view"
                      >
                        <svg
                          className="h-3 w-3"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="3" y="3" width="18" height="18" rx="2" />
                          <line x1="12" y1="3" x2="12" y2="21" />
                        </svg>
                        <span>Split</span>
                      </button>
                    </div>
                  </div>

                  {layout === "list"
                    ? filesWithChanges.map((fileDiff) => (
                        <FileSection
                          key={fileDiff.filePath}
                          fileDiff={fileDiff}
                          hunkStates={hunkStates}
                          trustList={trustList}
                          onNavigate={handleNavigate}
                          defaultExpanded={true}
                        />
                      ))
                    : filesWithChanges.map((fileDiff) => (
                        <SplitFileSection
                          key={fileDiff.filePath}
                          fileDiff={fileDiff}
                          hunkStates={hunkStates}
                          trustList={trustList}
                          onNavigate={handleNavigate}
                          lineStatsMap={lineStatsMap}
                        />
                      ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// --- Summary Stats ---

function SummaryStats({
  totalHunks,
  trustedHunks,
  approvedHunks,
  pendingHunks,
  reviewedPercent,
}: {
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  pendingHunks: number;
  reviewedPercent: number;
}) {
  if (totalHunks === 0) {
    return (
      <div className="px-4 pb-4 mb-4 border-b border-stone-800">
        <p className="text-sm text-stone-500">No hunks in this comparison.</p>
      </div>
    );
  }

  return (
    <div className="px-4 pb-4 mb-4 border-b border-stone-800">
      <div className="flex items-baseline gap-3 mb-3">
        <span className="text-2xl font-semibold text-stone-100 tabular-nums">
          {reviewedPercent}%
        </span>
        <span className="text-sm text-stone-400">reviewed</span>
        <span className="text-xs text-stone-600 tabular-nums ml-auto">
          {trustedHunks + approvedHunks}/{totalHunks} hunks
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-stone-800 overflow-hidden flex">
        {trustedHunks > 0 && (
          <div
            className="bg-cyan-500 transition-all duration-300"
            style={{ width: `${(trustedHunks / totalHunks) * 100}%` }}
          />
        )}
        {approvedHunks > 0 && (
          <div
            className="bg-lime-500 transition-all duration-300"
            style={{ width: `${(approvedHunks / totalHunks) * 100}%` }}
          />
        )}
      </div>

      {/* Stat chips */}
      <div className="flex items-center gap-4 mt-3">
        <StatChip color="bg-cyan-500" label="Trusted" count={trustedHunks} />
        <StatChip color="bg-lime-500" label="Approved" count={approvedHunks} />
        <StatChip
          color="bg-amber-500"
          label="Needs Review"
          count={pendingHunks}
        />
        <span className="text-xxs text-stone-600 tabular-nums ml-auto">
          {totalHunks} total
        </span>
      </div>
    </div>
  );
}

function StatChip({
  color,
  label,
  count,
}: {
  color: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-xs text-stone-400">{label}</span>
      <span className="text-xs text-stone-300 font-medium tabular-nums">
        {count}
      </span>
    </div>
  );
}

// --- Pending File Row ---

function PendingFileRow({
  path,
  status,
  onNavigate,
}: {
  path: string;
  status: FileHunkStatus;
  onNavigate: (filePath: string) => void;
}) {
  const fileName = path.split("/").pop() || path;
  const dirPath = path.includes("/")
    ? path.substring(0, path.lastIndexOf("/"))
    : "";
  const reviewedCount = status.approved + status.trusted;
  const filePercent =
    status.total > 0 ? Math.round((reviewedCount / status.total) * 100) : 0;

  return (
    <button
      className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-stone-800/40 transition-colors border-b border-stone-800/50 last:border-b-0"
      onClick={() => onNavigate(path)}
    >
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs">
          {dirPath && <span className="text-stone-500">{dirPath}/</span>}
          <span className="text-stone-200 font-medium">{fileName}</span>
        </div>
      </div>
      <span className="text-xxs text-amber-400/80 tabular-nums flex-shrink-0">
        {status.pending} pending
      </span>
      <div className="w-16 flex-shrink-0">
        <div className="h-1 rounded-full bg-stone-800 overflow-hidden flex">
          {status.trusted > 0 && (
            <div
              className="bg-cyan-500"
              style={{ width: `${(status.trusted / status.total) * 100}%` }}
            />
          )}
          {status.approved > 0 && (
            <div
              className="bg-lime-500"
              style={{ width: `${(status.approved / status.total) * 100}%` }}
            />
          )}
        </div>
      </div>
      <span className="text-xxs text-stone-600 tabular-nums flex-shrink-0 w-8 text-right">
        {filePercent}%
      </span>
    </button>
  );
}

// --- Split file section ---

const SplitFileSection = memo(function SplitFileSection({
  fileDiff,
  hunkStates,
  trustList,
  onNavigate,
  lineStatsMap,
}: {
  fileDiff: FileSymbolDiff;
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  onNavigate: (filePath: string, hunkId: string) => void;
  lineStatsMap: Map<string, LineStats>;
}) {
  const [expanded, setExpanded] = useState(true);

  const fileName = fileDiff.filePath.split("/").pop() || fileDiff.filePath;
  const dirPath = fileDiff.filePath.includes("/")
    ? fileDiff.filePath.substring(0, fileDiff.filePath.lastIndexOf("/"))
    : "";

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

  if (totalHunks === 0 && fileDiff.symbols.length === 0) return null;

  return (
    <div className="mt-2 first:mt-0">
      {/* File header — stands apart from the split content */}
      <button
        className="group flex w-full items-center gap-1.5 px-4 py-2 text-left hover:bg-stone-800/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          className={`h-3 w-3 flex-shrink-0 text-stone-600 transition-transform ${expanded ? "rotate-90" : ""}`}
          viewBox="0 0 24 24"
          fill="currentColor"
        >
          <path d="M10 6l6 6-6 6" />
        </svg>
        <span className="min-w-0 flex-1 truncate text-xs">
          {dirPath && <span className="text-stone-500">{dirPath}/</span>}
          <span className="text-stone-200 font-medium">{fileName}</span>
        </span>
        {!fileDiff.hasGrammar && (
          <span className="text-xxs text-stone-600 italic flex-shrink-0">
            no grammar
          </span>
        )}
        <span className="font-mono text-xxs tabular-nums text-stone-500 flex-shrink-0">
          {totalHunks}
        </span>
      </button>

      {/* Split columns */}
      {expanded && (
        <div className="mx-3 mb-3 rounded border border-stone-800/60 overflow-hidden">
          {/* Column headers */}
          <div className="flex bg-stone-900/50 border-b border-stone-800/40">
            <div className="flex-1 px-3 py-1 text-xxs text-stone-500 font-medium">
              Old
            </div>
            <div className="w-px bg-stone-800/60" />
            <div className="flex-1 px-3 py-1 text-xxs text-stone-500 font-medium">
              New
            </div>
          </div>

          {/* Symbol rows */}
          {sortedSymbols.map((symbol) => (
            <SplitSymbolRow
              key={`${symbol.changeType}-${symbol.name}-${symbol.newRange?.startLine ?? symbol.oldRange?.startLine ?? 0}`}
              symbol={symbol}
              depth={0}
              hunkStates={hunkStates}
              trustList={trustList}
              onNavigate={onNavigate}
              filePath={fileDiff.filePath}
              lineStatsMap={lineStatsMap}
            />
          ))}

          {/* Top-level hunks */}
          {fileDiff.topLevelHunkIds.length > 0 && (
            <SplitTopLevelRow
              count={fileDiff.topLevelHunkIds.length}
              hunkIds={fileDiff.topLevelHunkIds}
              hunkStates={hunkStates}
              trustList={trustList}
              onNavigate={onNavigate}
              filePath={fileDiff.filePath}
              lineStatsMap={lineStatsMap}
            />
          )}
        </div>
      )}
    </div>
  );
});

// --- Split symbol row ---

const SplitSymbolRow = memo(function SplitSymbolRow({
  symbol,
  depth,
  hunkStates,
  trustList,
  onNavigate,
  filePath,
  lineStatsMap,
}: {
  symbol: SymbolDiff;
  depth: number;
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  onNavigate: (filePath: string, hunkId: string) => void;
  filePath: string;
  lineStatsMap: Map<string, LineStats>;
}) {
  const [expanded, setExpanded] = useState(true);

  const allHunkIds = useMemo(() => collectAllHunkIds(symbol), [symbol]);
  const status = useMemo(
    () => getHunkIdsStatus(allHunkIds, hunkStates, trustList),
    [allHunkIds, hunkStates, trustList],
  );

  const lineStats = useMemo(
    () => getSymbolLineStats(symbol, lineStatsMap),
    [symbol, lineStatsMap],
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

  const showOnLeft =
    symbol.changeType === "removed" || symbol.changeType === "modified";
  const showOnRight =
    symbol.changeType === "added" || symbol.changeType === "modified";

  const paddingLeft = `${depth * 0.75 + 0.75}rem`;

  const symbolContent = (side: "left" | "right") => {
    const visible =
      (side === "left" && showOnLeft) || (side === "right" && showOnRight);
    if (!visible) return null;

    return (
      <div
        className="group flex items-center gap-1 py-0.5 pr-2 hover:bg-stone-800/40 transition-colors cursor-pointer"
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
        <button
          className="min-w-0 flex-1 truncate text-left text-xs text-stone-300"
          onClick={(e) => {
            e.stopPropagation();
            handleClick();
          }}
          title={symbol.name}
        >
          {symbol.name}
        </button>
        <LineStatsBadge stats={lineStats} side={side} />
        <StatusBadge status={status} />
        <ReviewStatusDot status={status} />
      </div>
    );
  };

  return (
    <>
      <div className="flex">
        <div className="flex-1 min-w-0">{symbolContent("left")}</div>
        <div className="w-px bg-stone-800/60" />
        <div className="flex-1 min-w-0">{symbolContent("right")}</div>
      </div>

      {expanded &&
        sortedChildren.map((child) => (
          <SplitSymbolRow
            key={`${child.changeType}-${child.name}-${child.newRange?.startLine ?? child.oldRange?.startLine ?? 0}`}
            symbol={child}
            depth={depth + 1}
            hunkStates={hunkStates}
            trustList={trustList}
            onNavigate={onNavigate}
            filePath={filePath}
            lineStatsMap={lineStatsMap}
          />
        ))}
    </>
  );
});

// --- Split top-level hunks row ---

function SplitTopLevelRow({
  count,
  hunkIds,
  hunkStates,
  trustList,
  onNavigate,
  filePath,
  lineStatsMap,
}: {
  count: number;
  hunkIds: string[];
  hunkStates: Record<string, HunkState>;
  trustList: string[];
  onNavigate: (filePath: string, hunkId: string) => void;
  filePath: string;
  lineStatsMap: Map<string, LineStats>;
}) {
  const status = useMemo(
    () => getHunkIdsStatus(hunkIds, hunkStates, trustList),
    [hunkIds, hunkStates, trustList],
  );

  const lineStats = useMemo(
    () => getHunkIdsLineStats(hunkIds, lineStatsMap),
    [hunkIds, lineStatsMap],
  );

  const handleClick = useCallback(() => {
    if (hunkIds.length > 0) {
      onNavigate(filePath, hunkIds[0]);
    }
  }, [hunkIds, filePath, onNavigate]);

  const sideContent = (side: "left" | "right") => (
    <div
      className="group flex items-center gap-1 py-0.5 pr-2 hover:bg-stone-800/40 transition-colors cursor-pointer"
      style={{ paddingLeft: "0.75rem" }}
      onClick={handleClick}
    >
      <span className="w-3 flex-shrink-0" />
      <ChangeIndicator changeType="modified" />
      <span className="min-w-0 flex-1 truncate text-xs italic text-stone-400">
        {count} top-level {count === 1 ? "hunk" : "hunks"}
      </span>
      <LineStatsBadge stats={lineStats} side={side} />
      <StatusBadge status={status} />
      <ReviewStatusDot status={status} />
    </div>
  );

  return (
    <div className="flex">
      <div className="flex-1 min-w-0">{sideContent("left")}</div>
      <div className="w-px bg-stone-800/60" />
      <div className="flex-1 min-w-0">{sideContent("right")}</div>
    </div>
  );
}
