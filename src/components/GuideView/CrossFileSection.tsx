import { useMemo, useCallback, useState } from "react";
import { useReviewStore } from "../../stores";
import type { DiffHunk, HunkState } from "../../types";
import { isHunkReviewed } from "../../types";
import type { SymbolLinkedHunk } from "../../utils/symbolLinkedHunks";
import { getChangedLinesKey } from "../../utils/changedLinesKey";
import { HunkPreview } from "../FileViewer/annotations/HunkPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "../ui/dialog";

// ========================================================================
// Types
// ========================================================================

interface FileConnection {
  filePath: string;
  hunkIds: string[];
  labels: string[];
  unreviewedCount: number;
  isAllImports: boolean;
}

interface SymbolConnection {
  symbolName: string;
  definitionFile: string;
  connections: FileConnection[];
  totalUnreviewed: number;
}

interface IdenticalGroup {
  representative: DiffHunk;
  hunks: DiffHunk[];
  files: string[];
}

// ========================================================================
// Helpers
// ========================================================================

function buildHunkById(hunks: DiffHunk[]): Map<string, DiffHunk> {
  const map = new Map<string, DiffHunk>();
  for (const h of hunks) map.set(h.id, h);
  return map;
}

function hasImportLabel(labels: string[]): boolean {
  return labels.some((l) => l.startsWith("imports:") || l === "imports");
}

function computeSymbolConnections(
  symbolLinkedHunks: Map<string, SymbolLinkedHunk[]>,
  hunkById: Map<string, DiffHunk>,
  hunkStates: Record<string, HunkState>,
  trustList: string[],
  autoApproveStaged: boolean,
  stagedFilePaths: Set<string>,
): SymbolConnection[] {
  // symbolName → { defFile, refFiles: Map<file, hunkIds[]> }
  const clusterMap = new Map<
    string,
    {
      defFile: string;
      refHunks: Map<string, string[]>;
    }
  >();

  for (const [sourceHunkId, links] of symbolLinkedHunks) {
    for (const link of links) {
      const { symbolName, relationship } = link;
      let cluster = clusterMap.get(symbolName);
      if (!cluster) {
        cluster = { defFile: "", refHunks: new Map() };
        clusterMap.set(symbolName, cluster);
      }

      const sourceHunk = hunkById.get(sourceHunkId);
      const linkedHunk = hunkById.get(link.hunkId);
      if (!sourceHunk || !linkedHunk) continue;

      if (relationship === "defines") {
        cluster.defFile = linkedHunk.filePath;
        // Source is a reference
        const existing = cluster.refHunks.get(sourceHunk.filePath) ?? [];
        if (!existing.includes(sourceHunkId)) existing.push(sourceHunkId);
        cluster.refHunks.set(sourceHunk.filePath, existing);
      } else {
        cluster.defFile = sourceHunk.filePath;
        // Linked is a reference
        const existing = cluster.refHunks.get(linkedHunk.filePath) ?? [];
        if (!existing.includes(link.hunkId)) existing.push(link.hunkId);
        cluster.refHunks.set(linkedHunk.filePath, existing);
      }
    }
  }

  const connections: SymbolConnection[] = [];
  for (const [symbolName, cluster] of clusterMap) {
    if (cluster.refHunks.size === 0) continue;

    const fileConnections: FileConnection[] = [];
    let totalUnreviewed = 0;

    for (const [filePath, hunkIds] of cluster.refHunks) {
      // Skip if this is also the definition file
      if (filePath === cluster.defFile) continue;

      const labels: string[] = [];
      let unreviewedCount = 0;
      let allImports = true;

      for (const id of hunkIds) {
        const hunk = hunkById.get(id);
        const state = hunkStates[id];
        const hunkLabels = state?.label ?? [];
        labels.push(...hunkLabels);

        if (
          hunk &&
          !isHunkReviewed(state, trustList, {
            autoApproveStaged,
            stagedFilePaths,
            filePath: hunk.filePath,
          })
        ) {
          unreviewedCount++;
        }

        if (!hasImportLabel(hunkLabels)) {
          allImports = false;
        }
      }

      totalUnreviewed += unreviewedCount;
      fileConnections.push({
        filePath,
        hunkIds,
        labels: [...new Set(labels)],
        unreviewedCount,
        isAllImports: allImports && hunkIds.length > 0,
      });
    }

    if (fileConnections.length === 0) continue;

    // Require 2+ reference hunks (i.e. 3+ total with the definition).
    // A single def+ref pair is the minimum connection and just noise here.
    const totalRefHunks = fileConnections.reduce(
      (sum, fc) => sum + fc.hunkIds.length,
      0,
    );
    if (totalRefHunks < 2) continue;

    // Sort: unreviewed non-import first, then unreviewed import, then reviewed
    fileConnections.sort((a, b) => {
      if (a.unreviewedCount > 0 && b.unreviewedCount === 0) return -1;
      if (a.unreviewedCount === 0 && b.unreviewedCount > 0) return 1;
      if (a.unreviewedCount > 0 && b.unreviewedCount > 0) {
        if (!a.isAllImports && b.isAllImports) return -1;
        if (a.isAllImports && !b.isAllImports) return 1;
      }
      return a.filePath.localeCompare(b.filePath);
    });

    connections.push({
      symbolName,
      definitionFile: cluster.defFile,
      connections: fileConnections,
      totalUnreviewed,
    });
  }

  // Sort clusters by totalUnreviewed descending
  connections.sort((a, b) => b.totalUnreviewed - a.totalUnreviewed);
  return connections;
}

