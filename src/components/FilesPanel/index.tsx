import { useState, useEffect, useMemo, useCallback } from "react";
import { CommitsPanel } from "./CommitsPanel";
import { FileNode } from "./FileNode";
import {
  useFilePanelFileSystem,
  useFilePanelNavigation,
  useFilePanelApproval,
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
  isHunkReviewed,
  type CommitEntry,
  type FileSymbolDiff,
} from "../../types";
import { flattenFilesWithStatus } from "../../stores/types";
import type { ChangesDisplayMode } from "../../stores/slices/preferencesSlice";
import { ReviewDataProvider } from "../ReviewDataContext";
import { FilenameModal } from "./FilenameModal";
import { SearchResultsPanel } from "./SearchResultsPanel";
import { FilesPanelProvider } from "./FilesPanelContext";
import { FileListSection } from "./FileListSection";
import { useTrustCounts, useKnownPatternIds } from "../../hooks/useTrustCounts";
import { TrustSection } from "../GuideView/TrustSection";

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
  badge?: number | string;
  badgeColor?: "amber" | "emerald" | "cyan";
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
    amber: "bg-amber-500/20 text-amber-300",
    emerald: "bg-emerald-500/20 text-emerald-300",
    cyan: "bg-cyan-500/20 text-cyan-300",
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

  const hasMenuItems =
    (displayMode && onSetDisplayMode) ||
    (quickActions && quickActions.length > 0) ||
    onApproveAll ||
    onUnapproveAll;

  return (
    <Collapsible open={isOpen} onOpenChange={() => onToggle()}>
      <div
        className={`border-b border-stone-800/50 ${showTopBorder ? "border-t border-t-stone-800/50" : ""}`}
      >
        <div className="flex items-center">
          <CollapsibleTrigger asChild>
            <button className="flex flex-1 items-center gap-2 px-3 py-2 text-left text-xs font-medium text-stone-300 hover:bg-stone-800/50 focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-amber-500/50">
              <svg
                className={`h-3 w-3 text-stone-500 transition-transform ${isOpen ? "rotate-90" : ""}`}
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
              {icon}
              <span className="flex-1">{title}</span>
              {badge !== undefined && badge !== 0 && (
                <span
                  className={`rounded-full px-1.5 py-0.5 text-xxs font-medium tabular-nums ${badgeColors[badgeColor]}`}
                >
                  {badge}
                </span>
              )}
            </button>
          </CollapsibleTrigger>
          {hasMenuItems && (
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
                {displayMode && onSetDisplayMode && (
                  <>
                    <DropdownMenuItem onClick={() => onSetDisplayMode("tree")}>
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
                    <DropdownMenuItem onClick={() => onSetDisplayMode("flat")}>
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
                  </>
                )}

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
  const [trustOpen, setTrustOpen] = useState(false);
  const [needsReviewOpen, setNeedsReviewOpen] = useState(true);
  const [savedForLaterOpen, setSavedForLaterOpen] = useState(true);
  const [reviewedOpen, setReviewedOpen] = useState(true);

  // Filename modal state
  const [filenameModalOpen, setFilenameModalOpen] = useState(false);
  const [filenameModalMode, setFilenameModalMode] = useState<
    "approve" | "unapprove"
  >("approve");

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
    hunks,
    reviewState,
  } = useFilePanelFileSystem();

  // Navigation
  const {
    selectedFile,
    viewMode,
    setFilesPanelTab,
    expandedPaths,
    togglePath,
    handleSelectFile,
    expandAll,
    collapseAll,
    registerRef,
  } = useFilePanelNavigation({ sectionedFiles });

  // Approval actions
  const { handleApproveAll, handleUnapproveAll, handleRejectAll } =
    useFilePanelApproval();

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

  // Index map for O(1) hunk ID → index lookups
  const hunkIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < hunks.length; i++) map.set(hunks[i].id, i);
    return map;
  }, [hunks]);

  // Navigate to a specific hunk (used by flat mode symbol rows)
  const handleNavigateToHunk = useCallback(
    (filePath: string, hunkId: string) => {
      navigateToBrowse(filePath);
      const hunkIndex = hunkIndexMap.get(hunkId);
      if (hunkIndex !== undefined) {
        useReviewStore.setState({ focusedHunkIndex: hunkIndex });
      }
    },
    [navigateToBrowse, hunkIndexMap],
  );

  // Section-level bulk approve/unapprove/reject
  const approveHunkIds = useReviewStore((s) => s.approveHunkIds);
  const unapproveHunkIds = useReviewStore((s) => s.unapproveHunkIds);
  const rejectHunkIds = useReviewStore((s) => s.rejectHunkIds);

  const pendingHunkIds = useMemo(() => {
    return hunks
      .filter((h) => {
        const state = reviewState?.hunks[h.id];
        if (
          state?.status === "approved" ||
          state?.status === "rejected" ||
          state?.status === "saved_for_later"
        )
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
        // Include explicitly approved or rejected hunks — trusted hunks can't be
        // "unapproved" (they'd need their trust pattern removed instead)
        return state?.status === "approved" || state?.status === "rejected";
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

  // Count unique basenames that appear in 2+ files (for "by filename" quick actions)
  const basenameCount = useMemo(() => {
    const nameToFiles = new Map<string, Set<string>>();
    for (const hunk of hunks) {
      const name = hunk.filePath.split("/").pop() ?? "";
      const set = nameToFiles.get(name) ?? new Set();
      set.add(hunk.filePath);
      nameToFiles.set(name, set);
    }
    let count = 0;
    for (const files of nameToFiles.values()) {
      if (files.size >= 2) count++;
    }
    return count;
  }, [hunks]);

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
    if (basenameCount > 0) {
      actions.push({
        label: "Approve by filename\u2026",
        count: basenameCount,
        onAction: () => {
          setFilenameModalMode("approve");
          setFilenameModalOpen(true);
        },
      });
    }
    return actions;
  }, [quickActionData, approveHunkIds, basenameCount]);

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
    if (basenameCount > 0) {
      actions.push({
        label: "Unapprove by filename\u2026",
        count: basenameCount,
        onAction: () => {
          setFilenameModalMode("unapprove");
          setFilenameModalOpen(true);
        },
      });
    }
    return actions;
  }, [quickActionData, unapproveHunkIds, basenameCount]);

  // Guide state
  const reviewGroups = useReviewStore((s) => s.reviewGroups);
  const activeGroupIndex = useReviewStore((s) => s.activeGroupIndex);
  const setActiveGroupIndex = useReviewStore((s) => s.setActiveGroupIndex);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const setGuideContentMode = useReviewStore((s) => s.setGuideContentMode);
  const groupingLoading = useReviewStore((s) => s.groupingLoading);
  const groupingError = useReviewStore((s) => s.groupingError);
  const generateGrouping = useReviewStore((s) => s.generateGrouping);
  const isGroupingStale = useReviewStore((s) => s.isGroupingStale);
  const startGuide = useReviewStore((s) => s.startGuide);
  const guideLoading = useReviewStore((s) => s.guideLoading);
  const guideSummary = useReviewStore((s) => s.guideSummary);
  const summaryStatus = useReviewStore((s) => s.summaryStatus);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);
  const githubPr = useReviewStore((s) => s.reviewState?.comparison?.githubPr);
  const [groupsOpen, setGroupsOpen] = useState(true);

  // Trust section
  const knownPatternIds = useKnownPatternIds();
  const { trustedHunkCount, trustableHunkCount } =
    useTrustCounts(knownPatternIds);
  const setTrustList = useReviewStore((s) => s.setTrustList);
  const classifying = useReviewStore((s) => s.classifying);
  const classifyUnlabeledHunks = useReviewStore(
    (s) => s.classifyUnlabeledHunks,
  );
  const reclassifyHunks = useReviewStore((s) => s.reclassifyHunks);
  const isClassificationStale = useReviewStore((s) => s.isClassificationStale);

  const unlabeledCount = useMemo(
    () =>
      hunks.filter((h) => {
        const state = reviewState?.hunks[h.id];
        return !state?.label || state.label.length === 0;
      }).length,
    [hunks, reviewState?.hunks],
  );

  const matchedPatternIds = useMemo(() => {
    if (!knownPatternIds || knownPatternIds.size === 0)
      return new Set<string>();
    const matched = new Set<string>();
    for (const hunk of hunks) {
      const labels = reviewState?.hunks[hunk.id]?.label ?? [];
      for (const label of labels) {
        if (knownPatternIds.has(label)) matched.add(label);
      }
    }
    return matched;
  }, [hunks, reviewState?.hunks, knownPatternIds]);

  const trustQuickActions = useMemo(() => {
    const actions: QuickActionItem[] = [];

    // Trust/untrust all matched patterns
    const currentTrustList = reviewState?.trustList ?? [];
    const currentTrustSet = new Set(currentTrustList);
    const matchedArray = Array.from(matchedPatternIds);
    const allTrusted =
      matchedArray.length > 0 &&
      matchedArray.every((id) => currentTrustSet.has(id));

    if (matchedArray.length > 0) {
      if (allTrusted) {
        actions.push({
          label: "Untrust all",
          count: matchedArray.length,
          onAction: () => setTrustList([]),
        });
      } else {
        actions.push({
          label: "Trust all",
          count: matchedArray.length,
          onAction: () => {
            const merged = new Set([...currentTrustList, ...matchedArray]);
            setTrustList([...merged]);
          },
        });
      }
    }

    // Classification actions
    const stale = isClassificationStale();
    if (classifying) {
      // No actions while classifying
    } else if (stale) {
      actions.push({
        label: "Reclassify (stale)",
        count: hunks.length,
        onAction: () => classifyUnlabeledHunks(),
      });
    } else if (unlabeledCount > 0) {
      actions.push({
        label: "Classify unclassified",
        count: unlabeledCount,
        onAction: () => classifyUnlabeledHunks(),
      });
    } else if (hunks.length > 0) {
      actions.push({
        label: "Reclassify all",
        count: hunks.length,
        onAction: () => reclassifyHunks(),
      });
    }
    return actions;
  }, [
    classifying,
    isClassificationStale,
    unlabeledCount,
    hunks.length,
    classifyUnlabeledHunks,
    reclassifyHunks,
    matchedPatternIds,
    reviewState?.trustList,
    setTrustList,
  ]);

  // Group unreviewed counts
  const trustList = reviewState?.trustList ?? [];
  const autoApproveStaged = reviewState?.autoApproveStaged ?? false;
  const hunkStates = reviewState?.hunks;

  const groupUnreviewedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const group of reviewGroups) {
      let count = 0;
      for (const id of group.hunkIds) {
        const hunk = hunks.find((h) => h.id === id);
        if (
          hunk &&
          !isHunkReviewed(hunkStates?.[id], trustList, {
            autoApproveStaged,
            stagedFilePaths,
            filePath: hunk.filePath,
          })
        ) {
          count++;
        }
      }
      counts.set(group.title, count);
    }
    return counts;
  }, [
    reviewGroups,
    hunks,
    hunkStates,
    trustList,
    autoApproveStaged,
    stagedFilePaths,
  ]);

  const totalGroupUnreviewed = useMemo(() => {
    let count = 0;
    for (const c of groupUnreviewedCounts.values()) count += c;
    return count;
  }, [groupUnreviewedCounts]);

  const handleGroupClick = useCallback(
    (index: number) => {
      setActiveGroupIndex(index);
      setGuideContentMode("group");
    },
    [setActiveGroupIndex, setGuideContentMode],
  );

  // Staleness
  const guide = reviewState?.guide;
  const hasGrouping = guide != null && guide.groups.length > 0;
  const stale = hasGrouping && isGroupingStale();
  const hasGroups = reviewGroups.length > 0;
  const hasPrBody = !!githubPr?.body;

  const groupsQuickActions = useMemo((): QuickActionItem[] => {
    if (groupingLoading) return [];
    return [
      {
        label: hasGroups ? "Regenerate groups" : "Generate groups",
        count: hunks.length,
        onAction: () => generateGrouping(),
      },
    ];
  }, [groupingLoading, hasGroups, hunks.length, generateGrouping]);

  // Search state
  const searchActive = useReviewStore((s) => s.searchActive);
  const searchResultCount = useReviewStore((s) => s.searchResults.length);

  // Context menu support
  const openInSplit = useReviewStore((s) => s.openInSplit);
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

  // Context value for FileListSection (shared props across all sections)
  const filesPanelContextValue = useMemo(
    () => ({
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
    }),
    [
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
    ],
  );

  // Check if there are changes in the comparison
  const hasChanges =
    sectionedFiles.needsReview.length > 0 ||
    sectionedFiles.savedForLater.length > 0 ||
    sectionedFiles.reviewed.length > 0 ||
    flatSectionedFiles.needsReview.length > 0 ||
    flatSectionedFiles.savedForLater.length > 0 ||
    flatSectionedFiles.reviewed.length > 0;

  // Handle commit selection
  const handleCommitSelect = useCallback(
    (hash: string) => {
      setSelectedCommitHash(hash);
      const commit = commits.find((c) => c.hash === hash);
      if (commit && onSelectCommit) {
        onSelectCommit(commit);
      }
    },
    [commits, onSelectCommit],
  );

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
      <FilesPanelProvider value={filesPanelContextValue}>
        <div className="flex h-full flex-col">
          {/* View mode toggle - always show all three tabs */}
          <div className="border-b border-stone-800/50 px-3 py-2">
            <Tabs
              value={viewMode}
              onValueChange={(v) => setFilesPanelTab(v as typeof viewMode)}
            >
              <TabsList aria-label="File view mode">
                <TabsTrigger value="changes">Changes</TabsTrigger>
                <TabsTrigger value="browse">Browse</TabsTrigger>
                <TabsTrigger value="commits">Commits</TabsTrigger>
                {searchActive && (
                  <TabsTrigger
                    value="search"
                    className="flex items-center gap-1"
                  >
                    <svg
                      aria-label="Search"
                      className="h-3.5 w-3.5 flex-shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <circle cx="11" cy="11" r="8" />
                      <path d="m21 21-4.3-4.3" />
                    </svg>
                    {searchResultCount > 0 && (
                      <span className="ml-1 rounded-full bg-amber-500/20 px-1.5 py-0.5 text-xxs font-medium tabular-nums text-amber-300">
                        {searchResultCount >= 100 ? "100+" : searchResultCount}
                      </span>
                    )}
                  </TabsTrigger>
                )}
              </TabsList>
            </Tabs>
          </div>

          {/* Panel content based on view mode */}
          {viewMode === "search" ? (
            <SearchResultsPanel />
          ) : viewMode === "commits" ? (
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
                      {/* Start Guided Review CTA (when no groups yet) */}
                      {!hasGroups && !groupingLoading && hunks.length > 0 && (
                        <div className="border-b border-stone-800/50 px-3 py-2">
                          <button
                            type="button"
                            onClick={startGuide}
                            disabled={guideLoading}
                            className="flex items-center gap-1.5 w-full rounded-md bg-violet-500/15 px-2.5 py-1.5 text-xs font-medium text-violet-300 border border-violet-500/20 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
                          >
                            {guideLoading ? (
                              <svg
                                className="h-3.5 w-3.5 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
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
                            ) : (
                              <svg
                                className="h-3.5 w-3.5"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                              </svg>
                            )}
                            {guideLoading ? "Starting…" : "Start Guided Review"}
                          </button>
                        </div>
                      )}

                      {/* Overview nav item (when guide has content) */}
                      {(hasGroups || guideSummary || hasPrBody) && (
                        <button
                          type="button"
                          onClick={() => setGuideContentMode("overview")}
                          className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium transition-colors border-b border-stone-800/50 ${
                            guideContentMode === "overview"
                              ? "bg-amber-500/10 text-amber-400"
                              : "text-stone-400 hover:text-stone-200 hover:bg-stone-800/50"
                          }`}
                        >
                          {summaryStatus === "loading" && (
                            <svg
                              className="h-3 w-3 animate-spin"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
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
                          )}
                          <span className="truncate">Overview</span>
                          {summaryStatus !== "loading" &&
                            guideSummary &&
                            !hasPrBody && (
                              <span className="text-purple-400 ml-auto shrink-0">
                                <svg
                                  className="h-3 w-3"
                                  viewBox="0 0 24 24"
                                  fill="currentColor"
                                >
                                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                                </svg>
                              </span>
                            )}
                        </button>
                      )}

                      {/* Trust section */}
                      {trustableHunkCount > 0 && (
                        <SectionHeader
                          title={`Trust${classifying ? "ing…" : ""}`}
                          icon={
                            classifying ? (
                              <svg
                                className="h-3.5 w-3.5 text-cyan-500 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
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
                            ) : (
                              <svg
                                className="h-3.5 w-3.5 text-cyan-500"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                              </svg>
                            )
                          }
                          badge={`${trustedHunkCount}/${trustableHunkCount}`}
                          badgeColor="cyan"
                          isOpen={trustOpen}
                          onToggle={() => setTrustOpen(!trustOpen)}
                          showTopBorder={false}
                          quickActions={trustQuickActions}
                        >
                          <TrustSection />
                        </SectionHeader>
                      )}

                      {/* Groups section */}
                      {(hasGroups || groupingLoading || groupingError) && (
                        <SectionHeader
                          title="Guided Review"
                          icon={
                            groupingLoading ? (
                              <svg
                                className="h-3.5 w-3.5 text-violet-400 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                              >
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
                            ) : (
                              <svg
                                className="h-3.5 w-3.5 text-violet-400"
                                viewBox="0 0 24 24"
                                fill="currentColor"
                              >
                                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                              </svg>
                            )
                          }
                          badge={
                            hasGroups && totalGroupUnreviewed > 0
                              ? totalGroupUnreviewed
                              : undefined
                          }
                          badgeColor="amber"
                          isOpen={groupsOpen}
                          onToggle={() => setGroupsOpen(!groupsOpen)}
                          showTopBorder={false}
                          quickActions={groupsQuickActions}
                        >
                          {/* Group error */}
                          {groupingError && (
                            <div className="px-3 py-1.5">
                              <div className="rounded bg-rose-500/10 px-2 py-1.5 inset-ring-1 inset-ring-rose-500/20">
                                <p className="text-xxs text-rose-400 mb-1">
                                  Failed: {groupingError}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => generateGrouping()}
                                  className="text-xxs text-stone-400 hover:text-stone-300 transition-colors"
                                >
                                  Retry
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Loading state */}
                          {groupingLoading && !hasGroups && (
                            <div className="px-3 py-3 text-center">
                              <span className="text-xxs text-stone-500">
                                Generating groups…
                              </span>
                            </div>
                          )}

                          {/* Stale indicator */}
                          {stale && !groupingLoading && (
                            <div className="px-3 py-1">
                              <button
                                onClick={() => generateGrouping()}
                                className="flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-xxs font-medium text-amber-400 hover:bg-amber-500/25 transition-colors"
                              >
                                Stale — regenerate
                              </button>
                            </div>
                          )}

                          {/* Group items */}
                          <div className="py-0.5">
                            {reviewGroups.map((group, i) => {
                              const unreviewedCount =
                                groupUnreviewedCounts.get(group.title) ?? 0;
                              const isCompleted = unreviewedCount === 0;
                              const isActive =
                                guideContentMode === "group" &&
                                activeGroupIndex === i;
                              return (
                                <button
                                  key={group.title}
                                  type="button"
                                  onClick={() => handleGroupClick(i)}
                                  className={`flex items-center gap-1.5 w-full px-3 py-1.5 text-xs transition-colors ${
                                    isActive
                                      ? "bg-amber-500/10 text-amber-300"
                                      : isCompleted
                                        ? "text-stone-600 hover:text-stone-400 hover:bg-stone-800/30"
                                        : "text-stone-400 hover:text-stone-200 hover:bg-stone-800/30"
                                  }`}
                                >
                                  {isCompleted ? (
                                    <span className="text-emerald-500 shrink-0">
                                      <svg
                                        className="w-3 h-3"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth={3}
                                      >
                                        <path
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          d="M5 13l4 4L19 7"
                                        />
                                      </svg>
                                    </span>
                                  ) : (
                                    <span className="w-4 text-center text-xxs text-stone-600 shrink-0 tabular-nums">
                                      {i + 1}
                                    </span>
                                  )}
                                  <span className="truncate flex-1 text-left">
                                    {group.title}
                                  </span>
                                  {!isCompleted && unreviewedCount > 0 && (
                                    <span className="text-xxs text-amber-400/70 tabular-nums shrink-0">
                                      {unreviewedCount}
                                    </span>
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {/* All groups done */}
                          {hasGroups && totalGroupUnreviewed === 0 && (
                            <div className="px-3 py-1.5">
                              <span className="text-xxs text-emerald-400 font-medium">
                                All groups reviewed
                              </span>
                            </div>
                          )}
                        </SectionHeader>
                      )}

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
                        <FileListSection
                          treeEntries={sectionedFiles.needsReview}
                          flatFilePaths={flatSectionedFiles.needsReview}
                          displayMode={needsReviewDisplayMode}
                          hunkContext="needs-review"
                          emptyIcon={FileListSection.CHECK_ICON}
                          emptyMessage="No files need review"
                        />
                      </SectionHeader>

                      {/* Saved for Later section */}
                      {(sectionedFiles.savedForLater.length > 0 ||
                        flatSectionedFiles.savedForLater.length > 0) && (
                        <SectionHeader
                          title="Saved for Later"
                          icon={
                            <svg
                              className="h-3.5 w-3.5 text-amber-400"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                          }
                          badge={stats.savedForLater}
                          badgeColor="amber"
                          isOpen={savedForLaterOpen}
                          onToggle={() =>
                            setSavedForLaterOpen(!savedForLaterOpen)
                          }
                          onExpandAll={() => expandAll(allDirPaths)}
                          onCollapseAll={collapseAll}
                          displayMode={needsReviewDisplayMode}
                          onSetDisplayMode={setNeedsReviewDisplayMode}
                        >
                          <FileListSection
                            treeEntries={sectionedFiles.savedForLater}
                            flatFilePaths={flatSectionedFiles.savedForLater}
                            displayMode={needsReviewDisplayMode}
                            hunkContext="needs-review"
                            emptyMessage="No files saved for later"
                          />
                        </SectionHeader>
                      )}

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
                        badgeColor="emerald"
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
                        <FileListSection
                          treeEntries={sectionedFiles.reviewed}
                          flatFilePaths={flatSectionedFiles.reviewed}
                          displayMode={reviewedDisplayMode}
                          hunkContext="reviewed"
                          emptyMessage="No files reviewed yet"
                        />
                      </SectionHeader>
                    </>
                  )
                ) : (
                  <>
                    {/* All Files header with expand/collapse */}
                    <div className="flex items-center border-b border-stone-800/50">
                      <div className="flex-1 px-3 py-2 text-xs font-medium text-stone-300">
                        {repoPath?.split("/").pop() || "All Files"}
                      </div>
                      {allDirPaths.size > 0 && (
                        <div className="flex items-center gap-0.5 pr-2">
                          <SimpleTooltip content="Expand all">
                            <button
                              onClick={() => expandAll(allDirPaths)}
                              className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
                            >
                              <svg
                                className="h-3 w-3"
                                fill="none"
                                viewBox="0 0 16 16"
                                stroke="currentColor"
                                strokeWidth={1.5}
                              >
                                <rect
                                  x="2"
                                  y="2"
                                  width="12"
                                  height="12"
                                  rx="1"
                                />
                                <path d="M8 5v6M5 8h6" />
                              </svg>
                            </button>
                          </SimpleTooltip>
                          <SimpleTooltip content="Collapse all">
                            <button
                              onClick={collapseAll}
                              className="text-stone-500 hover:text-stone-300 hover:bg-stone-800 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-amber-500/50 rounded p-1"
                            >
                              <svg
                                className="h-3 w-3"
                                fill="none"
                                viewBox="0 0 16 16"
                                stroke="currentColor"
                                strokeWidth={1.5}
                              >
                                <rect
                                  x="2"
                                  y="2"
                                  width="12"
                                  height="12"
                                  rx="1"
                                />
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
                            movedFilePaths={movedFilePaths}
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
            </>
          )}
        </div>

        <FilenameModal
          open={filenameModalOpen}
          onOpenChange={setFilenameModalOpen}
          mode={filenameModalMode}
          hunks={hunks}
          hunkStates={reviewState?.hunks ?? {}}
          trustList={reviewState?.trustList ?? []}
          onApproveAll={approveHunkIds}
          onRejectAll={rejectHunkIds}
          onUnapproveAll={unapproveHunkIds}
          onNavigateToFile={navigateToBrowse}
        />
      </FilesPanelProvider>
    </ReviewDataProvider>
  );
}
