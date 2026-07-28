import { useCallback, useMemo, type MouseEvent, type ReactNode } from "react";
import type { ProcessedFileEntry } from "./types";
import type { ChangesDisplayMode } from "../../stores/slices/preferencesSlice";
import type { HunkContext } from "./FileNode";
import { FileNode } from "./FileNode";
import { FlatFileNode } from "./FlatFileNode";
import { EMPTY_HUNK_STATUS } from "./FileTree.utils";
import { useFilesPanelContext, useFileSelection } from "./FilesPanelContext";
import { flattenVisibleFilePaths, resolvePaneFiles } from "./fileSelection";
import { useReviewStore } from "../../stores";

interface FileListSectionProps {
  treeEntries: ProcessedFileEntry[];
  flatFilePaths: string[];
  displayMode: ChangesDisplayMode;
  hunkContext: HunkContext;
  emptyIcon?: ReactNode;
  // Optional: callers that only mount this when non-empty (e.g. the Trusted
  // section, guarded by hasTrustedFiles) never hit the empty state.
  emptyMessage?: string;
}

export const CHECK_ICON = (
  <svg
    className="mx-auto mb-2 h-6 w-6 text-status-approved"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

function EmptyState({
  icon,
  message,
}: {
  icon?: ReactNode;
  message?: string;
}): ReactNode {
  return (
    <div className="py-4 text-center">
      {icon}
      <p className="text-xs text-fg-muted">{message}</p>
    </div>
  );
}

export function FileListSection({
  treeEntries,
  flatFilePaths,
  displayMode,
  hunkContext,
  emptyIcon,
  emptyMessage,
}: FileListSectionProps): ReactNode {
  const {
    expandedPaths,
    togglePath,
    selectedFile,
    handleSelectFile,
    repoPath,
    openInSplit,
    registerRef,
    handleApproveAll,
    handleUnapproveAll,
    handleRejectAll,
    movedFilePaths,
    hunkStatusMap,
    fileStatusMap,
    symlinkMap,
  } = useFilesPanelContext();
  const { handleRowClick } = useFileSelection();

  // The sidebar points at whichever pane has focus, not at the primary — with
  // a split open, the primary's file is the one you're *not* working in.
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const focusedPane = useReviewStore((s) => s.focusedPane);
  const { activePath, companionPath } = resolvePaneFiles(
    selectedFile,
    secondaryFile,
    focusedPane,
  );

  // The rows a shift-click may span: this section's file rows, in the order
  // they're on screen. Ranges stop at the section boundary — a click in
  // "Needs Review" shouldn't quietly sweep in everything above it.
  const selectableOrder = useMemo(
    () =>
      displayMode === "tree"
        ? flattenVisibleFilePaths(treeEntries, expandedPaths)
        : flatFilePaths.filter((p) => (hunkStatusMap.get(p)?.total ?? 0) > 0),
    [displayMode, treeEntries, flatFilePaths, expandedPaths, hunkStatusMap],
  );

  const onRowClick = useCallback(
    (path: string, event: MouseEvent) =>
      handleRowClick(path, selectableOrder, event),
    [handleRowClick, selectableOrder],
  );

  if (displayMode === "tree") {
    if (treeEntries.length === 0) {
      return <EmptyState icon={emptyIcon} message={emptyMessage} />;
    }

    return (
      <div className="py-1">
        {treeEntries.map((entry) => (
          <FileNode
            key={entry.path}
            entry={entry}
            depth={0}
            onToggle={togglePath}
            selectedFile={activePath}
            companionFile={companionPath}
            onSelectFile={handleSelectFile}
            onRowClick={onRowClick}
            repoPath={repoPath}
            onOpenInSplit={openInSplit}
            registerRef={registerRef}
            hunkContext={hunkContext}
            onApproveAll={handleApproveAll}
            onUnapproveAll={handleUnapproveAll}
            onRejectAll={handleRejectAll}
            movedFilePaths={movedFilePaths}
          />
        ))}
      </div>
    );
  }

  // Flat display mode
  if (flatFilePaths.length === 0) {
    return <EmptyState icon={emptyIcon} message={emptyMessage} />;
  }

  return (
    <div className="py-1">
      {flatFilePaths.map((filePath) => (
        <FlatFileNode
          key={filePath}
          filePath={filePath}
          fileStatus={fileStatusMap.get(filePath)}
          hunkStatus={hunkStatusMap.get(filePath) ?? EMPTY_HUNK_STATUS}
          selectedFile={activePath}
          companionFile={companionPath}
          onSelectFile={handleSelectFile}
          onRowClick={onRowClick}
          hunkContext={hunkContext}
          onApproveAll={handleApproveAll}
          onUnapproveAll={handleUnapproveAll}
          onRejectAll={handleRejectAll}
          movedFilePaths={movedFilePaths}
          isSymlink={symlinkMap.has(filePath)}
          symlinkTarget={symlinkMap.get(filePath)}
        />
      ))}
    </div>
  );
}
