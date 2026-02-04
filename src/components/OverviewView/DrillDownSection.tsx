import { useMemo, useCallback, memo } from "react";
import { useReviewStore } from "../../stores";
import type { FileSymbolDiff, SymbolDiff, DiffHunk } from "../../types";
import {
  ChangeIndicator,
  sortSymbols,
  getHunkIdsStatus,
  StatusBadge,
  ReviewStatusDot,
  SymbolRow,
  StatusToggle,
} from "../symbols";
import { calculateFileHunkStatus } from "../FilesPanel/FileTree.utils";
import type { FileHunkStatus } from "../FilesPanel/types";
import { ReviewDataProvider, useReviewData } from "../ReviewDataContext";
import { StatusLetter } from "../FilesPanel/StatusIndicators";
import { flattenFilesWithStatus } from "../../stores/types";

// ========================================================================
// Types
// ========================================================================

interface LineStats {
  added: number;
  removed: number;
}

// ========================================================================
// Helpers
// ========================================================================

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

function getFileLineStats(
  filePath: string,
  hunks: DiffHunk[],
  lineStatsMap: Map<string, LineStats>,
): LineStats {
  let added = 0;
  let removed = 0;
  for (const h of hunks) {
    if (h.filePath !== filePath) continue;
    const s = lineStatsMap.get(h.id);
    if (s) {
      added += s.added;
      removed += s.removed;
    }
  }
  return { added, removed };
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

// ========================================================================
// Small presentational components
// ========================================================================

function LineStatsBadge({ stats }: { stats: LineStats }) {
  if (stats.added === 0 && stats.removed === 0) return null;
  return (
    <span className="flex-shrink-0 font-mono text-xxs tabular-nums flex items-center gap-1">
      {stats.added > 0 && (
        <span className="text-emerald-500">+{stats.added}</span>
      )}
      {stats.removed > 0 && (
        <span className="text-red-400">-{stats.removed}</span>
      )}
    </span>
  );
}

function FileProgressBar({ status }: { status: FileHunkStatus }) {
  if (status.total === 0) return null;
  return (
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
            className="bg-emerald-500"
            style={{ width: `${(status.approved / status.total) * 100}%` }}
          />
        )}
      </div>
    </div>
  );
}

// ========================================================================
// DrillDownHeader
// ========================================================================

function DrillDownHeader() {
  return (
    <div className="flex items-center mb-2">
      <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide">
        Changed Files
      </h3>
    </div>
  );
}

// ========================================================================
// DrillDownFileRow
// ========================================================================

