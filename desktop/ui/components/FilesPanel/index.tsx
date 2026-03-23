import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { CommitsPanel } from "./CommitsPanel";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { CollapsibleSection } from "../../components/ui/collapsible-section";
import {
  isHunkTrusted,
  type CommitEntry,
  type FileSymbolDiff,
} from "../../types";
import { flattenFilesWithStatus } from "../../stores/types";
import { ReviewDataProvider } from "../ReviewDataContext";
import { FilenameModal } from "./FilenameModal";
import { SearchResultsPanel } from "./SearchResultsPanel";
import { GitStatusPanel } from "./GitStatusPanel";
import { ReviewNotesPanel } from "./ReviewNotesPanel";
import { FilesPanelProvider } from "./FilesPanelContext";
import { FileListSection, CHECK_ICON } from "./FileListSection";
import { useTrustCounts, useKnownPatternIds } from "../../hooks/useTrustCounts";
import { TrustSection } from "../GuideView/TrustSection";
import { SORT_LABELS, SELECTED_CHECK } from "./PanelToolbar";
import type { ProcessedFileEntry } from "./types";

const TRUST_ICON = (
  <svg
    className="h-3.5 w-3.5 text-status-trusted"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const NEEDS_REVIEW_ICON = (
  <svg
    className="h-3.5 w-3.5 text-status-pending"
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
);

const SAVED_FOR_LATER_ICON = (
  <svg
    className="h-3.5 w-3.5 text-status-modified"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const REVIEWED_ICON = (
  <svg
    className="h-3.5 w-3.5 text-status-approved"
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
);

/** Collect all directory paths from a processed tree (for expand/collapse) */
function collectDirPaths(entries: ProcessedFileEntry[]): Set<string> {
  const paths = new Set<string>();
  function walk(items: ProcessedFileEntry[]) {
    for (const entry of items) {
      if (entry.isDirectory && entry.matchesFilter) {
        for (const p of entry.compactedPaths) paths.add(p);
        if (entry.children) walk(entry.children);
      }
    }
  }
  walk(entries);
  return paths;
}

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
  badgeColor = "status-modified",
  isOpen,
  onToggle,
  onApproveAll,
  onUnapproveAll,
  unapproveAllLabel = "Unapprove all",
  quickActions,
  onExpandAll,
  onCollapseAll,
  additionalMenuContent,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  badge?: number | string;
  badgeColor?:
    | "status-modified"
    | "status-approved"
    | "status-trusted"
    | "status-pending";
  isOpen: boolean;
  onToggle: () => void;
  onApproveAll?: () => void;
  onUnapproveAll?: () => void;
  unapproveAllLabel?: string;
  quickActions?: QuickActionItem[];
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  additionalMenuContent?: React.ReactNode;
  children: React.ReactNode;
}) {
  const badgeColors = {
    "status-modified": "bg-status-modified/20 text-status-modified",
    "status-approved": "bg-status-approved/20 text-status-approved",
    "status-trusted": "bg-status-trusted/20 text-status-trusted",
    "status-pending": "bg-status-pending/20 text-status-pending",
  };

  const hasExpandCollapse = onExpandAll || onCollapseAll;
  const hasBaseMenuItems =
    (quickActions && quickActions.length > 0) ||
    onApproveAll ||
    onUnapproveAll ||
    hasExpandCollapse;
  const hasMenuItems = hasBaseMenuItems || !!additionalMenuContent;

  const menuContent = hasMenuItems ? (
    <>
      {/* Bulk approve/unapprove */}
      {(onApproveAll || onUnapproveAll) && (
        <>
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
              {unapproveAllLabel}
            </DropdownMenuItem>
          )}
        </>
      )}

      {/* Quick actions */}
      {quickActions && quickActions.length > 0 && (
        <>
          {(onApproveAll || onUnapproveAll) && <DropdownMenuSeparator />}
          {quickActions.map((qa) => (
            <DropdownMenuItem key={qa.label} onClick={qa.onAction}>
              <span className="flex-1">{qa.label}</span>
              <span className="ml-2 text-xxs tabular-nums text-fg-muted">
                {qa.count}
              </span>
            </DropdownMenuItem>
          ))}
        </>
      )}

      {/* Expand/collapse */}
      {hasExpandCollapse && (
        <>
          <DropdownMenuSeparator />
          {onExpandAll && (
            <DropdownMenuItem onClick={onExpandAll}>
              Expand all
            </DropdownMenuItem>
          )}
          {onCollapseAll && (
            <DropdownMenuItem onClick={onCollapseAll}>
              Collapse all
            </DropdownMenuItem>
          )}
        </>
      )}

      {/* Additional menu content (e.g., view options) */}
      {additionalMenuContent && (
        <>
          {hasBaseMenuItems && <DropdownMenuSeparator />}
          {additionalMenuContent}
        </>
      )}
    </>
  ) : undefined;

  return (
    <CollapsibleSection
      title={title}
      icon={icon}
      badge={badge}
      badgeColor={badgeColors[badgeColor]}
      isOpen={isOpen}
      onToggle={onToggle}
      menuContent={menuContent}
    >
      {children}
    </CollapsibleSection>
  );
}

