import { useMemo, useCallback, useState } from "react";
import { useReviewStore } from "../../stores";
import type { DiffHunk, HunkState } from "../../types";
import { getChangedLinesKey } from "../../utils/changed-lines-key";
import { HunkPreview } from "../FileViewer/annotations/HunkPreview";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogClose,
} from "../ui/dialog";

interface IdenticalGroup {
  /** A representative hunk from the group */
  representative: DiffHunk;
  /** All hunks in this group */
  hunks: DiffHunk[];
  /** Unique file paths */
  files: string[];
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

  // Sort by group size (largest first)
  groups.sort((a, b) => b.hunks.length - a.hunks.length);
  return groups;
}

/** First few changed lines for a short preview label */
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
    pending: { dot: "bg-surface-active", text: "text-fg-muted" },
    approved: { dot: "bg-status-approved", text: "text-status-approved" },
    rejected: { dot: "bg-status-rejected", text: "text-status-rejected" },
  };

  const { dot, text } = colors[variant];

  return (
    <span className={`flex items-center gap-1.5 ${text}`}>
      <span className={`h-2 w-2 rounded-full ${dot}`} />
      {count} {label}
    </span>
  );
}

function IdenticalGroupModal({
  group,
  hunkStates,
  onApproveAll,
  onRejectAll,
  onNavigate,
}: {
  group: IdenticalGroup;
  hunkStates: Record<string, HunkState | undefined>;
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

  const handleApproveAll = () => {
    onApproveAll(group.hunks.map((h) => h.id));
    setOpen(false);
  };

  const handleRejectAll = () => {
    onRejectAll(group.hunks.map((h) => h.id));
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {/* Clickable row as trigger */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left border-b border-edge/50 last:border-b-0 px-3 py-2 hover:bg-surface-raised/30 transition-colors"
      >
        <div className="flex items-center gap-2 mb-1.5">
          <code className="text-xs font-mono text-fg-secondary truncate max-w-md">
            {getChangePreview(group.representative)}
          </code>
          <span className="flex-shrink-0 rounded-full bg-surface-hover/50 px-1.5 py-0.5 text-xxs text-fg-muted tabular-nums">
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
              <span className="truncate text-xs text-fg-muted">
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
            <span className="rounded-full bg-surface-hover/50 px-2 py-0.5 text-xs font-normal text-fg-muted tabular-nums">
              {totalCount} hunks
            </span>
          </DialogTitle>
          <DialogClose className="rounded p-1 text-fg0 hover:bg-surface-hover hover:text-fg-secondary transition-colors">
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
        <div className="flex items-center gap-4 border-b border-edge px-4 py-2 text-xs">
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

        {/* Scrollable list of hunk previews */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
          {/* Show one representative diff preview */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="rounded bg-surface-hover/60 px-1.5 py-0.5 text-xxs font-medium text-fg-muted">
                Shared diff
              </span>
            </div>
            <HunkPreview
              hunk={group.representative}
              hunkState={hunkStates[group.representative.id]}
              highlighted
            />
          </div>

          {/* Divider */}
          <div className="flex items-center gap-3 py-1">
            <div className="flex-1 border-t border-edge-default/50" />
            <span className="text-xxs text-fg-faint">
              {totalCount} occurrence{totalCount === 1 ? "" : "s"}
            </span>
            <div className="flex-1 border-t border-edge-default/50" />
          </div>

          {/* List of all hunks with file paths */}
          {group.hunks.map((hunk) => (
            <div key={hunk.id} className="group relative">
              <HunkPreview
                hunk={hunk}
                hunkState={hunkStates[hunk.id]}
                compact
              />
              <button
                className="absolute top-2 right-2 rounded bg-surface-hover/80 px-2 py-1 text-xxs text-fg-secondary opacity-0 group-hover:opacity-100 transition-opacity hover:bg-surface-active"
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
        <div className="flex items-center justify-between border-t border-edge px-4 py-3 bg-surface-panel/50">
          <div className="text-xs text-fg0">
            Batch action applies to all {totalCount} hunks
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleRejectAll}
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
              onClick={handleApproveAll}
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
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function IdenticalChangesSection() {
  const allHunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);

  const hunkStates: Record<string, HunkState | undefined> =
    reviewState?.hunks ?? {};

  const groups = useMemo(() => computeIdenticalGroups(allHunks), [allHunks]);

  const handleNavigate = useCallback(
    (filePath: string, hunkId: string) => {
      navigateToBrowse(filePath);
      const hunkIndex = allHunks.findIndex((h) => h.id === hunkId);
      if (hunkIndex >= 0) {
        useReviewStore.setState({ focusedHunkIndex: hunkIndex });
      }
    },
    [navigateToBrowse, allHunks],
  );

  if (groups.length === 0) return null;

  const totalDuplicates = groups.reduce((sum, g) => sum + g.hunks.length, 0);

  return (
    <div className="px-4 mb-6">
      <div className="flex items-center gap-2 mb-2">
        <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wide">
          Identical Changes
        </h3>
        <span className="rounded-full bg-surface-hover/50 px-1.5 py-0.5 text-xxs text-fg-muted tabular-nums">
          {groups.length} group{groups.length === 1 ? "" : "s"} &middot;{" "}
          {totalDuplicates} hunks
        </span>
      </div>

      <div className="rounded-lg border border-edge overflow-hidden">
        {groups.map((group, i) => (
          <IdenticalGroupModal
            key={i}
            group={group}
            hunkStates={hunkStates}
            onApproveAll={approveHunkIds}
            onRejectAll={rejectHunkIds}
            onNavigate={handleNavigate}
          />
        ))}
      </div>
    </div>
  );
}
