import { useState, useEffect, useMemo, useCallback } from "react";
import { ExportModal } from "../ExportModal";
import { CommitsPanel } from "../CommitsPanel";
import { FeedbackPanel } from "./FeedbackPanel";
import { FileNode } from "./FileNode";
import { FlatFileNode } from "./FlatFileNode";
import { TrustBadges } from "./TrustBadges";
import { GuideSection } from "./GuideSection";
import {
  useFilePanelFileSystem,
  useFilePanelNavigation,
  useFilePanelApproval,
  useFilePanelFeedback,
} from "./hooks";
import { useReviewStore } from "../../stores";
import { getPlatformServices } from "../../platform";
import { SimpleTooltip } from "../../components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "../../components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import {
  isHunkTrusted,
  type CommitEntry,
  type FileSymbolDiff,
} from "../../types";
import { flattenFilesWithStatus } from "../../stores/types";
import type { ChangesDisplayMode } from "../../stores/slices/preferencesSlice";
import { ReviewDataProvider } from "../ReviewDataContext";

interface QuickActionItem {
  label: string;
  count: number;
  onAction: () => void;
}

// Collapsible section header with icon and overflow menu
function SectionHeader({
  title,
  icon,
  badge,
  badgeColor = "amber",
  isOpen,
  onToggle,
  onExpandAll,
  onCollapseAll,
  showTopBorder = true,
  displayMode,
  onSetDisplayMode,
  onApproveAll,
  onUnapproveAll,
  quickActions,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  badge?: number;
  badgeColor?: "amber" | "lime" | "cyan";
  isOpen: boolean;
  onToggle: () => void;
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  showTopBorder?: boolean;
  displayMode?: ChangesDisplayMode;
  onSetDisplayMode?: (mode: ChangesDisplayMode) => void;
  onApproveAll?: () => void;
  onUnapproveAll?: () => void;
  quickActions?: QuickActionItem[];
  children: React.ReactNode;
}) {
  const badgeColors = {
    amber: "bg-amber-500/20 text-amber-400",
    lime: "bg-lime-500/20 text-lime-400",
    cyan: "bg-cyan-500/20 text-cyan-400",
  };

  const checkIcon = (
    <svg
      className="ml-auto h-3.5 w-3.5 text-stone-400"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );

  const hasMenuItems = displayMode && onSetDisplayMode;

  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggle()}>
      <div
        className={`border-b border-stone-800 ${showTopBorder ? "border-t" : ""}`}
      >
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <button className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-300 hover:bg-stone-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-inset">
              <svg
                className={`h-3 w-3 text-stone-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              {icon}
              <span className="flex-1">{title}</span>
              {badge !== undefined && badge > 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xxs font-medium tabular-nums ${badgeColors[badgeColor]}`}
                >
                  {badge}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          {isOpen && hasMenuItems && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center justify-center w-6 h-6 mr-1 rounded text-stone-500 hover:text-stone-300 hover:bg-stone-800 transition-colors">
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {/* Display mode */}
                <DropdownMenuItem onClick={() => onSetDisplayMode!("tree")}>
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 16 16"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path d="M3 3h10M5 6h8M7 9h6M5 12h8" />
                  </svg>
                  Tree view
                  {displayMode === "tree" && checkIcon}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onSetDisplayMode!("flat")}>
                  <svg
                    className="h-3.5 w-3.5"
                    fill="none"
                    viewBox="0 0 16 16"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path d="M3 3h10M3 6h10M3 9h10M3 12h10" />
                  </svg>
                  Flat view
                  {displayMode === "flat" && checkIcon}
                </DropdownMenuItem>

                {/* Expand/collapse (tree mode only) */}
                {displayMode === "tree" && onExpandAll && onCollapseAll && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={onExpandAll}>
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 16 16"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <rect x="2" y="2" width="12" height="12" rx="1" />
                        <path d="M8 5v6M5 8h6" />
                      </svg>
                      Expand all
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={onCollapseAll}>
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 16 16"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <rect x="2" y="2" width="12" height="12" rx="1" />
                        <path d="M5 8h6" />
                      </svg>
                      Collapse all
                    </DropdownMenuItem>
                  </>
                )}

                {/* Bulk approve/unapprove */}
                {(onApproveAll || onUnapproveAll) && (
                  <>
                    <DropdownMenuSeparator />
                    {onApproveAll && (
                      <DropdownMenuItem onClick={onApproveAll}>
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M5 13l4 4L19 7" />
                        </svg>
                        Approve all
                      </DropdownMenuItem>
                    )}
                    {onUnapproveAll && (
                      <DropdownMenuItem onClick={onUnapproveAll}>
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                        </svg>
                        Unapprove all
                      </DropdownMenuItem>
                    )}
                  </>
                )}

                {/* Quick actions */}
                {quickActions && quickActions.length > 0 && (
                  <>
                    <DropdownMenuSeparator />
                    {quickActions.map((qa) => (
                      <DropdownMenuItem key={qa.label} onClick={qa.onAction}>
                        <span className="flex-1">{qa.label}</span>
                        <span className="ml-2 text-xxs tabular-nums text-stone-500">
                          {qa.count}
                        </span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        <CollapsibleContent>{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

// Collapsible section container (for Feedback)
function CollapsibleSection({
  title,
  badge,
  isOpen,
  onToggle,
  children,
}: {
  title: string;
  badge?: number;
  isOpen: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggle()}>
      <div className="border-t border-stone-800">
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <button className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-300 hover:bg-stone-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 focus-visible:ring-inset">
              <svg
                className={`h-3 w-3 transition-transform ${isOpen ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              <span className="flex-1">{title}</span>
              {badge !== undefined && badge > 0 && (
                <span className="rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xxs font-medium text-amber-400 tabular-nums">
                  {badge}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

interface FilesPanelProps {
  onSelectCommit?: (commit: CommitEntry) => void;
}

export function FilesPanel({ onSelectCommit }: FilesPanelProps) {
  const commits = useReviewStore((s) => s.commits);

  // Track selected commit hash locally (for highlighting in CommitsPanel)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(
    null,
  );

  // Section collapse state
  const [needsReviewOpen, setNeedsReviewOpen] = useState(true);
  const [reviewedOpen, setReviewedOpen] = useState(true);

  // File system data
  const {
    repoPath,
    allFilesLoading,
    hunkStatusMap,
    sectionedFiles,
    flatSectionedFiles,
    fileStatusMap,
    allFilesTree,
    stats,
    allDirPaths,
    hunks,
    reviewState,
  } = useFilePanelFileSystem();

  // Navigation
  const {
    selectedFile,
    viewMode,
    setViewMode,
    expandedPaths,
    togglePath,
    handleSelectFile,
    expandAll,
    collapseAll,
    registerRef,
  } = useFilePanelNavigation({ sectionedFiles });

  // Approval actions
  const { handleApproveAll, handleUnapproveAll } = useFilePanelApproval();

  // Changes display mode (tree vs flat) — persisted per section
  const needsReviewDisplayMode = useReviewStore(
    (s) => s.needsReviewDisplayMode,
  );
  const setNeedsReviewDisplayMode = useReviewStore(
    (s) => s.setNeedsReviewDisplayMode,
  );
  const reviewedDisplayMode = useReviewStore((s) => s.reviewedDisplayMode);
  const setReviewedDisplayMode = useReviewStore(
    (s) => s.setReviewedDisplayMode,
  );
  const anyFlatMode =
    needsReviewDisplayMode === "flat" || reviewedDisplayMode === "flat";

  // Symbol data for flat mode
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);
  const files = useReviewStore((s) => s.files);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  // Trigger symbol loading when switching to flat mode
  useEffect(() => {
    if (anyFlatMode && !symbolsLoaded && !symbolsLoading && files.length > 0) {
      loadSymbols();
    }
  }, [anyFlatMode, symbolsLoaded, symbolsLoading, files.length, loadSymbols]);

  // Symbol diff map for flat mode
  const symbolDiffMap = useMemo(() => {
    const map = new Map<string, FileSymbolDiff>();
    for (const sd of symbolDiffs) map.set(sd.filePath, sd);
    return map;
  }, [symbolDiffs]);

  // Navigate to a specific hunk (used by flat mode symbol rows)
  const handleNavigateToHunk = useCallback(
    (filePath: string, hunkId: string) => {
      navigateToBrowse(filePath);
      const hunkIndex = hunks.findIndex((h) => h.id === hunkId);
      if (hunkIndex >= 0) {
        useReviewStore.setState({ focusedHunkIndex: hunkIndex });
      }
    },
    [navigateToBrowse, hunks],
  );

  // Feedback panel
  const {
    notes,
    annotations,
    setReviewNotes,
    deleteAnnotation,
    notesOpen,
    setNotesOpen,
    showExportModal,
    setShowExportModal,
    hasFeedbackToExport,
    handleGoToAnnotation,
  } = useFilePanelFeedback({
    reviewState,
    rejectedCount: stats.rejected,
  });

  // Section-level bulk approve/unapprove
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);

  const pendingHunkIds = useMemo(() => {
    return hunks
      .filter((h) => {
        const state = reviewState?.hunks[h.id];
        if (state?.status === "approved" || state?.status === "rejected")
          return false;
        if (reviewState && isHunkTrusted(state, reviewState.trustList))
          return false;
        return true;
      })
      .map((h) => h.id);
  }, [hunks, reviewState]);

  const reviewedHunkIds = useMemo(() => {
    return hunks
      .filter((h) => {
        const state = reviewState?.hunks[h.id];
        // Only include explicitly approved hunks — trusted hunks can't be
        // "unapproved" (they'd need their trust pattern removed instead)
        return state?.status === "approved";
      })
      .map((h) => h.id);
  }, [hunks, reviewState]);

  const handleApproveAllHunks = useCallback(() => {
    if (pendingHunkIds.length > 0) approveHunkIds(pendingHunkIds);
  }, [pendingHunkIds, approveHunkIds]);

  const handleUnapproveAllHunks = useCallback(() => {
    if (reviewedHunkIds.length > 0) unapproveHunkIds(reviewedHunkIds);
  }, [reviewedHunkIds, unapproveHunkIds]);

  // Quick actions: approve/unapprove by file status (deleted, renamed, added)
  const quickActionData = useMemo(() => {
    const flatFiles = flattenFilesWithStatus(files);
    const pathsByStatus: Record<string, Set<string>> = {
      deleted: new Set(),
      renamed: new Set(),
      added: new Set(),
    };
    for (const file of flatFiles) {
      if (file.status && file.status in pathsByStatus) {
        pathsByStatus[file.status].add(file.path);
      }
    }

    const result: Record<
      string,
      { pendingIds: string[]; approvedIds: string[] }
    > = {};
    for (const status of ["deleted", "renamed", "added"]) {
      const matchingPaths = pathsByStatus[status];
      const pendingIds: string[] = [];
      const approvedIds: string[] = [];
      for (const hunk of hunks) {
        if (!matchingPaths.has(hunk.filePath)) continue;
        const hunkState = reviewState?.hunks[hunk.id];
        if (hunkState?.status === "approved") {
          approvedIds.push(hunk.id);
        } else if (
          !hunkState?.status &&
          !(reviewState && isHunkTrusted(hunkState, reviewState.trustList))
        ) {
          pendingIds.push(hunk.id);
        }
      }
      result[status] = { pendingIds, approvedIds };
    }
    return result;
  }, [files, hunks, reviewState]);

  const needsReviewQuickActions = useMemo(() => {
    const actions: QuickActionItem[] = [];
    const labels: Record<string, string> = {
      deleted: "Approve deleted files",
      renamed: "Approve renamed files",
      added: "Approve added files",
    };
    for (const [status, label] of Object.entries(labels)) {
      const data = quickActionData[status];
      if (data && data.pendingIds.length > 0) {
        actions.push({
          label,
          count: data.pendingIds.length,
          onAction: () => approveHunkIds(data.pendingIds),
        });
      }
    }
    return actions;
  }, [quickActionData, approveHunkIds]);

  const reviewedQuickActions = useMemo(() => {
    const actions: QuickActionItem[] = [];
    const labels: Record<string, string> = {
      deleted: "Unapprove deleted files",
      renamed: "Unapprove renamed files",
      added: "Unapprove added files",
    };
    for (const [status, label] of Object.entries(labels)) {
      const data = quickActionData[status];
      if (data && data.approvedIds.length > 0) {
        actions.push({
          label,
          count: data.approvedIds.length,
          onAction: () => unapproveHunkIds(data.approvedIds),
        });
      }
    }
    return actions;
  }, [quickActionData, unapproveHunkIds]);

  // Context menu support
  const { openInSplit } = useReviewStore();
  const [revealLabel, setRevealLabel] = useState("Reveal in Finder");
  useEffect(() => {
    const platformName = getPlatformServices().window.getPlatformName();
    setRevealLabel(
      platformName === "macos"
        ? "Reveal in Finder"
        : platformName === "windows"
          ? "Reveal in Explorer"
          : "Reveal in Files",
    );
  }, []);

  // Context value for FlatFileNode tree (avoids prop drilling hunkStates/trustList)
  const reviewDataContextValue = useMemo(
    () => ({
      hunkStates: reviewState?.hunks ?? {},
      trustList: reviewState?.trustList ?? [],
      onNavigate: handleNavigateToHunk,
    }),
    [reviewState?.hunks, reviewState?.trustList, handleNavigateToHunk],
  );

  // Check if there are changes in the comparison
  const hasChanges =
    sectionedFiles.needsReview.length > 0 ||
    sectionedFiles.reviewed.length > 0 ||
    flatSectionedFiles.needsReview.length > 0 ||
    flatSectionedFiles.reviewed.length > 0;

  // Handle commit selection
  const handleCommitSelect = (hash: string) => {
    setSelectedCommitHash(hash);
    const commit = commits.find((c) => c.hash === hash);
    if (commit && onSelectCommit) {
      onSelectCommit(commit);
    }
  };

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
    <ReviewDataProvider value={reviewDataContextValue}>
      {reviewState && (
        <ExportModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          comparison={reviewState.comparison}
          hunks={hunks}
          hunkStates={reviewState.hunks}
          annotations={reviewState.annotations ?? []}
          notes={reviewState.notes}
        />
      )}

      <div className="flex h-full flex-col">
        {/* View mode toggle - always show all three tabs */}
        <div className="border-b border-stone-800 px-3 py-2">
          <Tabs
            value={viewMode}
            onValueChange={(v) => setViewMode(v as typeof viewMode)}
          >
            <TabsList aria-label="File view mode">
              <TabsTrigger value="changes">Changes</TabsTrigger>
              <TabsTrigger value="all">Browse</TabsTrigger>
              <TabsTrigger value="commits">Commits</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Trust pattern badges - quick toggles in changes view */}
        {viewMode === "changes" && <TrustBadges />}

        {/* Panel content based on view mode */}
        {viewMode === "commits" ? (
          <CommitsPanel
            onSelectCommit={handleCommitSelect}
            selectedCommitHash={selectedCommitHash}
          />
        ) : (
          <>
            {/* File tree */}
            <div className="flex-1 overflow-y-auto scrollbar-thin">
              {viewMode === "changes" ? (
                !hasChanges ? (
                  /* Empty state when no changes exist */
                  <div className="flex flex-col items-center justify-center h-full px-6 py-12">
                    <div className="relative mb-6">
                      <div className="flex gap-1.5">
                        <div className="w-10 h-14 rounded bg-stone-800/80 border border-stone-700/50" />
                        <div className="w-10 h-14 rounded bg-stone-800/80 border border-stone-700/50" />
                      </div>
                      <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                        <div className="w-1.5 h-0.5 bg-stone-600 rounded-full" />
                        <div className="w-1.5 h-0.5 bg-stone-600 rounded-full" />
                      </div>
                    </div>
                    <p className="text-sm font-medium text-stone-400 mb-1">
                      No changes
                    </p>
                    <p className="text-xs text-stone-500 text-center max-w-[200px]">
                      The base and compare refs are identical
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Guide section - PR description and AI narrative */}
                    <GuideSection />

                    {/* Needs Review section */}
                    <SectionHeader
                      title="Needs Review"
                      icon={
                        <svg
                          className="h-3.5 w-3.5 text-stone-500"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      }
                      badge={stats.pending}
                      badgeColor="amber"
                      isOpen={needsReviewOpen}
                      onToggle={() => setNeedsReviewOpen(!needsReviewOpen)}
                      onExpandAll={() => expandAll(allDirPaths)}
                      onCollapseAll={collapseAll}
                      displayMode={needsReviewDisplayMode}
                      onSetDisplayMode={setNeedsReviewDisplayMode}
                      onApproveAll={
                        pendingHunkIds.length > 0
                          ? handleApproveAllHunks
                          : undefined
                      }
                      quickActions={needsReviewQuickActions}
                      showTopBorder={false}
                    >
                      <div className="py-1">
                        {needsReviewDisplayMode === "tree" ? (
                          sectionedFiles.needsReview.length > 0 ? (
                            sectionedFiles.needsReview.map((entry) => (
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
                                hunkContext="needs-review"
                                onApproveAll={handleApproveAll}
                                onUnapproveAll={handleUnapproveAll}
                              />
                            ))
                          ) : (
                            <div className="py-4 text-center">
                              <svg
                                className="mx-auto mb-2 h-6 w-6 text-lime-500"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5 13l4 4L19 7"
                                />
                              </svg>
                              <p className="text-xs text-stone-500">
                                No files need review
                              </p>
                            </div>
                          )
                        ) : flatSectionedFiles.needsReview.length > 0 ? (
                          flatSectionedFiles.needsReview.map((filePath) => (
                            <FlatFileNode
                              key={filePath}
                              filePath={filePath}
                              fileStatus={fileStatusMap.get(filePath)}
                              hunkStatus={
                                hunkStatusMap.get(filePath) ?? {
                                  pending: 0,
                                  approved: 0,
                                  trusted: 0,
                                  rejected: 0,
                                  total: 0,
                                }
                              }
                              symbolDiff={symbolDiffMap.get(filePath) ?? null}
                              selectedFile={selectedFile}
                              onSelectFile={handleSelectFile}
                              hunkContext="needs-review"
                              onApproveAll={handleApproveAll}
                              onUnapproveAll={handleUnapproveAll}
                            />
                          ))
                        ) : (
                          <div className="py-4 text-center">
                            <svg
                              className="mx-auto mb-2 h-6 w-6 text-lime-500"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M5 13l4 4L19 7"
                              />
                            </svg>
                            <p className="text-xs text-stone-500">
                              No files need review
                            </p>
                          </div>
                        )}
                      </div>
                    </SectionHeader>

                    {/* Reviewed section */}
                    <SectionHeader
                      title="Reviewed"
                      icon={
                        <svg
                          className="h-3.5 w-3.5 text-stone-500"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                          <polyline points="22 4 12 14.01 9 11.01" />
                        </svg>
                      }
                      badge={stats.reviewed}
                      badgeColor="lime"
                      isOpen={reviewedOpen}
                      onToggle={() => setReviewedOpen(!reviewedOpen)}
                      onExpandAll={() => expandAll(allDirPaths)}
                      onCollapseAll={collapseAll}
                      displayMode={reviewedDisplayMode}
                      onSetDisplayMode={setReviewedDisplayMode}
                      onUnapproveAll={
                        reviewedHunkIds.length > 0
                          ? handleUnapproveAllHunks
                          : undefined
                      }
                      quickActions={reviewedQuickActions}
                    >
                      <div className="py-1">
                        {reviewedDisplayMode === "tree" ? (
                          sectionedFiles.reviewed.length > 0 ? (
                            sectionedFiles.reviewed.map((entry) => (
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
                                hunkContext="reviewed"
                                onApproveAll={handleApproveAll}
                                onUnapproveAll={handleUnapproveAll}
                              />
                            ))
                          ) : (
                            <div className="py-4 text-center">
                              <p className="text-xs text-stone-500">
                                No files reviewed yet
                              </p>
                            </div>
                          )
                        ) : flatSectionedFiles.reviewed.length > 0 ? (
                          flatSectionedFiles.reviewed.map((filePath) => (
                            <FlatFileNode
                              key={filePath}
                              filePath={filePath}
                              fileStatus={fileStatusMap.get(filePath)}
                              hunkStatus={
                                hunkStatusMap.get(filePath) ?? {
                                  pending: 0,
                                  approved: 0,
                                  trusted: 0,
                                  rejected: 0,
                                  total: 0,
                                }
                              }
                              symbolDiff={symbolDiffMap.get(filePath) ?? null}
                              selectedFile={selectedFile}
                              onSelectFile={handleSelectFile}
                              hunkContext="reviewed"
                              onApproveAll={handleApproveAll}
                              onUnapproveAll={handleUnapproveAll}
                            />
                          ))
                        ) : (
                          <div className="py-4 text-center">
                            <p className="text-xs text-stone-500">
                              No files reviewed yet
                            </p>
                          </div>
                        )}
                      </div>
                    </SectionHeader>
                  </>
                )
              ) : (
                <>
                  {/* All Files header with expand/collapse */}
                  <div className="flex items-center border-b border-stone-800">
                    <div className="flex-1 px-3 py-2 text-xs font-medium text-stone-300">
                      {repoPath?.split("/").pop() || "All Files"}
                    </div>
                    {allDirPaths.size > 0 && (
                      <div className="flex items-center gap-0.5 pr-2">
                        <SimpleTooltip content="Expand all">
                          <button
                            onClick={() => expandAll(allDirPaths)}
                            className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
                          >
                            <svg
                              className="h-3 w-3"
                              fill="none"
                              viewBox="0 0 16 16"
                              stroke="currentColor"
                              strokeWidth={1.5}
                            >
                              <rect x="2" y="2" width="12" height="12" rx="1" />
                              <path d="M8 5v6M5 8h6" />
                            </svg>
                          </button>
                        </SimpleTooltip>
                        <SimpleTooltip content="Collapse all">
                          <button
                            onClick={collapseAll}
                            className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
                          >
                            <svg
                              className="h-3 w-3"
                              fill="none"
                              viewBox="0 0 16 16"
                              stroke="currentColor"
                              strokeWidth={1.5}
                            >
                              <rect x="2" y="2" width="12" height="12" rx="1" />
                              <path d="M5 8h6" />
                            </svg>
                          </button>
                        </SimpleTooltip>
                      </div>
                    )}
                  </div>

                  {/* All Files tree */}
                  <div className="py-1">
                    {allFilesTree.length > 0 ? (
                      allFilesTree.map((entry) => (
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
                          hunkContext="all"
                        />
                      ))
                    ) : (
                      <div className="py-4 text-center">
                        <p className="text-xs text-stone-500">No files</p>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Feedback (Notes + Annotations) */}
            <CollapsibleSection
              title="Feedback"
              badge={annotations.length}
              isOpen={notesOpen}
              onToggle={() => setNotesOpen(!notesOpen)}
            >
              <FeedbackPanel
                notes={notes}
                onNotesChange={setReviewNotes}
                annotations={annotations}
                onGoToAnnotation={handleGoToAnnotation}
                onDeleteAnnotation={deleteAnnotation}
              />
            </CollapsibleSection>

            {/* Actions */}
            {hasFeedbackToExport && (
              <div className="border-t border-stone-800 p-3">
                <button
                  onClick={() => setShowExportModal(true)}
                  className="btn w-full text-xs bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20"
                >
                  <svg
                    className="h-3.5 w-3.5 mr-1.5 inline-block"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                    />
                  </svg>
                  Export Feedback
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </ReviewDataProvider>
  );
}