interface FilesPanelProps {
  onSelectCommit?: (commit: CommitEntry) => void;
}

export function FilesPanel({ onSelectCommit }: FilesPanelProps) {
  const comparison = useReviewStore((s) => s.comparison);
  const commits = useReviewStore((s) => s.commits);

  // Track selected commit hash locally (for highlighting in CommitsPanel)
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(
    null,
  );

  // Section collapse state
  const [browseFilesOpen, setBrowseFilesOpen] = useState(true);
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

  // Wrap handleSelectFile to also clear commit selection
  const handleSelectFileAndClearCommit = useCallback(
    (path: string) => {
      setSelectedCommitHash(null);
      handleSelectFile(path);
    },
    [handleSelectFile],
  );

  // Approval actions
  const { handleApproveAll, handleUnapproveAll, handleRejectAll } =
    useFilePanelApproval();

  // Changes display mode (tree vs flat) — one toggle per panel
  const changesDisplayMode = useReviewStore((s) => s.changesDisplayMode);
  const setChangesDisplayMode = useReviewStore((s) => s.setChangesDisplayMode);

  // File sort order (shared across Browse + Changes tabs)
  const fileSortOrder = useReviewStore((s) => s.fileSortOrder);
  const setFileSortOrder = useReviewStore((s) => s.setFileSortOrder);
  const anyFlatMode = changesDisplayMode === "flat";

  // Symbol data for flat mode
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);
  const files = useReviewStore((s) => s.files);

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
    if (pendingHunkIds.length > 0)
      useReviewStore.getState().approveHunkIds(pendingHunkIds);
  }, [pendingHunkIds]);

  const handleUnapproveAllHunks = useCallback(() => {
    if (reviewedHunkIds.length > 0)
      useReviewStore.getState().unapproveHunkIds(reviewedHunkIds);
  }, [reviewedHunkIds]);

  const savedForLaterHunkIds = useMemo(() => {
    return hunks
      .filter((h) => reviewState?.hunks[h.id]?.status === "saved_for_later")
      .map((h) => h.id);
  }, [hunks, reviewState]);

  const handleUnsaveAll = useCallback(() => {
    if (savedForLaterHunkIds.length > 0)
      useReviewStore.getState().unapproveHunkIds(savedForLaterHunkIds);
  }, [savedForLaterHunkIds]);

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
          onAction: () =>
            useReviewStore.getState().approveHunkIds(data.pendingIds),
        });
      }
    }
    if (basenameCount > 0) {
      actions.push({
        label: "Approve by filename…",
        count: basenameCount,
        onAction: () => {
          setFilenameModalMode("approve");
          setFilenameModalOpen(true);
        },
      });
    }
    return actions;
  }, [quickActionData, basenameCount]);

  // Count of approved + trusted hunks (for "Stage approved" action)
  const approvedOrTrustedCount = useMemo(() => {
    return hunks.filter((h) => {
      const state = reviewState?.hunks[h.id];
      if (state?.status === "approved") return true;
      if (reviewState && isHunkTrusted(state, reviewState.trustList))
        return true;
      return false;
    }).length;
  }, [hunks, reviewState]);

  const reviewedQuickActions = useMemo(() => {
    const actions: QuickActionItem[] = [];

    // Cross-cutting: stage approved hunks
    if (approvedOrTrustedCount > 0) {
      actions.push({
        label: "Stage approved",
        count: approvedOrTrustedCount,
        onAction: async () => {
          // Group approved/trusted hunk content hashes by file path
          const byFile = new Map<string, string[]>();
          for (const h of hunks) {
            const state = reviewState?.hunks[h.id];
            const isApproved = state?.status === "approved";
            const isTrusted =
              reviewState && isHunkTrusted(state, reviewState.trustList);
            if (!isApproved && !isTrusted) continue;
            const existing = byFile.get(h.filePath) ?? [];
            existing.push(h.contentHash);
            byFile.set(h.filePath, existing);
          }
          const s = useReviewStore.getState();
          for (const [filePath, contentHashes] of byFile) {
            try {
              await s.stageHunks(filePath, contentHashes);
            } catch (err) {
              console.error(`Failed to stage hunks for ${filePath}:`, err);
            }
          }
        },
      });
    }

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
          onAction: () =>
            useReviewStore.getState().unapproveHunkIds(data.approvedIds),
        });
      }
    }
    if (basenameCount > 0) {
      actions.push({
        label: "Unapprove by filename…",
        count: basenameCount,
        onAction: () => {
          setFilenameModalMode("unapprove");
          setFilenameModalOpen(true);
        },
      });
    }
    return actions;
  }, [quickActionData, basenameCount, approvedOrTrustedCount]);

  // Trust section
  const knownPatternIds = useKnownPatternIds();
  const { trustedHunkCount, trustableHunkCount } =
    useTrustCounts(knownPatternIds);
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
          onAction: () => useReviewStore.getState().setTrustList([]),
        });
      } else {
        actions.push({
          label: "Trust all",
          count: matchedArray.length,
          onAction: () => {
            const merged = new Set([...currentTrustList, ...matchedArray]);
            useReviewStore.getState().setTrustList([...merged]);
          },
        });
      }
    }

    // Classification actions
    const stale = isClassificationStale();
    if (stale) {
      actions.push({
        label: "Reclassify (stale)",
        count: hunks.length,
        onAction: () => useReviewStore.getState().classifyStaticHunks(),
      });
    } else if (unlabeledCount > 0) {
      actions.push({
        label: "Classify unclassified",
        count: unlabeledCount,
        onAction: () => useReviewStore.getState().classifyStaticHunks(),
      });
    } else if (hunks.length > 0) {
      actions.push({
        label: "Reclassify all",
        count: hunks.length,
        onAction: () => useReviewStore.getState().reclassifyHunks(),
      });
    }
    return actions;
  }, [
    isClassificationStale,
    unlabeledCount,
    hunks.length,
    matchedPatternIds,
    reviewState?.trustList,
  ]);

  // Search state
  const searchResultCount = useReviewStore((s) => s.searchResults.length);

  // Sort menu items shared across Review and Browse tabs
  const sortMenuItems = useMemo(
    () =>
      (["name", "size", "modified"] as const).map((order) => (
        <DropdownMenuItem key={order} onClick={() => setFileSortOrder(order)}>
          <span className="flex-1">{SORT_LABELS[order]}</span>
          {fileSortOrder === order && SELECTED_CHECK}
        </DropdownMenuItem>
      )),
    [fileSortOrder],
  );

  // View options menu content for Review tab section headers
  const viewOptionsMenuContent = useMemo(
    () => (
      <>
        {sortMenuItems}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => setChangesDisplayMode("tree")}>
          <span className="flex-1">Tree view</span>
          {changesDisplayMode === "tree" && SELECTED_CHECK}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setChangesDisplayMode("flat")}>
          <span className="flex-1">Flat view</span>
          {changesDisplayMode === "flat" && SELECTED_CHECK}
        </DropdownMenuItem>
      </>
    ),
    [sortMenuItems, changesDisplayMode],
  );

  // Context menu support
  const openInSplit = useReviewStore((s) => s.openInSplit);
  const selectWorkingTreeFile = useReviewStore((s) => s.selectWorkingTreeFile);

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
      handleSelectFile: handleSelectFileAndClearCommit,
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
      handleSelectFileAndClearCommit,
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

  // Per-section dir paths for expand/collapse (only needed in tree mode)
  const needsReviewDirPaths = useMemo(
    () => collectDirPaths(sectionedFiles.needsReview),
    [sectionedFiles.needsReview],
  );
  const savedForLaterDirPaths = useMemo(
    () => collectDirPaths(sectionedFiles.savedForLater),
    [sectionedFiles.savedForLater],
  );
  const reviewedDirPaths = useMemo(
    () => collectDirPaths(sectionedFiles.reviewed),
    [sectionedFiles.reviewed],
  );

  // Combined dir paths across all change sections (for auto-expand)
  const allChangesDirPaths = useMemo(() => {
    const combined = new Set<string>();
    for (const p of needsReviewDirPaths) combined.add(p);
    for (const p of savedForLaterDirPaths) combined.add(p);
    for (const p of reviewedDirPaths) combined.add(p);
    return combined;
  }, [needsReviewDirPaths, savedForLaterDirPaths, reviewedDirPaths]);

  // Auto-expand tree when switching to tree mode or loading a new comparison.
  // Resets when leaving tree mode or when dir paths empty (new comparison loading).
  const hasAutoExpandedChanges = useRef(false);

  useEffect(() => {
    if (changesDisplayMode !== "tree" || allChangesDirPaths.size === 0) {
      hasAutoExpandedChanges.current = false;
      return;
    }
    if (!hasAutoExpandedChanges.current) {
      hasAutoExpandedChanges.current = true;
      expandAll(allChangesDirPaths, renamedDirPaths);
    }
  }, [changesDisplayMode, allChangesDirPaths, renamedDirPaths, expandAll]);

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
            {/* Overflow menu for secondary views */}
            {comparison && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={`flex-shrink-0 flex items-center transition-colors ${
                      viewMode === "commits"
                        ? "gap-0.5 rounded bg-surface-hover px-2 py-1 text-xxs font-medium text-fg"
                        : "p-1 rounded-md text-fg-muted hover:text-fg-secondary hover:bg-surface-hover"
                    }`}
                    title={viewMode !== "commits" ? "More views" : undefined}
                  >
                    {viewMode === "commits" ? (
                      <>
                        Commits
                        <svg
                          className="h-3 w-3 opacity-60"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </>
                    ) : (
                      <svg
                        className="h-4 w-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="12" cy="5" r="1" />
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="12" cy="19" r="1" />
                      </svg>
                    )}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => setFilesPanelTab("commits")}
                    className={viewMode === "commits" ? "bg-surface-hover" : ""}
                  >
                    Commits
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Panel content based on view mode */}
          {viewMode === "search" ? (
            <SearchResultsPanel />
          ) : viewMode === "git" ? (
            <GitStatusPanel
              onSelectFile={handleSelectFileAndClearCommit}
              onSelectWorkingTreeFile={selectWorkingTreeFile}
            />
          ) : viewMode === "commits" ? (
            <CommitsPanel
              onSelectCommit={handleCommitSelect}
              selectedCommitHash={selectedCommitHash}
            />
          ) : viewMode === "changes" ? (
            !hasChanges ? (
              /* Empty state when no changes exist */
              <div className="flex flex-col items-center justify-center flex-1 px-6 py-12">
                <div className="relative mb-6">
                  <div className="flex gap-1.5">
                    <div className="w-10 h-14 rounded bg-surface-raised/80 border border-edge-default/50" />
                    <div className="w-10 h-14 rounded bg-surface-raised/80 border border-edge-default/50" />
                  </div>
                  <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-0.5">
                    <div className="w-1.5 h-0.5 bg-surface-active rounded-full" />
                    <div className="w-1.5 h-0.5 bg-surface-active rounded-full" />
                  </div>
                </div>
                <p className="text-sm font-medium text-fg-muted mb-1">
                  No changes
                </p>
                <p className="text-xs text-fg-muted text-center max-w-[200px]">
                  The base and compare refs are identical
                </p>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                <ReviewNotesPanel />

                {/* Reviewed section */}
                <SectionHeader
                  title="Reviewed"
                  icon={REVIEWED_ICON}
                  badge={stats.reviewed + stats.rejected}
                  badgeColor="status-approved"
                  isOpen={reviewedOpen}
                  onToggle={() => setReviewedOpen(!reviewedOpen)}
                  onUnapproveAll={
                    reviewedHunkIds.length > 0
                      ? handleUnapproveAllHunks
                      : undefined
                  }
                  quickActions={reviewedQuickActions}
                  onExpandAll={
                    changesDisplayMode === "tree"
                      ? () => expandAll(reviewedDirPaths, renamedDirPaths)
                      : undefined
                  }
                  onCollapseAll={
                    changesDisplayMode === "tree" ? collapseAll : undefined
                  }
                  additionalMenuContent={viewOptionsMenuContent}
                >
                  <FileListSection
                    treeEntries={sectionedFiles.reviewed}
                    flatFilePaths={flatSectionedFiles.reviewed}
                    displayMode={changesDisplayMode}
                    hunkContext="reviewed"
                    emptyMessage="No files reviewed yet"
                  />
                </SectionHeader>

                {/* Needs Review section */}
                <SectionHeader
                  title="Needs Review"
                  icon={NEEDS_REVIEW_ICON}
                  badge={stats.pending}
                  badgeColor="status-pending"
                  isOpen={needsReviewOpen}
                  onToggle={() => setNeedsReviewOpen(!needsReviewOpen)}
                  onApproveAll={
                    pendingHunkIds.length > 0
                      ? handleApproveAllHunks
                      : undefined
                  }
                  quickActions={needsReviewQuickActions}
                  onExpandAll={
                    changesDisplayMode === "tree"
                      ? () => expandAll(needsReviewDirPaths, renamedDirPaths)
                      : undefined
                  }
                  onCollapseAll={
                    changesDisplayMode === "tree" ? collapseAll : undefined
                  }
                >
                  <FileListSection
                    treeEntries={sectionedFiles.needsReview}
                    flatFilePaths={flatSectionedFiles.needsReview}
                    displayMode={changesDisplayMode}
                    hunkContext="needs-review"
                    emptyIcon={CHECK_ICON}
                    emptyMessage="No files need review"
                  />
                </SectionHeader>

                {/* Saved for Later section */}
                {(sectionedFiles.savedForLater.length > 0 ||
                  flatSectionedFiles.savedForLater.length > 0) && (
                  <SectionHeader
                    title="Saved for Later"
                    icon={SAVED_FOR_LATER_ICON}
                    badge={stats.savedForLater}
                    badgeColor="status-modified"
                    isOpen={savedForLaterOpen}
                    onToggle={() => setSavedForLaterOpen(!savedForLaterOpen)}
                    onUnapproveAll={
                      savedForLaterHunkIds.length > 0
                        ? handleUnsaveAll
                        : undefined
                    }
                    unapproveAllLabel="Unsave all"
                    onExpandAll={
                      changesDisplayMode === "tree"
                        ? () =>
                            expandAll(savedForLaterDirPaths, renamedDirPaths)
                        : undefined
                    }
                    onCollapseAll={
                      changesDisplayMode === "tree" ? collapseAll : undefined
                    }
                  >
                    <FileListSection
                      treeEntries={sectionedFiles.savedForLater}
                      flatFilePaths={flatSectionedFiles.savedForLater}
                      displayMode={changesDisplayMode}
                      hunkContext="needs-review"
                      emptyMessage="No files saved for later"
                    />
                  </SectionHeader>
                )}

                {/* Trust section */}
                {trustableHunkCount > 0 && (
                  <SectionHeader
                    title="Trust"
                    icon={TRUST_ICON}
                    badge={`${trustedHunkCount}/${trustableHunkCount}`}
                    badgeColor="status-trusted"
                    isOpen={trustOpen}
                    onToggle={() => setTrustOpen(!trustOpen)}
                    quickActions={trustQuickActions}
                  >
                    <TrustSection />
                  </SectionHeader>
                )}
              </div>
            )
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
                        onSelectFile={handleSelectFileAndClearCommit}
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

        <FilenameModal
          open={filenameModalOpen}
          onOpenChange={setFilenameModalOpen}
          mode={filenameModalMode}
          hunks={hunks}
          hunkStates={reviewState?.hunks ?? {}}
          trustList={reviewState?.trustList ?? []}
          onApproveAll={(ids) => useReviewStore.getState().approveHunkIds(ids)}
          onRejectAll={(ids) => useReviewStore.getState().rejectHunkIds(ids)}
          onUnapproveAll={(ids) =>
            useReviewStore.getState().unapproveHunkIds(ids)
          }
          onNavigateToFile={(path) =>
            useReviewStore.getState().navigateToBrowse(path)
          }
        />
      </FilesPanelProvider>
    </ReviewDataProvider>
  );
}