const DrillDownFileRow = memo(function DrillDownFileRow({
  fileDiff,
  fileHunkStatus,
  fileLineStats,
  lineStatsMap,
  allHunks,
  fileStatus,
}: {
  fileDiff: FileSymbolDiff;
  fileHunkStatus: FileHunkStatus;
  fileLineStats: LineStats;
  lineStatsMap: Map<string, LineStats>;
  allHunks: DiffHunk[];
  fileStatus?: string;
}) {
  const { hunkStates, trustList } = useReviewData();
  const approveAllFileHunks = useReviewStore((s) => s.approveAllFileHunks);
  const unapproveAllFileHunks = useReviewStore((s) => s.unapproveAllFileHunks);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const fileName = fileDiff.filePath.split("/").pop() || fileDiff.filePath;
  const dirPath = fileDiff.filePath.includes("/")
    ? fileDiff.filePath.substring(0, fileDiff.filePath.lastIndexOf("/"))
    : "";

  const sortedSymbols = useMemo(
    () => sortSymbols(fileDiff.symbols),
    [fileDiff.symbols],
  );

  const hasSymbols = fileDiff.hasGrammar && fileDiff.symbols.length > 0;

  // All hunk IDs for this file
  const allFileHunkIds = useMemo(() => {
    return allHunks
      .filter((h) => h.filePath === fileDiff.filePath)
      .map((h) => h.id);
  }, [allHunks, fileDiff.filePath]);

  const handleFileClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      navigateToBrowse(fileDiff.filePath);
    },
    [navigateToBrowse, fileDiff.filePath],
  );

  const handleApproveAll = useCallback(
    () => approveAllFileHunks(fileDiff.filePath),
    [approveAllFileHunks, fileDiff.filePath],
  );

  const handleUnapproveAll = useCallback(
    () => unapproveAllFileHunks(fileDiff.filePath),
    [unapproveAllFileHunks, fileDiff.filePath],
  );

  const renderContent = () => {
    if (fileStatus === "deleted") return null;

    if (hasSymbols) {
      return (
        <div className="pb-1">
          {fileDiff.topLevelHunkIds.length > 0 && (
            <ListTopLevelRow
              hunkIds={fileDiff.topLevelHunkIds}
              filePath={fileDiff.filePath}
            />
          )}
          {sortedSymbols.map((symbol) => (
            <SymbolRow
              key={`${symbol.changeType}-${symbol.name}-${symbol.newRange?.startLine ?? symbol.oldRange?.startLine ?? 0}`}
              symbol={symbol}
              depth={1}
              filePath={fileDiff.filePath}
            >
              {({ symbol: sym }) => (
                <LineStatsBadge stats={getSymbolLineStats(sym, lineStatsMap)} />
              )}
            </SymbolRow>
          ))}
        </div>
      );
    }

    // No grammar — summary row
    const topStatus = getHunkIdsStatus(allFileHunkIds, hunkStates, trustList);
    return (
      <div
        className="flex items-center gap-1 py-0.5 pr-2 text-xs text-stone-400 italic"
        style={{ paddingLeft: "1.3rem" }}
      >
        <span className="w-3 flex-shrink-0" />
        <ChangeIndicator changeType="modified" />
        <span>
          {allFileHunkIds.length}{" "}
          {allFileHunkIds.length === 1 ? "hunk" : "hunks"}
        </span>
        <StatusBadge status={topStatus} />
        <ReviewStatusDot status={topStatus} />
      </div>
    );
  };

  return (
    <div className="border-b border-stone-800/50 last:border-b-0">
      {/* File header row */}
      <div className="group flex w-full items-center gap-1 pl-3 pr-2 py-2 hover:bg-stone-800/30 transition-colors">
        <StatusLetter status={fileStatus} />
        <div className="min-w-0 flex-1">
          <button
            className={`truncate text-xs text-left cursor-pointer hover:text-amber-400 transition-colors ${fileStatus === "deleted" ? "line-through text-rose-400/70" : ""}`}
            onClick={handleFileClick}
          >
            {dirPath && (
              <span
                className={
                  fileStatus === "deleted"
                    ? "text-rose-400/50"
                    : "text-stone-500"
                }
              >
                {dirPath}/
              </span>
            )}
            <span
              className={
                fileStatus === "deleted"
                  ? "text-rose-400/70 font-medium"
                  : fileStatus === "added" || fileStatus === "untracked"
                    ? "text-emerald-300 font-medium"
                    : "text-stone-200 font-medium"
              }
            >
              {fileName}
            </span>
          </button>
        </div>
        <FileProgressBar status={fileHunkStatus} />
        <LineStatsBadge stats={fileLineStats} />
        <StatusToggle
          status={fileHunkStatus}
          onApprove={handleApproveAll}
          onUnapprove={handleUnapproveAll}
        />
      </div>

      {renderContent()}
    </div>
  );
});

// ========================================================================
// List layout — top-level hunks row
// ========================================================================