function computeIdenticalGroups(allHunks: DiffHunk[]): IdenticalGroup[] {
  const keyToHunks = new Map<string, DiffHunk[]>();
  for (const h of allHunks) {
    const key = getChangedLinesKey(h);
    if (!key) continue;
    const group = keyToHunks.get(key) ?? [];
    group.push(h);
    keyToHunks.set(key, group);
  }

  const groups: IdenticalGroup[] = [];
  for (const hunks of keyToHunks.values()) {
    if (hunks.length < 2) continue;
    const files = [...new Set(hunks.map((h) => h.filePath))];
    groups.push({ representative: hunks[0], hunks, files });
  }

  groups.sort((a, b) => b.hunks.length - a.hunks.length);
  return groups;
}

function getChangePreview(hunk: DiffHunk): string {
  const changed = hunk.lines.filter(
    (l) => l.type === "added" || l.type === "removed",
  );
  const first = changed[0];
  if (!first) return "(empty change)";
  const trimmed = first.content.trim();
  const prefix = first.type === "added" ? "+" : "-";
  const label = `${prefix} ${trimmed}`;
  if (changed.length === 1) return label;
  return `${label}  (${changed.length} lines)`;
}

// ========================================================================
// Components
// ========================================================================

function getConnectionStatusStyle(fc: FileConnection): {
  className: string;
  label: string;
} {
  if (fc.unreviewedCount === 0) {
    return { className: "text-emerald-500", label: "reviewed" };
  }
  if (fc.isAllImports) {
    return { className: "text-stone-500", label: "imports" };
  }
  return { className: "text-amber-400", label: "needs review" };
}

