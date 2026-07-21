import { useState, useMemo, useCallback } from "react";
import { FileNode } from "./FileNode";
import {
  useFilePanelFileSystem,
  useFilePanelNavigation,
  useFilePanelApproval,
} from "./hooks";
import { useReviewStore } from "../../stores";
import { Spinner } from "../ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import { CollapsibleSection } from "../../components/ui/collapsible-section";
import type { FileSymbolDiff } from "../../types";
import { ReviewDataProvider } from "../ReviewDataContext";
import { SearchResultsPanel } from "./SearchResultsPanel";
import { GitStatusPanel } from "./GitStatusPanel";
import { FilesPanelProvider } from "./FilesPanelContext";
import { StatusGroupList } from "./StatusGroupList";
import { GuideBanner } from "./GuideBanner";
import { GuideModePanel } from "./GuideModePanel";
import { CommitScopePicker } from "./CommitScopePicker";
import { CommitScopeHeader } from "./CommitScopeHeader";
import { AnnotationDock } from "./AnnotationDock";
import { ReviewActionBar } from "./ReviewActionBar";
import { SORT_LABELS, SELECTED_CHECK } from "./PanelToolbar";

export function FilesPanel() {
  const comparison = useReviewStore((s) => s.comparison);
  const guideMode = useReviewStore((s) => s.guideMode);

  // Browse-tab section collapse
  const [browseFilesOpen, setBrowseFilesOpen] = useState(true);

  // Review-tab section collapse — owned here (not in StatusGroupList) so the
  // user's expand/collapse choices survive switching to another tab and back.
  const [needsReviewOpen, setNeedsReviewOpen] = useState(true);
  const [savedForLaterOpen, setSavedForLaterOpen] = useState(true);
  const [reviewedOpen, setReviewedOpen] = useState(true);
  const [trustOpen, setTrustOpen] = useState(false);

  // File system data
  const {
    repoPath,
    allFilesLoading,
    hunkStatusMap,
    sectionedFiles,
    flatSectionedFiles,
    fileStatusMap,
    movedFilePaths,
    allFilesTree,
    stats,
    allDirPaths,
    renamedDirPaths,
    hunks,
    reviewState,
    symlinkMap,
  } = useFilePanelFileSystem();

  // Navigation
  const {
    selectedFile,
    viewMode,
    showGitTab,
    setFilesPanelTab,
    expandedPaths,
    togglePath,
    handleSelectFile,
    expandAll,
    collapseAll,
    registerRef,
  } = useFilePanelNavigation({ sectionedFiles });

  // Approval actions (used by FileListSection via context)
  const { handleApproveAll, handleUnapproveAll, handleRejectAll } =
    useFilePanelApproval();

  // File sort order (shared across Review + Browse tabs)
  const fileSortOrder = useReviewStore((s) => s.fileSortOrder);
  const setFileSortOrder = useReviewStore((s) => s.setFileSortOrder);

  // Symbol diff map for flat mode (read globally so FlatFileNode in either
  // tab can render symbol annotations)
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolDiffMap = useMemo(() => {
    const map = new Map<string, FileSymbolDiff>();
    for (const sd of symbolDiffs) map.set(sd.filePath, sd);
    return map;
  }, [symbolDiffs]);

  // Navigate to a specific hunk (used by FlatFileNode symbol rows)
  const handleNavigateToHunk = useCallback(
    (filePath: string, hunkId: string) => {
      useReviewStore.setState({
        guideContentMode: null,
        selectedFile: filePath,
        filesPanelCollapsed: false,
        focusedHunkId: hunkId,
        scrollTarget: { type: "hunk", hunkId },
      });
    },
    [],
  );

  // Search state
  const searchResultCount = useReviewStore((s) => s.searchResults.length);

  // Sort menu items shared across tabs
  const sortMenuItems = useMemo(
    () =>
      (["name", "size", "modified"] as const).map((order) => (
        <DropdownMenuItem key={order} onClick={() => setFileSortOrder(order)}>
          <span className="flex-1">{SORT_LABELS[order]}</span>
          {fileSortOrder === order && SELECTED_CHECK}
        </DropdownMenuItem>
      )),
    // setFileSortOrder is a stable Zustand action — not in deps to avoid memo churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fileSortOrder],
  );

  // Context menu support
  const openInSplit = useReviewStore((s) => s.openInSplit);
  const selectWorkingTreeFile = useReviewStore((s) => s.selectWorkingTreeFile);

  // Context value for FlatFileNode tree
  const reviewDataContextValue = useMemo(
    () => ({
      hunkStates: reviewState?.hunks ?? {},
      trustList: reviewState?.trustList ?? [],
      onNavigate: handleNavigateToHunk,
    }),
    [reviewState?.hunks, reviewState?.trustList, handleNavigateToHunk],
  );

  // Context value for FileListSection (shared props across all sections)
  const filesPanelContextValue = useMemo(
    () => ({
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
      symbolDiffMap,
      expandAll,
      collapseAll,
      grayscaleIcons: viewMode !== "browse",
      showRevealInBrowse: viewMode !== "browse",
    }),
    [
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
      symbolDiffMap,
      expandAll,
      collapseAll,
      viewMode,
    ],
  );

  if (allFilesLoading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Spinner className="h-6 w-6 border-2 border-edge-default border-t-status-modified" />
          <span className="text-sm text-fg-muted">Loading files...</span>
        </div>
      </div>
    );
  }

  return (
    <ReviewDataProvider value={reviewDataContextValue}>
      <FilesPanelProvider value={filesPanelContextValue}>
        <div className="flex h-full flex-col">
          {/* View mode toggle */}
          <div className="flex items-center gap-1.5 px-3 py-2">
            <Tabs
              value={viewMode}
              onValueChange={(v) => setFilesPanelTab(v as typeof viewMode)}
              className="flex-1 min-w-0"
            >
              <TabsList aria-label="File view mode">
                {comparison && showGitTab && (
                  <TabsTrigger value="git">Git</TabsTrigger>
                )}
                {comparison && (
                  <TabsTrigger value="changes">Review</TabsTrigger>
                )}
                <TabsTrigger value="browse">Browse</TabsTrigger>
                <TabsTrigger value="search" className="flex items-center gap-1">
                  Search
                  {searchResultCount > 0 && (
                    <span className="rounded-full bg-status-modified/20 px-1.5 py-0.5 text-xxs font-medium tabular-nums text-status-modified">
                      {searchResultCount >= 100 ? "100+" : searchResultCount}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Panel content based on view mode */}
          {viewMode === "search" ? (
            <SearchResultsPanel />
          ) : viewMode === "git" ? (
            <GitStatusPanel
              onSelectFile={handleSelectFile}
              onSelectWorkingTreeFile={selectWorkingTreeFile}
            />
          ) : viewMode === "changes" ? (
            <>
              {guideMode ? (
                <GuideModePanel />
              ) : (
                <>
                  <GuideBanner />
                  <CommitScopePicker />
                  <CommitScopeHeader />
                  <StatusGroupList
                    sectionedFiles={sectionedFiles}
                    flatSectionedFiles={flatSectionedFiles}
                    stats={stats}
                    renamedDirPaths={renamedDirPaths}
                    hunks={hunks}
                    reviewState={reviewState}
                    expandAll={expandAll}
                    collapseAll={collapseAll}
                    needsReviewOpen={needsReviewOpen}
                    setNeedsReviewOpen={setNeedsReviewOpen}
                    savedForLaterOpen={savedForLaterOpen}
                    setSavedForLaterOpen={setSavedForLaterOpen}
                    reviewedOpen={reviewedOpen}
                    setReviewedOpen={setReviewedOpen}
                    trustOpen={trustOpen}
                    setTrustOpen={setTrustOpen}
                  />
                </>
              )}
              <AnnotationDock />
              <ReviewActionBar />
            </>
          ) : (
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              <CollapsibleSection
                title="Files"
                isOpen={browseFilesOpen}
                onToggle={() => setBrowseFilesOpen(!browseFilesOpen)}
                menuContent={
                  allDirPaths.size > 0 ? (
                    <>
                      {sortMenuItems}
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={() => expandAll(allDirPaths, renamedDirPaths)}
                      >
                        Expand all
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={collapseAll}>
                        Collapse all
                      </DropdownMenuItem>
                    </>
                  ) : undefined
                }
              >
                <div className="py-1">
                  {allFilesTree.length > 0 ? (
                    allFilesTree.map((entry) => (
                      <FileNode
                        key={entry.path}
                        entry={entry}
                        depth={0}
                        onToggle={togglePath}
                        selectedFile={selectedFile}
                        onSelectFile={handleSelectFile}
                        repoPath={repoPath}
                        onOpenInSplit={openInSplit}
                        registerRef={registerRef}
                        showSizeBar
                      />
                    ))
                  ) : (
                    <div className="py-4 text-center">
                      <p className="text-xs text-fg-muted">No files</p>
                    </div>
                  )}
                </div>
              </CollapsibleSection>
            </div>
          )}
        </div>
      </FilesPanelProvider>
    </ReviewDataProvider>
  );
}
