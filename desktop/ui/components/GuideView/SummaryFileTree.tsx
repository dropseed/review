import { type ReactNode, useMemo, useState } from "react";
import { useReviewStore } from "../../stores";
import {
  processTree,
  calculateFileHunkStatus,
} from "../FilesPanel/FileTree.utils";
import {
  TreeNodeItem,
  TreeRow,
  TreeRowButton,
  TreeChevron,
  TreeNodeName,
  StatusLetter,
  TreeFileIcon,
} from "../tree";
import type { FileHunkStatus } from "../tree";
import type { ProcessedFileEntry } from "../FilesPanel/types";
import type { DiffHunk, HunkState } from "../../types";
import { isHunkTrusted } from "../../types";

/** Per-file diff + review stats, precomputed once */
interface FileDiffStats {
  additions: number;
  deletions: number;
  /** Unique trust labels across all trusted hunks in this file */
  trustLabels: string[];
}

/** Per-directory aggregated diff stats */
interface DirDiffStats {
  additions: number;
  deletions: number;
}

function computeFileDiffStats(
  hunks: DiffHunk[],
  reviewState: { hunks: Record<string, HunkState>; trustList: string[] } | null,
): Map<string, FileDiffStats> {
  const map = new Map<string, FileDiffStats>();

  for (const hunk of hunks) {
    let stats = map.get(hunk.filePath);
    if (!stats) {
      stats = { additions: 0, deletions: 0, trustLabels: [] };
      map.set(hunk.filePath, stats);
    }

    for (const line of hunk.lines) {
      if (line.type === "added") stats.additions++;
      else if (line.type === "removed") stats.deletions++;
    }

    // Collect trust labels for trusted hunks
    if (reviewState) {
      const hunkState = reviewState.hunks[hunk.id];
      if (isHunkTrusted(hunkState, reviewState.trustList) && hunkState?.label) {
        for (const label of hunkState.label) {
          if (!stats.trustLabels.includes(label)) {
            stats.trustLabels.push(label);
          }
        }
      }
    }
  }

  return map;
}

/** Aggregate +/− across all files in a subtree */
function aggregateDirStats(
  entry: ProcessedFileEntry,
  fileStats: Map<string, FileDiffStats>,
): DirDiffStats {
  if (!entry.isDirectory || !entry.children) {
    const s = fileStats.get(entry.path);
    return { additions: s?.additions ?? 0, deletions: s?.deletions ?? 0 };
  }
  let additions = 0;
  let deletions = 0;
  for (const child of entry.children) {
    const childStats = aggregateDirStats(child, fileStats);
    additions += childStats.additions;
    deletions += childStats.deletions;
  }
  return { additions, deletions };
}

/**
 * Compact single-visible-child directory chains after filtering by matchesFilter.
 */
function compactFiltered(entries: ProcessedFileEntry[]): ProcessedFileEntry[] {
  return entries.map((entry) => {
    if (!entry.isDirectory || !entry.children) return entry;

    const visible = entry.children.filter((c) => c.matchesFilter);
    let compacted: ProcessedFileEntry = {
      ...entry,
      children: compactFiltered(visible),
    };

    while (
      compacted.children &&
      compacted.children.length === 1 &&
      compacted.children[0].isDirectory
    ) {
      const onlyChild = compacted.children[0];
      compacted = {
        ...compacted,
        displayName: `${compacted.displayName}/${onlyChild.displayName}`,
        compactedPaths: [
          ...compacted.compactedPaths,
          ...onlyChild.compactedPaths,
        ],
        children: onlyChild.children,
        path: onlyChild.path,
        hunkStatus: onlyChild.hunkStatus,
      };
    }

    return compacted;
  });
}

// --- Inline sub-components ---

function DiffLineStats({
  additions,
  deletions,
}: {
  additions: number;
  deletions: number;
}): ReactNode {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="flex-shrink-0 font-mono text-xxs tabular-nums flex items-center gap-1">
      {additions > 0 && (
        <span className="text-diff-added/70">+{additions}</span>
      )}
      {deletions > 0 && (
        <span className="text-diff-removed/70">&minus;{deletions}</span>
      )}
    </span>
  );
}

function ReviewProgressBar({ status }: { status: FileHunkStatus }): ReactNode {
  if (status.total === 0) return null;

  const reviewed = status.approved + status.trusted;
  const rejected = status.rejected;
  const total = status.total;
  const reviewedPct = (reviewed / total) * 100;
  const rejectedPct = (rejected / total) * 100;

  return (
    <div className="flex-shrink-0 flex items-center gap-1.5">
      <div className="w-12 h-1 rounded-full bg-surface-raised overflow-hidden flex">
        {reviewedPct > 0 && (
          <div
            className="h-full bg-status-approved"
            style={{ width: `${reviewedPct}%` }}
          />
        )}
        {rejectedPct > 0 && (
          <div
            className="h-full bg-status-rejected"
            style={{ width: `${rejectedPct}%` }}
          />
        )}
      </div>
      <span className="font-mono text-xxs tabular-nums text-fg-muted">
        {reviewed + rejected}/{total}
      </span>
    </div>
  );
}

