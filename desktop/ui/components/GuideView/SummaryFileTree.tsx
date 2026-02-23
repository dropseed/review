import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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
  TreeFileIcon,
  fileNameColor,
} from "../tree";
import {
  SymbolKindBadge,
  ChangeIndicator,
  sortSymbols,
  symbolNameColor,
} from "../symbols";
import type { FileHunkStatus } from "../tree";
import type { ProcessedFileEntry } from "../FilesPanel/types";
import type {
  DiffHunk,
  HunkState,
  FileSymbolDiff,
  SymbolDiff,
} from "../../types";
import { isHunkTrusted } from "../../types";

/** Per-file trust labels, precomputed once */
interface FileTrustInfo {
  /** Unique trust labels across all trusted hunks in this file */
  trustLabels: string[];
}

function computeFileTrustInfo(
  hunks: DiffHunk[],
  reviewState: { hunks: Record<string, HunkState>; trustList: string[] } | null,
): Map<string, FileTrustInfo> {
  const map = new Map<string, FileTrustInfo>();

  for (const hunk of hunks) {
    if (!reviewState) continue;

    const hunkState = reviewState.hunks[hunk.id];
    if (isHunkTrusted(hunkState, reviewState.trustList) && hunkState?.label) {
      let info = map.get(hunk.filePath);
      if (!info) {
        info = { trustLabels: [] };
        map.set(hunk.filePath, info);
      }
      for (const label of hunkState.label) {
        if (!info.trustLabels.includes(label)) {
          info.trustLabels.push(label);
        }
      }
    }
  }

  return map;
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

/** Stable React key for a SymbolDiff node */
function symbolKey(sym: SymbolDiff): string {
  const line = sym.newRange?.startLine ?? sym.oldRange?.startLine ?? 0;
  return `${sym.changeType}-${sym.name}-${line}`;
}

// --- Inline sub-components ---

function ReviewProgressBar({ status }: { status: FileHunkStatus }): ReactNode {
  if (status.total === 0) return null;

  const reviewed = status.approved + status.trusted;
  const rejected = status.rejected;
  const total = status.total;
  const reviewedPct = (reviewed / total) * 100;
  const rejectedPct = (rejected / total) * 100;

  return (
    <div className="flex-shrink-0 flex items-center gap-1.5">
      <span className="font-mono text-xxs tabular-nums text-fg-muted">
        {reviewed + rejected}/{total}
      </span>
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

// --- Symbol tree node (recursive) ---

function SymbolTreeNode({
  sym,
  depth,
  filePath,
  onNavigateToHunk,
}: {
  sym: SymbolDiff;
  depth: number;
  filePath: string;
  onNavigateToHunk: (filePath: string, hunkId: string) => void;
}): ReactNode {
  const hasChildren = sym.children.length > 0;
  const sortedChildren = hasChildren ? sortSymbols(sym.children) : [];

  // For containers with no direct hunks, navigate to the first child's hunk
  let firstHunkId = sym.hunkIds[0];
  if (!firstHunkId && hasChildren) {
    for (const child of sym.children) {
      if (child.hunkIds.length > 0) {
        firstHunkId = child.hunkIds[0];
        break;
      }
    }
  }

  return (
    <>
      <TreeRow
        depth={depth}
        className="hover:bg-surface-raised/40 cursor-pointer"
      >
        <TreeRowButton
          onClick={
            firstHunkId
              ? () => onNavigateToHunk(filePath, firstHunkId)
              : undefined
          }
        >
          <TreeChevron expanded={false} visible={false} />
          <ChangeIndicator changeType={sym.changeType} />
          <SymbolKindBadge kind={sym.kind} />
          <TreeNodeName
            className={`text-xxs ${symbolNameColor(sym.changeType)}`}
          >
            {sym.name}
          </TreeNodeName>
        </TreeRowButton>
      </TreeRow>
      {sortedChildren.map((child) => (
        <SymbolTreeNode
          key={symbolKey(child)}
          sym={child}
          depth={depth + 1}
          filePath={filePath}
          onNavigateToHunk={onNavigateToHunk}
        />
      ))}
    </>
  );
}

// --- Tree node ---

interface CompactNodeProps {
  entry: ProcessedFileEntry;
  depth: number;
  collapsed: Set<string>;
  onToggle: (path: string) => void;
  onNavigate: (filePath: string) => void;
  onNavigateToHunk: (filePath: string, hunkId: string) => void;
  fileTrustInfo: Map<string, FileTrustInfo>;
  symbolDiffMap: Map<string, FileSymbolDiff>;
}

function CompactNode({
  entry,
  depth,
  collapsed,
  onToggle,
  onNavigate,
  onNavigateToHunk,
  fileTrustInfo,
  symbolDiffMap,
}: CompactNodeProps): ReactNode {
  if (entry.isDirectory && entry.children) {
    const isCollapsed = collapsed.has(entry.path);

    return (
      <TreeNodeItem>
        <TreeRow
          depth={depth}
          className="hover:bg-surface-raised/40 cursor-pointer"
        >
          <TreeRowButton onClick={() => onToggle(entry.path)}>
            <TreeChevron expanded={!isCollapsed} />
            <TreeFileIcon
              name={entry.displayName}
              isDirectory
              isSymlink={entry.isSymlink}
              symlinkTarget={entry.symlinkTarget}
            />
            <TreeNodeName className="text-fg-muted">
              {entry.displayName}
            </TreeNodeName>
          </TreeRowButton>
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
              onNavigateToHunk={onNavigateToHunk}
              fileTrustInfo={fileTrustInfo}
              symbolDiffMap={symbolDiffMap}
            />
          ))}
      </TreeNodeItem>
    );
  }

  const trustInfo = fileTrustInfo.get(entry.path);
  const isFullyTrusted =
    entry.hunkStatus.total > 0 &&
    entry.hunkStatus.trusted === entry.hunkStatus.total;

  const fileDiff = symbolDiffMap.get(entry.path);
  const sortedSymbols = fileDiff ? sortSymbols(fileDiff.symbols) : [];

  return (
    <TreeNodeItem>
      <TreeRow
        depth={depth}
        className="hover:bg-surface-raised/40 cursor-pointer"
      >
        <TreeRowButton onClick={() => onNavigate(entry.path)}>
          <TreeChevron expanded={false} visible={false} />
          <TreeFileIcon
            name={entry.displayName}
            isDirectory={false}
            isSymlink={entry.isSymlink}
            symlinkTarget={entry.symlinkTarget}
          />
          <TreeNodeName className={fileNameColor(false, false, entry.status)}>
            {entry.displayName}
          </TreeNodeName>
        </TreeRowButton>
        {isFullyTrusted && <TrustChips labels={trustInfo?.trustLabels ?? []} />}
        <ReviewProgressBar status={entry.hunkStatus} />
      </TreeRow>
      {sortedSymbols.map((sym) => (
        <SymbolTreeNode
          key={symbolKey(sym)}
          sym={sym}
          depth={depth + 1}
          filePath={entry.path}
          onNavigateToHunk={onNavigateToHunk}
        />
      ))}
    </TreeNodeItem>
  );
}

