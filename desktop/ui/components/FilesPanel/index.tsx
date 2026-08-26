import { useState, useMemo, useCallback, useEffect } from "react";
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
import { LoadingState } from "../ui/loading-state";
import { Spinner } from "../ui/spinner";
import { SimpleTooltip } from "../ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import { CollapsibleSection } from "../../components/ui/collapsible-section";
import { ReviewDataProvider } from "../ReviewDataContext";
import { GitStatusPanel } from "./GitStatusPanel";
import { FilesPanelProvider } from "./FilesPanelContext";
import { StatusGroupList } from "./StatusGroupList";
import { CarryForwardRow } from "./CarryForwardRow";
import { GuideBanner } from "./GuideBanner";
import { GuideModePanel } from "./GuideModePanel";
import { ComparisonBar } from "./ComparisonBar";
import { AnnotationDock } from "./AnnotationDock";
import { ReviewActionBar } from "./ReviewActionBar";
import { SortMenuItems } from "./PanelToolbar";
import { visibleFilesPanelTabs } from "./tabs";
import { useBrowseRefTree } from "./useBrowseRefTree";
import { collectDirPaths, processTree } from "./FileTree.utils";
import { ephemeralView, historicRef } from "../../stores/selectors/viewpoint";
import type { FileHunkStatus } from "./types";
import { StartReviewButton } from "../StartReviewButton";

import { EMPTY_TRUST_LIST } from "../../types";
/** No file at a ref has a review status — there is nothing to compare it to. */
const NO_HUNK_STATUS: Map<string, FileHunkStatus> = new Map();

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
    <>
      <span className="hidden shrink-0 rounded-full bg-fg/10 px-1 font-medium tabular-nums @min-[21rem]:inline">
        {value}
      </span>
      {/* Narrow panel: the number won't fit, but "something's waiting"
          still should — a dot carries that bit. */}
      <span
        aria-hidden="true"
        className="size-1 shrink-0 rounded-full bg-current opacity-60 @min-[21rem]:hidden"
      />
    </>
  );
}

