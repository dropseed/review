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
  emptyIcon?: React.ReactNode;
  emptyMessage: string;
}

const CHECK_ICON = (
  <svg
    className="mx-auto mb-2 h-6 w-6 text-emerald-500"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

export function FileListSection({
  treeEntries,
  flatFilePaths,
  displayMode,
  hunkContext,
  emptyIcon,
  emptyMessage,
}: FileListSectionProps) {
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
    symbolDiffMap,
  } = useFilesPanelContext();

  return (
    <div className="py-1">
      {displayMode === "tree" ? (
        treeEntries.length > 0 ? (
          treeEntries.map((entry) => (
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
          ))
        ) : (
          <div className="py-4 text-center">
            {emptyIcon}
            <p className="text-xs text-stone-500">{emptyMessage}</p>
          </div>
        )
      ) : flatFilePaths.length > 0 ? (
        flatFilePaths.map((filePath) => (
          <FlatFileNode
            key={filePath}
            filePath={filePath}
            fileStatus={fileStatusMap.get(filePath)}
            hunkStatus={hunkStatusMap.get(filePath) ?? EMPTY_HUNK_STATUS}
            symbolDiff={symbolDiffMap.get(filePath) ?? null}
            selectedFile={selectedFile}
            onSelectFile={handleSelectFile}
            hunkContext={hunkContext}
            onApproveAll={handleApproveAll}
            onUnapproveAll={handleUnapproveAll}
            onRejectAll={handleRejectAll}
            movedFilePaths={movedFilePaths}
          />
        ))
      ) : (
        <div className="py-4 text-center">
          {emptyIcon}
          <p className="text-xs text-stone-500">{emptyMessage}</p>
        </div>
      )}
    </div>
  );
}

FileListSection.CHECK_ICON = CHECK_ICON;
