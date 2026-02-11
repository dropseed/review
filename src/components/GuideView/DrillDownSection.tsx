import { type ReactNode, useMemo, useCallback, useState, memo } from "react";
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
import {
  calculateFileHunkStatus,
  EMPTY_HUNK_STATUS,
} from "../FilesPanel/FileTree.utils";
import type { FileHunkStatus } from "../FilesPanel/types";
import { ReviewDataProvider, useReviewData } from "../ReviewDataContext";
import { StatusLetter } from "../FilesPanel/StatusIndicators";
import { flattenFilesWithStatus } from "../../stores/types";

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

function SectionHeader({
  title,
  fileCount,
  pendingCount,
  isOpen,
  onToggle,
  variant,
}: {
  title: string;
  fileCount: number;
  pendingCount?: number;
  isOpen: boolean;
  onToggle: () => void;
  variant: "pending" | "reviewed";
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-center gap-2 w-full py-2 text-left group"
    >
      <svg
        className={`w-3 h-3 text-stone-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
      </svg>
      <h3 className="text-xs font-medium text-stone-400 uppercase tracking-wide">
        {title}
      </h3>
      <span className="text-xxs text-stone-600 tabular-nums">
        {fileCount} {fileCount === 1 ? "file" : "files"}
      </span>
      {variant === "pending" &&
        pendingCount !== undefined &&
        pendingCount > 0 && (
          <span className="text-xxs font-mono tabular-nums px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400">
            {pendingCount} pending
          </span>
        )}
      {variant === "reviewed" && (
        <span className="text-xxs text-emerald-500/70">done</span>
      )}
    </button>
  );
}

function fileNameColor(fileStatus?: string): string {
  if (fileStatus === "deleted") return "text-rose-400/70";
  if (fileStatus === "added" || fileStatus === "untracked")
    return "text-emerald-300";
  return "text-stone-200";
}

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
            <span className={`font-medium ${fileNameColor(fileStatus)}`}>
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

export function DrillDownSection(): ReactNode {
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const files = useReviewStore((s) => s.files);

  const [reviewedOpen, setReviewedOpen] = useState(false);
  const [needsReviewOpen, setNeedsReviewOpen] = useState(true);

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
          symbolReferences: [],
        });
      }
    }

    return result;
  }, [symbolDiffs, hunks]);

  // Split into "Needs Review" and "Reviewed" sections
  const { needsReviewFiles, reviewedFiles, totalPendingHunks } = useMemo(() => {
    const pending: FileSymbolDiff[] = [];
    const reviewed: FileSymbolDiff[] = [];
    let pendingHunkSum = 0;

    for (const fileDiff of allChangedFiles) {
      const status =
        fileHunkStatusMap.get(fileDiff.filePath) ?? EMPTY_HUNK_STATUS;
      if (status.pending > 0) {
        pending.push(fileDiff);
        pendingHunkSum += status.pending;
      } else {
        reviewed.push(fileDiff);
      }
    }

    // Sort "Needs Review" by pending hunk count descending, alphabetical tiebreaker
    pending.sort((a, b) => {
      const aPending = (fileHunkStatusMap.get(a.filePath) ?? EMPTY_HUNK_STATUS)
        .pending;
      const bPending = (fileHunkStatusMap.get(b.filePath) ?? EMPTY_HUNK_STATUS)
        .pending;
      if (bPending !== aPending) return bPending - aPending;
      return a.filePath.localeCompare(b.filePath);
    });

    // Sort "Reviewed" alphabetically
    reviewed.sort((a, b) => a.filePath.localeCompare(b.filePath));

    return {
      needsReviewFiles: pending,
      reviewedFiles: reviewed,
      totalPendingHunks: pendingHunkSum,
    };
  }, [allChangedFiles, fileHunkStatusMap]);

  const contextValue = useMemo(
    () => ({ hunkStates, trustList, onNavigate: handleNavigate }),
    [hunkStates, trustList, handleNavigate],
  );

  if (allChangedFiles.length === 0 && !symbolsLoading) {
    return null;
  }

  const renderFileList = (fileDiffs: FileSymbolDiff[], dimmed?: boolean) => (
    <div
      className={`rounded-lg border border-stone-800 overflow-hidden ${dimmed ? "opacity-50" : ""}`}
    >
      {fileDiffs.map((fileDiff) => {
        const status =
          fileHunkStatusMap.get(fileDiff.filePath) ?? EMPTY_HUNK_STATUS;
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
  );

  return (
    <ReviewDataProvider value={contextValue}>
      <div className="space-y-2">
        {/* Needs Review section */}
        {needsReviewFiles.length > 0 && (
          <div>
            <SectionHeader
              title="Needs Review"
              fileCount={needsReviewFiles.length}
              pendingCount={totalPendingHunks}
              isOpen={needsReviewOpen}
              onToggle={() => setNeedsReviewOpen((v) => !v)}
              variant="pending"
            />
            {needsReviewOpen && renderFileList(needsReviewFiles)}
          </div>
        )}

        {/* Reviewed section */}
        {reviewedFiles.length > 0 && (
          <div>
            <SectionHeader
              title="Reviewed"
              fileCount={reviewedFiles.length}
              isOpen={reviewedOpen}
              onToggle={() => setReviewedOpen((v) => !v)}
              variant="reviewed"
            />
            {reviewedOpen && renderFileList(reviewedFiles, true)}
          </div>
        )}
      </div>
    </ReviewDataProvider>
  );
}
