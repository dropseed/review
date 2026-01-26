import { useEffect, useState, useMemo, useCallback, memo, useRef } from "react";
import { useReviewStore } from "../stores/reviewStore";
import type { FileEntry } from "../types";

interface FileTreeProps {
  repoPath: string;
}

interface FileNodeProps {
  entry: ProcessedFileEntry;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  registerRef: (path: string, ref: HTMLButtonElement | null) => void;
}

// Extended FileEntry with pre-computed values
interface ProcessedFileEntry extends FileEntry {
  changeCount: number;
  matchesSearch: boolean;
  highlightIndices: [number, number] | null;
  children?: ProcessedFileEntry[];
  displayName: string; // May differ from name for compacted folders
  compactedPaths: string[]; // Paths that were compacted into this entry
}

// Status configuration
const STATUS_CONFIG = {
  added: { color: "text-lime-400", label: "Added" },
  modified: { color: "text-amber-400", label: "Modified" },
  deleted: { color: "text-rose-400", label: "Deleted" },
  renamed: { color: "text-sky-400", label: "Renamed" },
  untracked: { color: "text-stone-400", label: "Untracked" },
  gitignored: { color: "text-stone-600", label: "Ignored" },
} as const;

// Pre-process tree: count changes, check search matches, find highlight indices
function processTree(
  entries: FileEntry[],
  searchQuery: string
): { processed: ProcessedFileEntry[]; totalChanges: number } {
  const lowerQuery = searchQuery.toLowerCase();
  let totalChanges = 0;

  function process(entry: FileEntry): ProcessedFileEntry {
    const lowerPath = entry.path.toLowerCase();
    const nameIndex = lowerPath.lastIndexOf("/") + 1;
    const lowerName = lowerPath.slice(nameIndex);

    // Find highlight indices in name
    let highlightIndices: [number, number] | null = null;
    if (lowerQuery) {
      const idx = lowerName.indexOf(lowerQuery);
      if (idx !== -1) {
        highlightIndices = [idx, idx + lowerQuery.length];
      }
    }

    // Check if this entry matches search
    const nameMatches = lowerQuery ? lowerName.includes(lowerQuery) : true;

    if (entry.isDirectory && entry.children) {
      const processedChildren = entry.children.map(process);

      // A directory matches if any child matches
      const anyChildMatches = processedChildren.some((c) => c.matchesSearch);
      const matchesSearch = lowerQuery ? nameMatches || anyChildMatches : true;

      // Count changes (excluding gitignored)
      let changeCount = 0;
      for (const child of processedChildren) {
        changeCount += child.changeCount;
      }

      return {
        ...entry,
        children: processedChildren,
        changeCount,
        matchesSearch,
        highlightIndices,
        displayName: entry.name,
        compactedPaths: [entry.path],
      };
    }

    // File node
    const hasChange = entry.status && entry.status !== "gitignored";
    if (hasChange) {
      totalChanges++;
    }

    return {
      name: entry.name,
      path: entry.path,
      isDirectory: entry.isDirectory,
      status: entry.status,
      changeCount: hasChange ? 1 : 0,
      matchesSearch: lowerQuery ? nameMatches : true,
      highlightIndices,
      displayName: entry.name,
      compactedPaths: [entry.path],
    };
  }

  const processed = entries.map(process);
  // Compact single-child directory chains
  const compacted = compactTree(processed);
  return { processed: compacted, totalChanges };
}

// Compact single-child directory chains (like VS Code's compact folders)
function compactTree(entries: ProcessedFileEntry[]): ProcessedFileEntry[] {
  return entries.map((entry) => {
    if (!entry.isDirectory || !entry.children) {
      return entry;
    }

    // Recursively compact children first
    let compacted: ProcessedFileEntry = {
      ...entry,
      children: compactTree(entry.children),
    };

    // Keep merging while we have exactly one child that is a directory
    while (
      compacted.children &&
      compacted.children.length === 1 &&
      compacted.children[0].isDirectory
    ) {
      const onlyChild = compacted.children[0];
      compacted = {
        ...compacted,
        displayName: `${compacted.displayName}/${onlyChild.displayName}`,
        compactedPaths: [...compacted.compactedPaths, ...onlyChild.compactedPaths],
        children: onlyChild.children,
        path: onlyChild.path, // Use the deepest path for expansion tracking
      };
    }

    return compacted;
  });
}