function ListTopLevelRow({
  hunkIds,
  filePath,
}: {
  hunkIds: string[];
  filePath: string;
}) {
  const { hunkStates, trustList, onNavigate } = useReviewData();
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);

  const status = useMemo(
    () => getHunkIdsStatus(hunkIds, hunkStates, trustList),
    [hunkIds, hunkStates, trustList],
  );

  const handleClick = useCallback(() => {
    if (hunkIds.length > 0) {
      onNavigate(filePath, hunkIds[0]);
    }
  }, [hunkIds, filePath, onNavigate]);

  const handleApprove = useCallback(
    () => approveHunkIds(hunkIds),
    [approveHunkIds, hunkIds],
  );

  const handleUnapprove = useCallback(
    () => unapproveHunkIds(hunkIds),
    [unapproveHunkIds, hunkIds],
  );

  return (
    <div
      className="group flex w-full items-center gap-1 py-0.5 pr-2 hover:bg-stone-800/40 transition-colors cursor-pointer"
      style={{ paddingLeft: "1.3rem" }}
      onClick={handleClick}
    >
      <span className="w-3 flex-shrink-0" />
      <ChangeIndicator changeType="modified" />
      <button
        className="min-w-0 flex-1 truncate text-left text-xs italic text-stone-400 cursor-pointer"
        onClick={(e) => {
          e.stopPropagation();
          handleClick();
        }}
      >
        top-level changes
      </button>
      <StatusBadge status={status} />
      <StatusToggle
        status={status}
        onApprove={handleApprove}
        onUnapprove={handleUnapprove}
      />
    </div>
  );
}

// ========================================================================
// DrillDownSection — main export
// ========================================================================

export function DrillDownSection() {
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const files = useReviewStore((s) => s.files);

  const hunkStates = reviewState?.hunks ?? {};
  const trustList = reviewState?.trustList ?? [];

  const lineStatsMap = useMemo(() => buildLineStatsMap(hunks), [hunks]);

  const fileStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const { path, status } of flattenFilesWithStatus(files)) {
      if (status) map.set(path, status);
    }
    return map;
  }, [files]);

  const fileHunkStatusMap = useMemo(
    () => calculateFileHunkStatus(hunks, reviewState),
    [hunks, reviewState],
  );

  const handleNavigate = useCallback(
    (filePath: string, hunkId: string) => {
      navigateToBrowse(filePath);
      const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
      if (hunkIndex >= 0) {
        useReviewStore.setState({ focusedHunkIndex: hunkIndex });
      }
    },
    [navigateToBrowse, hunks],
  );

  // Build file list — include ALL changed files
  const allChangedFiles = useMemo(() => {
    const filePathsWithHunks = new Set<string>();
    for (const h of hunks) {
      filePathsWithHunks.add(h.filePath);
    }

    const symbolDiffMap = new Map<string, FileSymbolDiff>();
    for (const sd of symbolDiffs) {
      symbolDiffMap.set(sd.filePath, sd);
    }

    const result: FileSymbolDiff[] = [];
    for (const filePath of filePathsWithHunks) {
      const sd = symbolDiffMap.get(filePath);
      if (sd) {
        result.push(sd);
      } else {
        result.push({
          filePath,
          symbols: [],
          topLevelHunkIds: hunks
            .filter((h) => h.filePath === filePath)
            .map((h) => h.id),
          hasGrammar: false,
        });
      }
    }

    result.sort((a, b) => a.filePath.localeCompare(b.filePath));
    return result;
  }, [symbolDiffs, hunks]);

  const contextValue = useMemo(
    () => ({ hunkStates, trustList, onNavigate: handleNavigate }),
    [hunkStates, trustList, handleNavigate],
  );

  if (allChangedFiles.length === 0 && !symbolsLoading) {
    return null;
  }

  return (
    <ReviewDataProvider value={contextValue}>
      <div className="px-4 mb-6">
        <DrillDownHeader />

        {allChangedFiles.length > 0 && (
          <div className="rounded-lg border border-stone-800 overflow-hidden">
            {allChangedFiles.map((fileDiff) => {
              const status = fileHunkStatusMap.get(fileDiff.filePath) ?? {
                pending: 0,
                approved: 0,
                trusted: 0,
                rejected: 0,
                total: 0,
              };
              const fileLineStats = getFileLineStats(
                fileDiff.filePath,
                hunks,
                lineStatsMap,
              );
              return (
                <DrillDownFileRow
                  key={fileDiff.filePath}
                  fileDiff={fileDiff}
                  fileHunkStatus={status}
                  fileLineStats={fileLineStats}
                  lineStatsMap={lineStatsMap}
                  allHunks={hunks}
                  fileStatus={fileStatusMap.get(fileDiff.filePath)}
                />
              );
            })}
          </div>
        )}
      </div>
    </ReviewDataProvider>
  );
}