export function FilesPanel() {
  const comparison = useReviewStore((s) => s.comparison);
  const guideMode = useReviewStore((s) => s.guideMode);

  // Browse-tab section collapse.
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
    gitTab,
    gitChangeCount,
    hasHunks,
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
  const visibleTabs = visibleFilesPanelTabs(comparison, gitTab);

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

  // Browse-as-of: with no checkout of the head on screen, the tree comes from
  // the object database at that revision instead of from `allFiles`, which
  // describes the working tree. Sorting is shared with the working tree's tree;
  // hunk status is not, because a revision that isn't being compared to
  // anything has none.
  const browseAtRef = useReviewStore(historicRef);
  const peek = useReviewStore(ephemeralView);
  const refTree = useBrowseRefTree();
  const refFilesTree = useMemo(
    () => processTree(refTree.entries, NO_HUNK_STATUS, "browse", fileSortOrder),
    [refTree.entries, fileSortOrder],
  );
  const browseTree = browseAtRef ? refFilesTree : allFilesTree;

  // A first visit to a comparison, still loading. A refresh never sets this
  // (that is what `isRefreshing` suppresses), and a restore from the snapshot
  // cache never has it — its diff is already here.
  const comparisonLoading = useReviewStore((s) => s.loadingProgress !== null);

  // Browse is the surface the whole-repo listing exists for, so it is the one
  // that pays for it. A historic revision reads the object database instead and
  // needs nothing from the working tree's listing.
  //
  // The tab starts on Browse and is auto-switched to Review once hunks arrive,
  // so "showing Browse" is only true of a settled panel: one the user put here,
  // or one whose comparison has arrived with nothing to review.
  const ensureAllFiles = useReviewStore((s) => s.ensureAllFiles);
  const tabChosen = useReviewStore((s) => s.filesPanelTabChosen);
  useEffect(() => {
    if (viewMode !== "browse" || browseAtRef) return;
    if (comparisonLoading) return;
    if (!tabChosen && hasHunks) return;
    void ensureAllFiles();
  }, [
    viewMode,
    browseAtRef,
    comparisonLoading,
    tabChosen,
    hasHunks,
    ensureAllFiles,
  ]);

  // Expand-all needs the directories of the tree on screen. `allDirPaths` is
  // the working tree's, and offering those against a historic tree would expand
  // paths that revision doesn't have. The walk is memoized on that tree alone —
  // folding `allDirPaths` into its deps would re-walk it on every hunk status
  // change, which cannot move a revision's directories.
  const refDirPaths = useMemo(
    () => collectDirPaths(refFilesTree),
    [refFilesTree],
  );
  const browseDirPaths = browseAtRef ? refDirPaths : allDirPaths;

  // Context menu support
  const openInSplit = useReviewStore((s) => s.openInSplit);
  const selectWorkingTreeFile = useReviewStore((s) => s.selectWorkingTreeFile);

  // Context value for FlatFileNode tree
  const reviewDataContextValue = useMemo(
    () => ({
      hunkStates: reviewState?.hunks ?? {},
      trustList: reviewState?.trustList ?? EMPTY_TRUST_LIST,
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
      expandAll,
      collapseAll,
      viewMode,
    ],
  );

  const tabStrip = (
    /* The panel's own header row: what this column is for on the left, and the
       control that puts it away on the right — the button sits in the thing it
       collapses. A container so the strip can trade its words for icons when it
       is given too little room for them, which is also why its width is
       `w-full` rather than shrink-to-fit: an inline-size container sized by its
       own content collapses, taking every label with it. */
    <div className="@container flex w-full items-center gap-1.5">
      <Tabs
        value={viewMode}
        onValueChange={(v) => setFilesPanelTab(v as typeof viewMode)}
        className="min-w-0 flex-1"
      >
        <TabsList aria-label="File view mode">
          {visibleTabs.map((tab) => {
            const Icon = tab.icon;
            const trigger = (
              <TabsTrigger
                value={tab.id}
                aria-label={tab.label}
                disabled={tab.disabled}
                className="disabled:opacity-40"
              >
                <Icon className="size-3 shrink-0 @min-[16rem]:hidden" />
                <span className="hidden truncate @min-[16rem]:inline">
                  {tab.label}
                </span>
                {tab.id === "git" && !tab.disabled && (
                  <TabCount value={gitChangeCount} />
                )}
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
            );
            // A disabled trigger takes no pointer events, so the tooltip hangs
            // off a wrapper — which is the only place the reason is readable.
            return tab.disabled ? (
              <SimpleTooltip key={tab.id} content={tab.disabledReason}>
                <span className="flex min-w-0 flex-1">{trigger}</span>
              </SimpleTooltip>
            ) : (
              <span key={tab.id} className="flex min-w-0 flex-1">
                {trigger}
              </span>
            );
          })}
        </TabsList>
      </Tabs>

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
    </div>
  );

  return (
    <ReviewDataProvider value={reviewDataContextValue}>
      <FilesPanelProvider value={filesPanelContextValue}>
        <div className="flex h-full flex-col">
          {/* One control above the tabs rather than one per tab: what is being
              compared is the same fact whichever list is below it. */}
          <div className="flex flex-col gap-1.5 px-3 py-2">
            <ComparisonBar />
            {tabStrip}
          </div>

          {/* Panel content based on view mode. A comparison still arriving
              takes the body from all three tabs, leaving the strip above in
              place: every list here is of that comparison, and an empty one
              says "nothing to review" rather than "not here yet". */}
          {comparisonLoading ? (
            <div className="flex flex-1 items-start justify-center pt-10">
              <LoadingState label="Loading files…" />
            </div>
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
                  <CarryForwardRow />
                  <GuideBanner />
                  {/* A commit being looked at is not a mode — it is this
                      screen with the review slot empty, and this is the one
                      row that differs. It sits in the list rather than above
                      the diff because that is where its absence is felt. */}
                  {peek && (
                    <div
                      className="mx-3 mb-1 flex items-center justify-between gap-2 rounded-md
                                 border border-dashed border-edge px-2.5 py-1.5"
                    >
                      <span className="min-w-0 truncate text-xxs text-fg-muted">
                        No review of this commit yet
                      </span>
                      <StartReviewButton
                        label="Start"
                        target={
                          repoPath
                            ? { path: repoPath, target: { ref: peek.hash } }
                            : null
                        }
                      />
                    </div>
                  )}
                  <StatusGroupList
                    sectionedFiles={sectionedFiles}
                    flatSectionedFiles={flatSectionedFiles}
                    stats={stats}
                    renamedDirPaths={renamedDirPaths}
                    hunks={hunks}
                    reviewState={reviewState}
                    changedOnly={peek !== null}
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
              {/* A peek has no review to act on or copy out, and this bar's
                  idle line ("Approve, reject, or comment to start your
                  review") would be instructions for something that isn't
                  possible here. */}
              {peek === null && <ReviewActionBar />}
            </>
          ) : (
            <div className="flex flex-1 flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {/* This tab is the tree at whatever head is on screen, and
                    nothing else — the bar above says which revision that is,
                    and its menu is the way to a different one. A ref picker
                    and a log of its own were how Browse came to be reading one
                    revision while the diff beside it was of another. */}
                <CollapsibleSection
                  title="Files"
                  isOpen={browseFilesOpen}
                  onToggle={() => setBrowseFilesOpen(!browseFilesOpen)}
                  menuContent={
                    browseDirPaths.size > 0 ? (
                      <>
                        <SortMenuItems />
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() =>
                            expandAll(browseDirPaths, renamedDirPaths)
                          }
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
                    {refTree.loading || (!browseAtRef && allFilesLoading) ? (
                      <div className="flex justify-center py-6">
                        <Spinner className="size-5 border-2 border-edge-default border-t-status-modified" />
                      </div>
                    ) : refTree.error ? (
                      <p className="px-3 py-4 text-xxs text-status-rejected">
                        {refTree.error}
                      </p>
                    ) : browseTree.length > 0 ? (
                      browseTree.map((entry) => (
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
            </div>
          )}
        </div>
      </FilesPanelProvider>
    </ReviewDataProvider>
  );
}