// --- Main component ---

export function SummaryFileTree(): ReactNode {
  const files = useReviewStore((s) => s.files);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!symbolsLoaded && !symbolsLoading && files.length > 0) {
      loadSymbols();
    }
  }, [symbolsLoaded, symbolsLoading, files.length, loadSymbols]);

  const symbolDiffMap = useMemo(() => {
    const map = new Map<string, FileSymbolDiff>();
    for (const fd of symbolDiffs) {
      map.set(fd.filePath, fd);
    }
    return map;
  }, [symbolDiffs]);

  const tree = useMemo(() => {
    const hunkStatusMap = calculateFileHunkStatus(hunks, reviewState);
    const processed = processTree(files, hunkStatusMap, "changes");
    const visible = processed.filter((e) => e.matchesFilter);
    return compactFiltered(visible);
  }, [files, hunks, reviewState]);

  const fileTrustInfo = useMemo(
    () => computeFileTrustInfo(hunks, reviewState),
    [hunks, reviewState],
  );

  const hunkIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < hunks.length; i++) {
      map.set(hunks[i].id, i);
    }
    return map;
  }, [hunks]);

  const handleNavigateToHunk = useCallback(
    (filePath: string, hunkId: string) => {
      // Single atomic state update to avoid race between navigateToBrowse
      // (which sets focusedHunkIndex to first unreviewed) and our override.
      const hunkIndex = hunkIndexMap.get(hunkId);
      useReviewStore.setState({
        guideContentMode: null,
        selectedFile: filePath,
        filesPanelCollapsed: false,
        ...(hunkIndex !== undefined && { focusedHunkIndex: hunkIndex }),
      });
    },
    [hunkIndexMap],
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

  if (tree.length === 0) return null;

  return (
    <div className="rounded-lg border border-edge p-3">
      <h3 className="text-xs font-medium text-fg-muted uppercase tracking-wide pb-2 mb-1">
        Changed Files
      </h3>
      <div className="space-y-px">
        {tree.map((entry) => (
          <CompactNode
            key={entry.path}
            entry={entry}
            depth={0}
            collapsed={collapsed}
            onToggle={handleToggle}
            onNavigate={navigateToBrowse}
            onNavigateToHunk={handleNavigateToHunk}
            fileTrustInfo={fileTrustInfo}
            symbolDiffMap={symbolDiffMap}
          />
        ))}
      </div>
    </div>
  );
}
