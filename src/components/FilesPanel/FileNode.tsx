import { memo } from "react";
import type { ProcessedFileEntry, ViewMode } from "./types";
import { HunkStatusDots, StatusLetter } from "./StatusIndicators";

interface FileNodeProps {
  entry: ProcessedFileEntry;
  depth: number;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  selectedFile: string | null;
  onSelectFile: (path: string) => void;
  onContextMenu: (e: React.MouseEvent, path: string) => void;
  registerRef: (path: string, ref: HTMLButtonElement | null) => void;
  viewMode: ViewMode;
}

export const FileNode = memo(
  function FileNode({
    entry,
    depth,
    expandedPaths,
    onToggle,
    selectedFile,
    onSelectFile,
    onContextMenu,
    registerRef,
    viewMode,
  }: FileNodeProps) {
    if (!entry.matchesFilter) {
      return null;
    }

    const isExpanded = expandedPaths.has(entry.path);
    const isSelected = selectedFile === entry.path;
    // Use rem for scaling: base 0.5rem + 0.8rem per depth level
    const paddingLeft = `${depth * 0.8 + 0.5}rem`;

    if (entry.isDirectory) {
      const visibleChildren = entry.children?.filter((c) => c.matchesFilter);
      const hasReviewableContent = entry.hunkStatus.total > 0;
      const hasPending = entry.hunkStatus.pending > 0;

      return (
        <div className="select-none">
          <button
            className="group flex w-full items-center gap-1.5 py-0.5 pr-2 text-left transition-colors hover:bg-stone-800/40"
            style={{ paddingLeft }}
            onClick={() => onToggle(entry.path)}
            aria-expanded={isExpanded}
          >
            {/* Chevron */}
            <svg
              className={`h-2.5 w-2.5 flex-shrink-0 text-stone-600 transition-transform ${isExpanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6l6 6-6 6" />
            </svg>

            {/* Folder icon */}
            <svg
              className={`h-3.5 w-3.5 flex-shrink-0 ${hasReviewableContent ? (hasPending ? "text-amber-500" : "text-lime-500") : "text-stone-600"}`}
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
              className={`min-w-0 flex-1 truncate text-2xs ${hasReviewableContent ? "text-stone-200" : "text-stone-400"}`}
            >
              {entry.displayName}
            </span>

            {/* Aggregate hunk status */}
            {entry.hunkStatus.total > 0 && (
              <HunkStatusDots status={entry.hunkStatus} />
            )}
          </button>

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
                  onContextMenu={onContextMenu}
                  registerRef={registerRef}
                  viewMode={viewMode}
                />
              ))}
            </div>
          )}
        </div>
      );
    }

    // File node
    const isUnchanged = !entry.hasChanges;
    const isComplete =
      entry.hunkStatus.total > 0 && entry.hunkStatus.pending === 0;

    return (
      <button
        ref={(el) => registerRef(entry.path, el)}
        onContextMenu={(e) => onContextMenu(e, entry.path)}
        className={`group flex w-full items-center gap-1.5 py-0.5 pr-2 text-left transition-colors ${
          isSelected
            ? "bg-amber-500/15 border-l-2 border-l-amber-400"
            : isUnchanged
              ? "border-l-2 border-l-transparent opacity-75 hover:opacity-90"
              : "border-l-2 border-l-transparent hover:bg-stone-800/40"
        }`}
        style={{ paddingLeft: `${depth * 0.8 + 1.0}rem` }}
        onClick={() => onSelectFile(entry.path)}
        aria-selected={isSelected}
      >
        {/* Git status */}
        <StatusLetter status={entry.status} />

        {/* File name */}
        <span
          className={`min-w-0 flex-1 truncate text-2xs ${
            isSelected
              ? "text-stone-100"
              : isComplete
                ? "text-lime-400"
                : entry.hasChanges
                  ? "text-stone-300"
                  : "text-stone-400"
          }`}
        >
          {entry.name}
        </span>

        {/* Hunk status */}
        <HunkStatusDots status={entry.hunkStatus} />
      </button>
    );
  },
  (prev, next) => {
    return (
      prev.entry === next.entry &&
      prev.depth === next.depth &&
      prev.expandedPaths === next.expandedPaths &&
      prev.selectedFile === next.selectedFile &&
      prev.viewMode === next.viewMode
    );
  },
);