// Simple file icon component with file-type colors
const FileIcon = memo(function FileIcon({
  filename,
  status,
}: {
  filename: string;
  status?: string;
}) {
  const ext = filename.split(".").pop()?.toLowerCase();
  const statusConfig = status
    ? STATUS_CONFIG[status as keyof typeof STATUS_CONFIG]
    : null;

  // Color based on file type or status
  let iconColor = "text-stone-500";
  if (statusConfig && status !== "gitignored") {
    iconColor = statusConfig.color;
  } else {
    switch (ext) {
      case "ts":
      case "tsx":
        iconColor = "text-blue-400";
        break;
      case "js":
      case "jsx":
        iconColor = "text-yellow-400";
        break;
      case "css":
      case "scss":
        iconColor = "text-pink-400";
        break;
      case "json":
        iconColor = "text-amber-400";
        break;
      case "md":
        iconColor = "text-stone-400";
        break;
      case "rs":
        iconColor = "text-orange-400";
        break;
      case "toml":
        iconColor = "text-stone-400";
        break;
    }
  }

  return (
    <svg className={`h-3.5 w-3.5 flex-shrink-0 ${iconColor}`} viewBox="0 0 24 24" fill="currentColor">
      <path d="M5.625 1.5c-1.036 0-1.875.84-1.875 1.875v17.25c0 1.035.84 1.875 1.875 1.875h12.75c1.035 0 1.875-.84 1.875-1.875V7.875L14.25 1.5H5.625z" />
      <path fillOpacity="0.3" d="M14.25 1.5v6.375h6.375L14.25 1.5z" />
    </svg>
  );
});

