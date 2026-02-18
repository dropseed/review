import type { ReactNode } from "react";
import type { ProcessedFileEntry } from "./types";
import type { ChangesDisplayMode } from "../../stores/slices/preferencesSlice";
import type { HunkContext } from "./FileNode";
import { FileNode } from "./FileNode";
import { FlatFileNode } from "./FlatFileNode";
import { EMPTY_HUNK_STATUS } from "./FileTree.utils";
import { useFilesPanelContext } from "./FilesPanelContext";

interface FileListSectionProps {
  treeEntries: ProcessedFileEntry[];
  flatFilePaths: string[];
  displayMode: ChangesDisplayMode;
  hunkContext: HunkContext;
  emptyIcon?: ReactNode;
  emptyMessage: string;
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
  message: string;
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
    revealLabel,
    openInSplit,
    registerRef,
    handleApproveAll,
    handleUnapproveAll,
    handleRejectAll,
    movedFilePaths,
    hunkStatusMap,
    fileStatusMap,
  } = useFilesPanelContext();

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
            expandedPaths={expandedPaths}
            onToggle={togglePath}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            repoPath={repoPath}
            revealLabel={revealLabel}
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
          selectedFile={selectedFile}
          onSelectFile={handleSelectFile}
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