function ConnectionCluster({
  connection,
  onPreview,
}: {
  connection: SymbolConnection;
  onPreview: (filePath: string, hunkIds: string[], symbolName?: string) => void;
}) {
  const allReviewed = connection.totalUnreviewed === 0;
  const needReviewCount = connection.connections.filter(
    (c) => c.unreviewedCount > 0,
  ).length;

  return (
    <div
      className={`border-b border-stone-800/50 last:border-b-0 px-3 py-2.5 ${
        allReviewed ? "opacity-50" : ""
      }`}
    >
      {/* Symbol header */}
      <div className="flex items-center gap-2 mb-1">
        <code className="text-xs font-mono font-medium text-amber-400/90 truncate">
          {connection.symbolName}
        </code>
        <span className="text-xxs text-stone-600 truncate">
          {connection.definitionFile}
        </span>
        <span
          className={`ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-xxs tabular-nums ${
            allReviewed
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-stone-700/50 text-stone-400"
          }`}
        >
          {allReviewed
            ? "all reviewed"
            : `${needReviewCount} of ${connection.connections.length} need review`}
        </span>
      </div>

      {/* File rows */}
      <div className="space-y-0.5 pl-1">
        {connection.connections.map((fc) => {
          const isReviewed = fc.unreviewedCount === 0;
          const primaryLabel = fc.labels[0] ?? "";
          const fileName = fc.filePath.split("/").pop() ?? fc.filePath;
          const status = getConnectionStatusStyle(fc);

          return (
            <button
              key={fc.filePath}
              onClick={() =>
                onPreview(fc.filePath, fc.hunkIds, connection.symbolName)
              }
              className={`group flex items-center gap-2 w-full text-left rounded px-1.5 py-1 hover:bg-stone-800/40 transition-colors ${
                isReviewed ? "opacity-50" : ""
              }`}
            >
              <span className="truncate text-xs text-stone-400 group-hover:text-stone-200 transition-colors flex-1 min-w-0">
                {fileName}
              </span>
              {primaryLabel && (
                <span className="text-xxs text-stone-600 shrink-0 truncate max-w-24">
                  {primaryLabel}
                </span>
              )}
              <span className={`text-xxs shrink-0 ${status.className}`}>
                {status.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function StatusIndicator({
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

function IdenticalGroupRow({
  group,
  hunkStates,
  onApproveAll,
  onRejectAll,
  onNavigate,
}: {
  group: IdenticalGroup;
  hunkStates: Record<string, HunkState>;
  onApproveAll: (hunkIds: string[]) => void;
  onRejectAll: (hunkIds: string[]) => void;
  onNavigate: (filePath: string, hunkId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const totalCount = group.hunks.length;

  let approvedCount = 0;
  let rejectedCount = 0;
  for (const h of group.hunks) {
    const status = hunkStates[h.id]?.status;
    if (status === "approved") approvedCount++;
    else if (status === "rejected") rejectedCount++;
  }
  const pendingCount = totalCount - approvedCount - rejectedCount;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left border-b border-stone-800/50 last:border-b-0 px-3 py-2 hover:bg-stone-800/30 transition-colors"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <code className="text-xs font-mono text-stone-300 truncate max-w-md">
            {getChangePreview(group.representative)}
          </code>
          <span className="flex-shrink-0 rounded-full bg-stone-700/50 px-1.5 py-0.5 text-xxs text-stone-400 tabular-nums">
            {group.hunks.length}x across {group.files.length} file
            {group.files.length === 1 ? "" : "s"}
          </span>
        </div>
        <div className="space-y-0.5 pl-1">
          {group.hunks.map((h, i) => (
            <div
              key={`${h.id}-${i}`}
              className="flex items-center gap-1.5 px-1.5 py-0.5"
            >
              <span className="truncate text-xs text-stone-400">
                {h.filePath}
              </span>
            </div>
          ))}
        </div>
      </button>

      <DialogContent
        className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col rounded-lg"
        onEscapeKeyDown={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <span>Identical Changes</span>
            <span className="rounded-full bg-stone-700/50 px-2 py-0.5 text-xs font-normal text-stone-400 tabular-nums">
              {totalCount} hunks
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

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="rounded bg-stone-700/60 px-1.5 py-0.5 text-xxs font-medium text-stone-400">
                Shared diff
              </span>
            </div>
            <HunkPreview
              hunk={group.representative}
              hunkState={hunkStates[group.representative.id]}
              highlighted
            />
          </div>

          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 border-t border-stone-700/50" />
            <span className="text-xxs text-stone-600">
              {totalCount} occurrence{totalCount === 1 ? "" : "s"}
            </span>
            <div className="flex-1 border-t border-stone-700/50" />
          </div>

          {group.hunks.map((hunk) => (
            <div key={hunk.id} className="group relative">
              <HunkPreview
                hunk={hunk}
                hunkState={hunkStates[hunk.id]}
                compact
              />
              <button
                className="absolute top-2 right-2 rounded bg-stone-700/80 px-2 py-1 text-xxs text-stone-300 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-stone-600"
                onClick={() => {
                  onNavigate(hunk.filePath, hunk.id);
                  setOpen(false);
                }}
              >
                Go to file
              </button>
            </div>
          ))}
        </div>

        {/* Action footer */}
        <div className="flex items-center justify-between border-t border-stone-800 px-4 py-3 bg-stone-900/50">
          <div className="text-xs text-stone-500">
            Batch action applies to all {totalCount} hunks
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                onRejectAll(group.hunks.map((h) => h.id));
                setOpen(false);
              }}
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
              onClick={() => {
                onApproveAll(group.hunks.map((h) => h.id));
                setOpen(false);
              }}
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

// ========================================================================
// Preview modal
// ========================================================================

interface PreviewTarget {
  filePath: string;
  hunkIds: string[];
  symbolName?: string;
}

function ConnectionPreviewModal({
  target,
  hunkById,
  hunkStates,
  onGoToFile,
  onClose,
}: {
  target: PreviewTarget;
  hunkById: Map<string, DiffHunk>;
  hunkStates: Record<string, HunkState>;
  onGoToFile: (filePath: string, hunkId: string) => void;
  onClose: () => void;
}) {
  const hunks = target.hunkIds
    .map((id) => hunkById.get(id))
    .filter((h): h is DiffHunk => !!h);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-2xl rounded-lg p-0">
        <DialogHeader>
          <div>
            <DialogTitle className="font-mono text-sm">
              {target.filePath.split("/").pop()}
            </DialogTitle>
            <DialogDescription>
              {target.filePath}
              {target.symbolName && (
                <span className="ml-2 text-amber-400/70">
                  &middot; {target.symbolName}
                </span>
              )}
            </DialogDescription>
          </div>
        </DialogHeader>

        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin p-4 space-y-3">
          {hunks.map((hunk) => (
            <HunkPreview
              key={hunk.id}
              hunk={hunk}
              hunkState={hunkStates[hunk.id]}
            />
          ))}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-stone-800">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-xs text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors"
          >
            Close
          </button>
          <button
            type="button"
            onClick={() => onGoToFile(target.filePath, target.hunkIds[0])}
            className="rounded-md bg-stone-800 px-3 py-1.5 text-xs text-stone-300 hover:bg-stone-700 hover:text-stone-100 transition-colors"
          >
            Open in diff view
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ========================================================================
// Main component
// ========================================================================

export function CrossFileSection() {
  const symbolLinkedHunks = useReviewStore((s) => s.symbolLinkedHunks);
  const allHunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);

  const hunkStates = reviewState?.hunks ?? {};
  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;

  const hunkById = useMemo(() => buildHunkById(allHunks), [allHunks]);

  const symbolConnections = useMemo(
    () =>
      computeSymbolConnections(
        symbolLinkedHunks,
        hunkById,
        hunkStates,
        trustList,
        autoApproveStaged,
        stagedFilePaths,
      ),
    [
      symbolLinkedHunks,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    ],
  );

  const identicalGroups = useMemo(
    () => computeIdenticalGroups(allHunks),
    [allHunks],
  );

  // Preview modal state
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget | null>(
    null,
  );

  const handlePreview = useCallback(
    (filePath: string, hunkIds: string[], symbolName?: string) => {
      setPreviewTarget({ filePath, hunkIds, symbolName });
    },
    [],
  );

  const handleGoToFile = useCallback(
    (filePath: string, hunkId: string) => {
      setPreviewTarget(null);
      navigateToBrowse(filePath);
      const hunkIndex = allHunks.findIndex((h) => h.id === hunkId);
      if (hunkIndex >= 0) {
        useReviewStore.setState({ focusedHunkIndex: hunkIndex });
      }
    },
    [navigateToBrowse, allHunks],
  );

  if (symbolConnections.length === 0 && identicalGroups.length === 0)
    return null;

  return (
    <div className="space-y-4">
      {/* Symbol connections */}
      {symbolConnections.length > 0 && (
        <div className="rounded-lg border border-stone-800 overflow-hidden">
          {symbolConnections.map((connection) => (
            <ConnectionCluster
              key={connection.symbolName}
              connection={connection}
              onPreview={handlePreview}
            />
          ))}
        </div>
      )}

      {/* Identical changes sub-group */}
      {identicalGroups.length > 0 && (
        <>
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-medium text-stone-500">
              Identical Changes
            </h4>
            <span className="rounded-full bg-stone-700/50 px-1.5 py-0.5 text-xxs text-stone-400 tabular-nums">
              {identicalGroups.length} group
              {identicalGroups.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="rounded-lg border border-stone-800 overflow-hidden">
            {identicalGroups.map((group, i) => (
              <IdenticalGroupRow
                key={i}
                group={group}
                hunkStates={hunkStates}
                onApproveAll={approveHunkIds}
                onRejectAll={rejectHunkIds}
                onNavigate={handleGoToFile}
              />
            ))}
          </div>
        </>
      )}

      {/* Preview modal */}
      {previewTarget && (
        <ConnectionPreviewModal
          target={previewTarget}
          hunkById={hunkById}
          hunkStates={hunkStates}
          onGoToFile={handleGoToFile}
          onClose={() => setPreviewTarget(null)}
        />
      )}
    </div>
  );
}

/** Returns the number of unreviewed cross-file connections, used for section badge */
export function useCrossFileNeedReviewCount(): number {
  const symbolLinkedHunks = useReviewStore((s) => s.symbolLinkedHunks);
  const allHunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);

  const hunkStates = reviewState?.hunks ?? {};
  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;

  const hunkById = useMemo(() => buildHunkById(allHunks), [allHunks]);

  return useMemo(() => {
    const connections = computeSymbolConnections(
      symbolLinkedHunks,
      hunkById,
      hunkStates,
      trustList,
      autoApproveStaged,
      stagedFilePaths,
    );
    return connections.reduce((sum, c) => sum + c.totalUnreviewed, 0);
  }, [
    symbolLinkedHunks,
    hunkById,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);
}
