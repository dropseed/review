import { useState, useMemo, useCallback } from "react";
import { FileNode } from "./FileNode";
import { arePanesOnScreen, resolvePaneFiles } from "./fileSelection";
import {
  reviewTabBadge,
  useFilePanelFileSystem,
  useFilePanelNavigation,
  useFilePanelApproval,
} from "./hooks";
import { useReviewStore } from "../../stores";
import { CheckIcon, SidebarPanelIcon } from "../ui/icons";
import { Spinner } from "../ui/spinner";
import { SimpleTooltip } from "../ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import { CollapsibleSection } from "../../components/ui/collapsible-section";
import type { FileSymbolDiff } from "../../types";
import { ReviewDataProvider } from "../ReviewDataContext";
import { GitStatusPanel } from "./GitStatusPanel";
import { FilesPanelProvider } from "./FilesPanelContext";
import { StatusGroupList } from "./StatusGroupList";
import { GuideBanner } from "./GuideBanner";
import { GuideModePanel } from "./GuideModePanel";
import { CommitRangePicker } from "./CommitRangePicker";
import { CommitRangeHeader } from "./CommitRangeHeader";
import { AnnotationDock } from "./AnnotationDock";
import { ReviewActionBar } from "./ReviewActionBar";
import { SORT_LABELS, SELECTED_CHECK } from "./PanelToolbar";
import { visibleFilesPanelTabs } from "./tabs";

/**
 * How much is waiting behind a tab, so you don't have to open it to find out.
 *
 * Deliberately absent at zero rather than showing "0" — an empty tab should
 * look quiet, not like it's reporting something. The badge inherits the
 * trigger's colour so it brightens with the active tab instead of competing
 * with it, which keeps one treatment across both counts.
 */
function TabCount({ value }: { value: number }) {
  if (value <= 0) return null;
  return (
    <span className="shrink-0 rounded-full bg-fg/10 px-1 font-medium tabular-nums">
      {value}
    </span>
  );
}

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
    gitChangeCount,
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
        focusedHunkId: hunkId,
        scrollTarget: { type: "hunk", hunkId },
      });
    },
    [],
  );

  const toggleFilesPanel = useReviewStore((s) => s.toggleFilesPanel);

  // One table, rendered here and by the collapsed rail — so the rail can't
  // offer a tab this strip doesn't have.
  const visibleTabs = visibleFilesPanelTabs(comparison !== null, showGitTab);

  // What the Review tab has waiting, for its badge. Taken from the panel's own
  // stats rather than a store-wide count: the badge labels these sections, so
  // it has to agree with them however they're narrowed (an active scope,
  // auto-approve-staged) — a badge reading 240 over a panel reading 4 is worse
  // than no badge.
  const { unresolved, complete } = reviewTabBadge(stats);

  // Browse rows follow the focused pane too — the Review tab's rows get this
  // from FileListSection, but Browse maps FileNode itself.
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const focusedPane = useReviewStore((s) => s.focusedPane);
  const panesOnScreen = useReviewStore(arePanesOnScreen);
  const browsePanes = resolvePaneFiles(
    selectedFile,
    secondaryFile,
    focusedPane,
    panesOnScreen,
  );

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
            {/* Collapsing lives on the panel's own header, the way the
                sidebar's does — the rail it leaves behind is the way back. It
                sits on the inner edge, against the content it makes room for,
                rather than out at the window edge where nothing else is. */}
            <SimpleTooltip content="Hide files (⌥⌘B)">
              <button
                type="button"
                onClick={toggleFilesPanel}
                aria-label="Hide files"
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded
                           text-fg-muted transition-colors duration-100
                           hover:bg-fg/[0.08] hover:text-fg-secondary"
              >
                <SidebarPanelIcon className="h-3.5 w-3.5 -scale-x-100" />
              </button>
            </SimpleTooltip>

            <Tabs
              value={viewMode}
              onValueChange={(v) => setFilesPanelTab(v as typeof viewMode)}
              className="flex-1 min-w-0"
            >
              <TabsList aria-label="File view mode">
                {visibleTabs.map((tab) => (
                  <TabsTrigger key={tab.id} value={tab.id}>
                    {tab.label}
                    {tab.id === "git" && <TabCount value={gitChangeCount} />}
                    {/* Unresolved, not total: the count is there to answer
                        "is anything waiting", and a check answers it better
                        than a zero once the answer is no. */}
                    {tab.id === "changes" &&
                      (unresolved > 0 ? (
                        <TabCount value={unresolved} />
                      ) : (
                        complete && (
                          <CheckIcon className="size-2.5 shrink-0 text-status-approved" />
                        )
                      ))}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          {/* Panel content based on view mode */}
          {viewMode === "git" ? (
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
                  <CommitRangePicker />
                  <CommitRangeHeader />
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
                        selectedFile={browsePanes.activePath}
                        companionFile={browsePanes.companionPath}
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