// Memoized FileNode to prevent unnecessary re-renders
const FileNode = memo(
  function FileNode({
    entry,
    depth,
    expandedPaths,
    onToggle,
    selectedFile,
    onSelectFile,
    registerRef,
  }: FileNodeProps) {
    // Don't render if doesn't match search
    if (!entry.matchesSearch) {
      return null;
    }

    const isExpanded = expandedPaths.has(entry.path);
    const isSelected = selectedFile === entry.path;
    const paddingLeft = depth * 10 + 8;

    if (entry.isDirectory) {
      const hasChanges = entry.changeCount > 0;

      // Filter children that match search
      const visibleChildren = entry.children?.filter((c) => c.matchesSearch);

      return (
        <div className="select-none">
          <button
            className="group flex w-full items-center gap-1 py-0.5 pr-2 text-left transition-colors duration-100 hover:bg-stone-800/40"
            style={{ paddingLeft }}
            onClick={() => onToggle(entry.path)}
          >
            {/* Chevron icon */}
            <svg
              className={`h-2.5 w-2.5 flex-shrink-0 text-stone-600 transition-transform duration-100 ${isExpanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6l6 6-6 6" />
            </svg>

            {/* Folder icon */}
            <svg
              className={`h-3.5 w-3.5 flex-shrink-0 ${hasChanges ? "text-amber-500" : "text-stone-600"}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              {isExpanded ? (
                <path d="M19.906 9c.382 0 .749.057 1.094.162V9a3 3 0 00-3-3h-3.879a.75.75 0 01-.53-.22L11.47 3.66A2.25 2.25 0 009.879 3H6a3 3 0 00-3 3v3.162A3.756 3.756 0 014.094 9h15.812zM4.094 10.5a2.25 2.25 0 00-2.227 2.568l.857 6A2.25 2.25 0 004.951 21H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-2.227-2.568H4.094z" />
              ) : (
                <path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />
              )}
            </svg>

            {/* Directory name */}
            <span
              className={`min-w-0 flex-1 truncate font-mono text-[11px] ${hasChanges ? "text-stone-200" : "text-stone-500"}`}
            >
              {entry.displayName}
            </span>

            {/* Change count badge */}
            {hasChanges && (
              <span className="ml-1 flex-shrink-0 rounded bg-amber-500/20 px-1 py-px text-[9px] font-medium tabular-nums text-amber-400">
                {entry.changeCount}
              </span>
            )}
          </button>

          {/* Children - only render when expanded */}
          {isExpanded && visibleChildren && visibleChildren.length > 0 && (
            <div>
              {visibleChildren.map((child) => (
                <FileNode
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  expandedPaths={expandedPaths}
                  onToggle={onToggle}
                  selectedFile={selectedFile}
                  onSelectFile={onSelectFile}
                  registerRef={registerRef}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    // File node
    const statusConfig = entry.status
      ? STATUS_CONFIG[entry.status]
      : null;

    return (
      <button
        ref={(el) => registerRef(entry.path, el)}
        className={`group flex w-full items-center gap-1 py-0.5 pr-2 text-left transition-colors duration-100 ${
          isSelected
            ? "bg-amber-500/15 border-l-2 border-l-amber-400"
            : "border-l-2 border-l-transparent hover:bg-stone-800/40 hover:border-l-stone-700"
        }`}
        style={{ paddingLeft: paddingLeft + 6 }}
        onClick={() => onSelectFile(entry.path)}
      >
        {/* File icon */}
        <FileIcon filename={entry.name} status={entry.status} />

        {/* File name */}
        <span
          className={`min-w-0 flex-1 truncate font-mono text-[11px] ${
            isSelected
              ? "text-stone-100"
              : statusConfig
                ? statusConfig.color
                : "text-stone-400 group-hover:text-stone-300"
          }`}
        >
          {entry.name}
        </span>

        {/* Status dot indicator */}
        {statusConfig && entry.status !== "gitignored" && (
          <div
            className={`ml-1 h-1 w-1 flex-shrink-0 rounded-full ${
              entry.status === "added"
                ? "bg-lime-400"
                : entry.status === "modified"
                  ? "bg-amber-400"
                  : entry.status === "deleted"
                    ? "bg-rose-400"
                    : entry.status === "renamed"
                      ? "bg-sky-400"
                      : "bg-stone-500"
            }`}
            title={statusConfig.label}
          />
        )}
      </button>
    );
  },
  // Custom comparison for memo
  (prev, next) => {
    return (
      prev.entry === next.entry &&
      prev.depth === next.depth &&
      prev.expandedPaths === next.expandedPaths &&
      prev.selectedFile === next.selectedFile
    );
  }
);


export function FileTree({ repoPath: _repoPath }: FileTreeProps) {
  // Use selector to only subscribe to specific state
  const allFiles = useReviewStore((state) => state.allFiles);
  const allFilesLoading = useReviewStore((state) => state.allFilesLoading);
  const selectedFile = useReviewStore((state) => state.selectedFile);
  const setSelectedFile = useReviewStore((state) => state.setSelectedFile);
  const fileToReveal = useReviewStore((state) => state.fileToReveal);
  const clearFileToReveal = useReviewStore((state) => state.clearFileToReveal);

  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const fileRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Process tree - only recompute when files change
  const { processedFiles, totalChanges } = useMemo(() => {
    const { processed, totalChanges } = processTree(allFiles, "");
    return { processedFiles: processed, totalChanges };
  }, [allFiles]);

  // Reveal file in tree when requested
  useEffect(() => {
    if (fileToReveal) {
      // Expand all parent directories
      const parts = fileToReveal.split("/");
      const pathsToExpand = new Set(expandedPaths);
      for (let i = 1; i < parts.length; i++) {
        pathsToExpand.add(parts.slice(0, i).join("/"));
      }
      setExpandedPaths(pathsToExpand);

      // Scroll to the file after a brief delay for rendering
      setTimeout(() => {
        const ref = fileRefs.current.get(fileToReveal);
        if (ref) {
          ref.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);

      clearFileToReveal();
    }
  }, [fileToReveal, clearFileToReveal, expandedPaths]);

  // Stable toggle callback
  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Stable select callback
  const handleSelectFile = useCallback(
    (path: string) => {
      setSelectedFile(path);
    },
    [setSelectedFile]
  );

  // Stable ref registration callback
  const registerRef = useCallback((path: string, el: HTMLButtonElement | null) => {
    if (el) {
      fileRefs.current.set(path, el);
    } else {
      fileRefs.current.delete(path);
    }
  }, []);

  if (allFilesLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-6 w-6 rounded-full border-2 border-stone-700 border-t-amber-500 animate-spin" />
          <span className="text-sm text-stone-500">Loading files...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      {totalChanges > 0 && (
        <div className="sticky top-0 z-10 border-b border-stone-800/30 bg-stone-900 px-3 py-2">
          <span className="text-xs font-medium text-amber-400">
            {totalChanges} changed
          </span>
        </div>
      )}

      {/* File tree */}
      <div className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {processedFiles.map((entry) => (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            expandedPaths={expandedPaths}
            onToggle={togglePath}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            registerRef={registerRef}
          />
        ))}
      </div>
    </div>
  );
}
