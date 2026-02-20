import { type ReactNode, useState, useEffect, useMemo, memo } from "react";
import { useReviewStore } from "../../stores";
import { getApiClient } from "../../api";
import { useFileHunkStatusMap } from "../../hooks/useFileHunkStatusMap";
import { EMPTY_HUNK_STATUS } from "../FilesPanel/FileTree.utils";
import { SymbolKindBadge } from "../symbols";
import {
  TreeNodeItem,
  TreeRow,
  TreeRowButton,
  TreeChevron,
  TreeNodeName,
  HunkCount,
  treeIndent,
  type FileHunkStatus,
} from "../tree";
import type { FileSymbol, RepoFileSymbols, SymbolDiff } from "../../types";

function Spinner(): ReactNode {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/** Filter FileSymbol[] to only include symbols that have a matching SymbolDiff */
function filterChangedSymbols(
  symbols: FileSymbol[],
  diffs: SymbolDiff[],
): FileSymbol[] {
  const diffByName = new Map<string, SymbolDiff>();
  for (const d of diffs) {
    diffByName.set(d.name, d);
  }

  const result: FileSymbol[] = [];
  for (const sym of symbols) {
    const diff = diffByName.get(sym.name);
    if (!diff) continue;

    if (sym.children.length > 0 && diff.children.length > 0) {
      const filteredChildren = filterChangedSymbols(
        sym.children,
        diff.children,
      );
      result.push({ ...sym, children: filteredChildren });
    } else {
      result.push(sym);
    }
  }

  return result;
}

/** Count symbols recursively */
function countSymbols(symbols: FileSymbol[]): number {
  let n = 0;
  for (const s of symbols) {
    n++;
    n += countSymbols(s.children);
  }
  return n;
}

const SymbolLeaf = memo(function SymbolLeaf({
  symbol,
  depth,
  dimmed,
  symbolDiff,
}: {
  symbol: FileSymbol;
  depth: number;
  /** When true, this symbol is not in the diff and should appear faint */
  dimmed?: boolean;
  /** The corresponding SymbolDiff, used to determine which children are changed */
  symbolDiff?: SymbolDiff;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasChildren = symbol.children.length > 0;

  const childDiffMap = useMemo(() => {
    if (!symbolDiff || symbolDiff.children.length === 0) return undefined;
    const map = new Map<string, SymbolDiff>();
    for (const c of symbolDiff.children) {
      map.set(c.name, c);
    }
    return map;
  }, [symbolDiff]);

  return (
    <TreeNodeItem>
      <TreeRow depth={depth} className="hover:bg-surface-raised/40">
        <TreeRowButton
          onClick={hasChildren ? () => setExpanded(!expanded) : undefined}
          aria-expanded={hasChildren ? expanded : undefined}
        >
          <TreeChevron expanded={expanded} visible={hasChildren} />
          <SymbolKindBadge kind={symbol.kind} />
          <TreeNodeName
            className={dimmed ? "text-fg-faint" : "text-fg-secondary"}
          >
            {symbol.name}
          </TreeNodeName>
        </TreeRowButton>
        <span className="font-mono text-xxs tabular-nums text-fg-muted flex-shrink-0">
          {symbol.startLine}
        </span>
      </TreeRow>
      {expanded && hasChildren && (
        <div>
          {symbol.children.map((child) => {
            // If we have diff info, determine if child is changed
            const childDiff = childDiffMap?.get(child.name);
            const childDimmed =
              childDiffMap !== undefined ? !childDiff : dimmed;

            return (
              <SymbolLeaf
                key={`${child.kind}-${child.name}-${child.startLine}`}
                symbol={child}
                depth={depth + 1}
                dimmed={childDimmed}
                symbolDiff={childDiff}
              />
            );
          })}
        </div>
      )}
    </TreeNodeItem>
  );
});

function fileNameColor(
  hasSymbols: boolean,
  hunkStatus: FileHunkStatus | undefined,
): string {
  if (!hunkStatus || hunkStatus.total === 0) {
    return hasSymbols ? "text-fg-muted" : "text-fg-faint";
  }
  if (hunkStatus.pending > 0) return "text-fg-secondary";
  if (hunkStatus.rejected > 0) return "text-status-rejected";
  return "text-status-approved";
}

const FileNode = memo(function FileNode({
  file,
  depth,
  defaultExpanded,
  hunkStatus,
  changedSymbols,
}: {
  file: RepoFileSymbols;
  depth: number;
  defaultExpanded: boolean;
  hunkStatus?: FileHunkStatus;
  /** SymbolDiff[] for this file from symbolDiffs, if available */
  changedSymbols?: SymbolDiff[];
}) {
  const [showAllSymbols, setShowAllSymbols] = useState(false);

  const { displaySymbols, fileDiffMap } = useMemo(() => {
    if (!changedSymbols || changedSymbols.length === 0 || showAllSymbols) {
      const map = new Map<string, SymbolDiff>();
      if (changedSymbols) {
        for (const d of changedSymbols) {
          map.set(d.name, d);
        }
      }
      return {
        displaySymbols: file.symbols,
        fileDiffMap: changedSymbols ? map : undefined,
      };
    }
    return {
      displaySymbols: filterChangedSymbols(file.symbols, changedSymbols),
      fileDiffMap: undefined,
    };
  }, [file.symbols, changedSymbols, showAllSymbols]);

  const hasSymbols = displaySymbols.length > 0;
  const [expanded, setExpanded] = useState(defaultExpanded && hasSymbols);

  const totalCount = useMemo(() => countSymbols(file.symbols), [file.symbols]);
  const displayCount = useMemo(
    () => countSymbols(displaySymbols),
    [displaySymbols],
  );
  const hasHiddenSymbols =
    changedSymbols && changedSymbols.length > 0 && displayCount < totalCount;

  const basename = useMemo(() => {
    const lastSlash = file.filePath.lastIndexOf("/");
    return lastSlash >= 0 ? file.filePath.slice(lastSlash + 1) : file.filePath;
  }, [file.filePath]);

  return (
    <TreeNodeItem>
      <TreeRow depth={depth} className="hover:bg-surface-raised/40">
        <TreeRowButton
          onClick={
            hasSymbols || hasHiddenSymbols
              ? () => setExpanded(!expanded)
              : undefined
          }
          aria-expanded={hasSymbols || hasHiddenSymbols ? expanded : undefined}
        >
          <TreeChevron
            expanded={expanded}
            visible={!!(hasSymbols || hasHiddenSymbols)}
          />
          <TreeNodeName className={fileNameColor(hasSymbols, hunkStatus)}>
            {basename}
          </TreeNodeName>
        </TreeRowButton>

        {hunkStatus && hunkStatus.total > 0 && (
          <HunkCount status={hunkStatus} context="all" />
        )}
      </TreeRow>
      {expanded && (
        <div>
          {displaySymbols.map((sym) => {
            const symDiff = fileDiffMap?.get(sym.name);
            const dimmed = fileDiffMap !== undefined ? !symDiff : undefined;

            return (
              <SymbolLeaf
                key={`${sym.kind}-${sym.name}-${sym.startLine}`}
                symbol={sym}
                depth={depth + 1}
                dimmed={dimmed}
                symbolDiff={symDiff}
              />
            );
          })}
          {hasHiddenSymbols && (
            <div
              className="py-0.5"
              style={{ paddingLeft: treeIndent(depth + 1) }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowAllSymbols(!showAllSymbols);
                }}
                className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
              >
                {showAllSymbols
                  ? "Show changed only"
                  : `Show all ${totalCount} symbols`}
              </button>
            </div>
          )}
        </div>
      )}
    </TreeNodeItem>
  );
});

interface DirGroup {
  name: string;
  files: RepoFileSymbols[];
  children: Map<string, DirGroup>;
}

function buildDirTree(files: RepoFileSymbols[]): DirGroup {
  const root: DirGroup = { name: "", files: [], children: new Map() };

  for (const file of files) {
    const parts = file.filePath.split("/");
    parts.pop(); // remove filename, keep directory parts
    let current = root;

    for (const part of parts) {
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          files: [],
          children: new Map(),
        });
      }
      current = current.children.get(part)!;
    }

    current.files.push(file);
  }

  return root;
}

