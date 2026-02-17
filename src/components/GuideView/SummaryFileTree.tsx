import { useMemo, useState } from "react";
import { useReviewStore } from "../../stores";
import {
  processTree,
  calculateFileHunkStatus,
} from "../FilesPanel/FileTree.utils";
import { StatusLetter, HunkCount } from "../FilesPanel/StatusIndicators";
import type { ProcessedFileEntry } from "../FilesPanel/types";

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      className={`w-3 h-3 text-fg0 transition-transform ${collapsed ? "-rotate-90" : ""}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// Compact single-visible-child directory chains after filtering by matchesFilter.
// processTree's compactTree only compacts based on the full tree structure,
// but in "changes" mode many directories have only one *visible* child.
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

function indentStyle(depth: number): { paddingLeft: string } {
  return { paddingLeft: `${depth * 0.75 + 0.375}rem` };
}

const ROW_CLASS =
  "flex items-center gap-1 w-full text-left hover:bg-surface-raised/50 rounded px-1.5 py-0.5";

interface CompactNodeProps {
  entry: ProcessedFileEntry;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (filePath: string) => void;
}

function CompactNode({
  entry,
  depth,
  collapsed,
  onToggle,
  onNavigate,
}: CompactNodeProps) {
  if (entry.isDirectory && entry.children) {
    const isCollapsed = collapsed.has(entry.path);

    return (
      <div>
        <button
          type="button"
          onClick={() => onToggle(entry.path)}
          className={ROW_CLASS}
          style={indentStyle(depth)}
        >
          <ChevronIcon collapsed={isCollapsed} />
          <span className="text-xs text-fg-muted truncate">
            {entry.displayName}
          </span>
          <span className="ml-auto shrink-0">
            <HunkCount status={entry.hunkStatus} context="all" />
          </span>
        </button>
        {!isCollapsed &&
          entry.children.map((child) => (
            <CompactNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              collapsed={collapsed}
              onToggle={onToggle}
              onNavigate={onNavigate}
            />
          ))}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onNavigate(entry.path)}
      className={`${ROW_CLASS} cursor-pointer`}
      style={indentStyle(depth)}
    >
      <StatusLetter status={entry.status} />
      <span className="text-xs text-fg-secondary truncate">
        {entry.displayName}
      </span>
      <span className="ml-auto shrink-0">
        <HunkCount status={entry.hunkStatus} context="all" />
      </span>
    </button>
  );
}

export function SummaryFileTree() {
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

  const handleToggle = (path: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const diffStats = useMemo(() => {
    let additions = 0;
    let deletions = 0;
    const filePaths = new Set<string>();
    for (const hunk of hunks) {
      filePaths.add(hunk.filePath);
      for (const line of hunk.lines) {
        if (line.type === "added") additions++;
        else if (line.type === "removed") deletions++;
      }
    }
    return { fileCount: filePaths.size, additions, deletions };
  }, [hunks]);

  if (tree.length === 0) return null;

  return (
    <div className="rounded-lg border border-edge p-3">
      <h3 className="text-xs font-medium text-fg0 uppercase tracking-wide pb-2 mb-1">
        Changed Files
      </h3>
      <div className="flex items-center gap-2 text-xs tabular-nums mb-2">
        <span className="text-fg-muted">
          {diffStats.fileCount} {diffStats.fileCount === 1 ? "file" : "files"}
        </span>
        <span className="text-status-approved/70">+{diffStats.additions}</span>
        <span className="text-status-rejected/70">-{diffStats.deletions}</span>
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
          />
        ))}
      </div>
    </div>
  );
}