/** Extract the category from a label like "imports:added" → "imports" */
function labelCategory(label: string): string {
  const i = label.indexOf(":");
  return i >= 0 ? label.substring(0, i) : label;
}

function TrustChips({ labels }: { labels: string[] }): ReactNode {
  if (labels.length === 0) return null;

  // Dedupe by category, show at most 3
  const categories = [...new Set(labels.map(labelCategory))];
  const shown = categories.slice(0, 3);
  const overflow = categories.length - shown.length;

  return (
    <span className="flex-shrink-0 flex items-center gap-0.5">
      {shown.map((cat) => (
        <span
          key={cat}
          className="rounded bg-status-approved/10 px-1 py-px text-xxs text-status-approved"
        >
          {cat}
        </span>
      ))}
      {overflow > 0 && (
        <span className="text-xxs text-fg-muted">+{overflow}</span>
      )}
    </span>
  );
}

// --- Tree node ---

interface CompactNodeProps {
  entry: ProcessedFileEntry;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (filePath: string) => void;
  fileStats: Map<string, FileDiffStats>;
}

function CompactNode({
  entry,
  depth,
  collapsed,
  onToggle,
  onNavigate,
  fileStats,
}: CompactNodeProps): ReactNode {
  if (entry.isDirectory && entry.children) {
    const isCollapsed = collapsed.has(entry.path);
    const dirStats = aggregateDirStats(entry, fileStats);

    return (
      <TreeNodeItem>
        <TreeRow
          depth={depth}
          className="hover:bg-surface-raised/40 cursor-pointer"
        >
          <TreeRowButton onClick={() => onToggle(entry.path)}>
            <TreeChevron expanded={!isCollapsed} />
            <TreeFileIcon name={entry.displayName} isDirectory />
            <TreeNodeName className="text-fg-muted">
              {entry.displayName}
            </TreeNodeName>
          </TreeRowButton>
          <DiffLineStats
            additions={dirStats.additions}
            deletions={dirStats.deletions}
          />
          <ReviewProgressBar status={entry.hunkStatus} />
        </TreeRow>
        {!isCollapsed &&
          entry.children.map((child) => (
            <CompactNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onNavigate={onNavigate}
              fileStats={fileStats}
            />
          ))}
      </TreeNodeItem>
    );
  }

  const stats = fileStats.get(entry.path);
  const isFullyTrusted =
    entry.hunkStatus.total > 0 &&
    entry.hunkStatus.trusted === entry.hunkStatus.total;

  return (
    <TreeNodeItem>
      <TreeRow
        depth={depth}
        className="hover:bg-surface-raised/40 cursor-pointer"
      >
        <TreeRowButton onClick={() => onNavigate(entry.path)}>
          <TreeChevron expanded={false} visible={false} />
          <TreeFileIcon name={entry.displayName} isDirectory={false} />
          <TreeNodeName className="text-fg-secondary">
            {entry.displayName}
          </TreeNodeName>
        </TreeRowButton>
        {isFullyTrusted && <TrustChips labels={stats?.trustLabels ?? []} />}
        <DiffLineStats
          additions={stats?.additions ?? 0}
          deletions={stats?.deletions ?? 0}
        />
        <ReviewProgressBar status={entry.hunkStatus} />
        <StatusLetter status={entry.status} />
      </TreeRow>
    </TreeNodeItem>
  );
}

// --- Main component ---

export function SummaryFileTree(): ReactNode {
  const files = useReviewStore((s) => s.files);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => {
    const hunkStatusMap = calculateFileHunkStatus(hunks, reviewState);
    const processed = processTree(files, hunkStatusMap, "changes");
    const visible = processed.filter((e) => e.matchesFilter);
    return compactFiltered(visible);
  }, [files, hunks, reviewState]);

  const fileStats = useMemo(
    () => computeFileDiffStats(hunks, reviewState),
    [hunks, reviewState],
  );

  function handleToggle(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  const diffStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    for (const stats of fileStats.values()) {
      additions += stats.additions;
      deletions += stats.deletions;
    }
    return { fileCount: fileStats.size, additions, deletions };
  }, [fileStats]);

  if (tree.length === 0) return null;

  return (
    <div className="rounded-lg border border-edge p-3">
      <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wide pb-2 mb-1">
        Changed Files
      </h3>
      <div className="flex items-center gap-2 text-xs tabular-nums mb-2">
        <span className="text-fg-muted">
          {diffStats.fileCount} {diffStats.fileCount === 1 ? "file" : "files"}
        </span>
        <span className="text-diff-added/70">+{diffStats.additions}</span>
        <span className="text-diff-removed/70">
          &minus;{diffStats.deletions}
        </span>
      </div>
      <div className="space-y-px">
        {tree.map((entry) => (
          <CompactNode
            key={entry.path}
            entry={entry}
            depth={0}
            collapsed={collapsed}
            onToggle={handleToggle}
            onNavigate={navigateToBrowse}
            fileStats={fileStats}
          />
        ))}
      </div>
    </div>
  );
}