/** Collapse single-child directories (e.g., src/components -> src/components) */
function collapseDirTree(group: DirGroup, prefix = ""): DirGroup {
  if (group.children.size === 1 && group.files.length === 0) {
    const [childName, child] = [...group.children.entries()][0];
    const newPrefix = prefix ? `${prefix}/${childName}` : childName;
    return collapseDirTree(child, newPrefix);
  }

  const name = [prefix, group.name].filter(Boolean).join("/");
  const collapsed = new Map<string, DirGroup>();
  for (const [key, child] of group.children) {
    collapsed.set(key, collapseDirTree(child));
  }

  return { name, files: group.files, children: collapsed };
}

/** Aggregate hunk status across all files in a directory group */
function aggregateHunkStatus(
  group: DirGroup,
  hunkStatusMap: Map<string, FileHunkStatus>,
): FileHunkStatus {
  const result = { ...EMPTY_HUNK_STATUS };

  for (const file of group.files) {
    const status = hunkStatusMap.get(file.filePath);
    if (status) {
      result.pending += status.pending;
      result.approved += status.approved;
      result.trusted += status.trusted;
      result.rejected += status.rejected;
      result.savedForLater += status.savedForLater;
      result.total += status.total;
    }
  }

  for (const child of group.children.values()) {
    const childStatus = aggregateHunkStatus(child, hunkStatusMap);
    result.pending += childStatus.pending;
    result.approved += childStatus.approved;
    result.trusted += childStatus.trusted;
    result.rejected += childStatus.rejected;
    result.savedForLater += childStatus.savedForLater;
    result.total += childStatus.total;
  }

  return result;
}

const DirNode = memo(function DirNode({
  group,
  depth,
  diffFiles,
  hunkStatusMap,
  symbolDiffMap,
}: {
  group: DirGroup;
  depth: number;
  diffFiles: Set<string>;
  hunkStatusMap: Map<string, FileHunkStatus>;
  symbolDiffMap: Map<string, SymbolDiff[]>;
}) {
  const hasDiffContent = useMemo(() => {
    function check(g: DirGroup): boolean {
      if (g.files.some((f) => diffFiles.has(f.filePath))) return true;
      for (const child of g.children.values()) {
        if (check(child)) return true;
      }
      return false;
    }
    return check(group);
  }, [group, diffFiles]);

  const [expanded, setExpanded] = useState(hasDiffContent || depth < 1);

  const sortedChildren = useMemo(
    () =>
      [...group.children.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [group.children],
  );

  const dirHunkStatus = useMemo(
    () => aggregateHunkStatus(group, hunkStatusMap),
    [group, hunkStatusMap],
  );

  const childDepth = group.name ? depth + 1 : depth;

  return (
    <div className="file-node-item">
      {group.name && (
        <TreeRow
          depth={depth}
          className="select-none hover:bg-surface-raised/40"
        >
          <TreeRowButton
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            <TreeChevron expanded={expanded} />
            <TreeNodeName className="text-fg-secondary">
              {group.name}
            </TreeNodeName>
          </TreeRowButton>

          {dirHunkStatus.total > 0 && (
            <HunkCount status={dirHunkStatus} context="all" />
          )}
        </TreeRow>
      )}
      {(expanded || !group.name) && (
        <div>
          {sortedChildren.map((child) => (
            <DirNode
              key={child.name}
              group={child}
              depth={childDepth}
              diffFiles={diffFiles}
              hunkStatusMap={hunkStatusMap}
              symbolDiffMap={symbolDiffMap}
            />
          ))}
          {group.files.map((file) => (
            <FileNode
              key={file.filePath}
              file={file}
              depth={childDepth}
              defaultExpanded={diffFiles.has(file.filePath)}
              hunkStatus={hunkStatusMap.get(file.filePath)}
              changedSymbols={symbolDiffMap.get(file.filePath)}
            />
          ))}
        </div>
      )}
    </div>
  );
});

type SymbolsScope = "changed" | "all";

export function RepoSymbolsView(): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);

  const hunkStatusMap = useFileHunkStatusMap();

  const [scope, setScope] = useState<SymbolsScope>("changed");
  const [repoSymbols, setRepoSymbols] = useState<RepoFileSymbols[] | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!repoPath) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    getApiClient()
      .getRepoSymbols(repoPath)
      .then((result) => {
        if (!cancelled) {
          setRepoSymbols(result);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [repoPath]);

  const symbolDiffMap = useMemo(() => {
    const map = new Map<string, SymbolDiff[]>();
    if (symbolsLoaded) {
      for (const fd of symbolDiffs) {
        map.set(fd.filePath, fd.symbols);
      }
    }
    return map;
  }, [symbolDiffs, symbolsLoaded]);

  const diffFiles = useMemo(
    () => new Set(hunkStatusMap.keys()),
    [hunkStatusMap],
  );

  const { dirTree, totalFiles, totalSymbols } = useMemo(() => {
    if (!repoSymbols) return { dirTree: null, totalFiles: 0, totalSymbols: 0 };

    const filtered =
      scope === "changed"
        ? repoSymbols.filter((f) => diffFiles.has(f.filePath))
        : repoSymbols;

    const tree = buildDirTree(filtered);
    const collapsed = collapseDirTree(tree);

    let symCount = 0;
    for (const f of filtered) {
      symCount += countSymbols(f.symbols);
    }

    return {
      dirTree: collapsed,
      totalFiles: filtered.length,
      totalSymbols: symCount,
    };
  }, [repoSymbols, scope, diffFiles]);

  if (loading) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 text-fg-muted">
          <Spinner />
          <span className="text-xs">Loading repo symbols…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-status-rejected/50 bg-status-rejected/10 p-4">
          <p className="text-xs text-status-rejected">{error}</p>
        </div>
      </div>
    );
  }

  if (!dirTree) return null;

  return (
    <div>
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-edge">
        <div className="flex items-center gap-1">
          <button
            className={`px-1.5 py-0.5 rounded text-xxs transition-colors ${
              scope === "changed"
                ? "bg-surface-active text-fg"
                : "text-fg-muted hover:text-fg-secondary"
            }`}
            onClick={() => setScope("changed")}
          >
            Changed
          </button>
          <button
            className={`px-1.5 py-0.5 rounded text-xxs transition-colors ${
              scope === "all"
                ? "bg-surface-active text-fg"
                : "text-fg-muted hover:text-fg-secondary"
            }`}
            onClick={() => setScope("all")}
          >
            All
          </button>
        </div>
        <span className="text-xxs text-fg-muted font-mono tabular-nums">
          {totalFiles} files · {totalSymbols} symbols
        </span>
      </div>
      <div className="py-1">
        {totalFiles === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-xs text-fg-muted">
              {scope === "changed"
                ? "No changed files with symbols"
                : "No files with symbols"}
            </p>
          </div>
        ) : (
          <DirNode
            group={dirTree}
            depth={0}
            diffFiles={diffFiles}
            hunkStatusMap={hunkStatusMap}
            symbolDiffMap={symbolDiffMap}
          />
        )}
      </div>
    </div>
  );
}
