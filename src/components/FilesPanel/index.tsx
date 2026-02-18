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
import { Tabs, TabsList, TabsTrigger } from "../../components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";
import {
  CollapsibleSection,
  DisplayModeToggle,
} from "../../components/ui/collapsible-section";
import {
  isHunkTrusted,
  isHunkReviewed,
  type CommitEntry,
  type FileSymbolDiff,
} from "../../types";
import { flattenFilesWithStatus } from "../../stores/types";
import { ReviewDataProvider } from "../ReviewDataContext";
import { FilenameModal } from "./FilenameModal";
import { SearchResultsPanel } from "./SearchResultsPanel";
import { GitStatusPanel } from "./GitStatusPanel";
import { FilesPanelProvider } from "./FilesPanelContext";
import { FileListSection, CHECK_ICON } from "./FileListSection";
import { useTrustCounts, useKnownPatternIds } from "../../hooks/useTrustCounts";
import { TrustSection } from "../GuideView/TrustSection";
import {
  PanelToolbar,
  ExpandCollapseButtons,
  ProgressBar,
  SearchButton,
} from "./PanelToolbar";
import type { ProcessedFileEntry } from "./types";

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

function groupItemStyle(isActive: boolean, isCompleted: boolean): string {
  if (isActive) return "bg-status-modified/10 text-status-modified";
  if (isCompleted)
    return "text-fg-faint hover:text-fg-muted hover:bg-surface-raised/30";
  return "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/30";
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
  children: React.ReactNode;
}) {
  const badgeColors = {
    "status-modified": "bg-status-modified/20 text-status-modified",
    "status-approved": "bg-status-approved/20 text-status-approved",
    "status-trusted": "bg-status-trusted/20 text-status-trusted",
    "status-pending": "bg-status-pending/20 text-status-pending",
  };

  const hasExpandCollapse = onExpandAll || onCollapseAll;
  const hasMenuItems =
    (quickActions && quickActions.length > 0) ||
    onApproveAll ||
    onUnapproveAll ||
    hasExpandCollapse;

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

function GroupItemOverflowMenu({
  unreviewedIds,
  reviewedIds,
  onApprove,
  onReject,
  onReset,
}: {
  unreviewedIds: string[];
  reviewedIds: string[];
  onApprove: () => void;
  onReject: () => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const hasUnreviewed = unreviewedIds.length > 0;
  const hasReviewed = reviewedIds.length > 0;

  if (!hasUnreviewed && !hasReviewed) return null;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          onClick={(e) => e.stopPropagation()}
          className={`mr-1 flex items-center justify-center w-5 h-5 rounded shrink-0
                     text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50
                     transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="12" cy="5" r="1.5" />
            <circle cx="12" cy="12" r="1.5" />
            <circle cx="12" cy="19" r="1.5" />
          </svg>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasUnreviewed && (
          <>
            <DropdownMenuItem onClick={onApprove}>
              <svg
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
              Approve all hunks
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onReject}>
              <svg
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
              Reject all hunks
            </DropdownMenuItem>
          </>
        )}
        {hasReviewed && (
          <DropdownMenuItem onClick={onReset}>
            <svg
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
              />
            </svg>
            Reset review
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
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
    showGitTab,
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

  // Changes display mode (tree vs flat) — one toggle per panel
  const changesDisplayMode = useReviewStore((s) => s.changesDisplayMode);
  const setChangesDisplayMode = useReviewStore((s) => s.setChangesDisplayMode);
  const anyFlatMode = changesDisplayMode === "flat";

  // Symbol data for flat mode
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);
  const files = useReviewStore((s) => s.files);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const setContentSearchOpen = useReviewStore((s) => s.setContentSearchOpen);

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

  const savedForLaterHunkIds = useMemo(() => {
    return hunks
      .filter((h) => reviewState?.hunks[h.id]?.status === "saved_for_later")
      .map((h) => h.id);
  }, [hunks, reviewState]);

  const handleUnsaveAll = useCallback(() => {
    if (savedForLaterHunkIds.length > 0) unapproveHunkIds(savedForLaterHunkIds);
  }, [savedForLaterHunkIds, unapproveHunkIds]);

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
        label: "Approve by filename…",
        count: basenameCount,
        onAction: () => {
          setFilenameModalMode("approve");
          setFilenameModalOpen(true);
        },
      });
    }
    return actions;
  }, [quickActionData, approveHunkIds, basenameCount]);

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
          onAction: () => unapproveHunkIds(data.approvedIds),
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
  }, [
    quickActionData,
    unapproveHunkIds,
    basenameCount,
    approvedOrTrustedCount,
  ]);

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
  const githubPr = useReviewStore((s) => s.reviewState?.githubPr);
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

  const groupActionData = useMemo(() => {
    const data = new Map<
      string,
      { unreviewedIds: string[]; reviewedIds: string[] }
    >();
    for (const group of reviewGroups) {
      const unreviewedIds: string[] = [];
      const reviewedIds: string[] = [];
      for (const id of group.hunkIds) {
        const hunk = hunks.find((h) => h.id === id);
        if (!hunk) continue;
        const state = hunkStates?.[id];
        if (state?.status === "approved" || state?.status === "rejected") {
          reviewedIds.push(id);
        }
        if (
          !isHunkReviewed(state, trustList, {
            autoApproveStaged,
            stagedFilePaths,
            filePath: hunk.filePath,
          })
        ) {
          unreviewedIds.push(id);
        }
      }
      data.set(group.title, { unreviewedIds, reviewedIds });
    }
    return data;
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
  const selectWorkingTreeFile = useReviewStore((s) => s.selectWorkingTreeFile);
  const [revealLabel, setRevealLabel] = useState("Reveal in Finder");
  useEffect(() => {
    const platformName = getPlatformServices().window.getPlatformName();
    if (platformName === "macos") {
      setRevealLabel("Reveal in Finder");
    } else if (platformName === "windows") {
      setRevealLabel("Reveal in Explorer");
    } else {
      setRevealLabel("Reveal in Files");
    }
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
      expandAll,
      collapseAll,
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
      expandAll,
      collapseAll,
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
          <div className="h-6 w-6 rounded-full border-2 border-edge-default border-t-status-modified animate-spin" />
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
          <div className="px-3 py-2">
            <Tabs
              value={viewMode}
              onValueChange={(v) => setFilesPanelTab(v as typeof viewMode)}
            >
              <TabsList aria-label="File view mode">
                {showGitTab && <TabsTrigger value="git">Git</TabsTrigger>}
                <TabsTrigger value="changes">Review</TabsTrigger>
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
                      <span className="ml-1 rounded-full bg-status-modified/20 px-1.5 py-0.5 text-xxs font-medium tabular-nums text-status-modified">
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
          ) : viewMode === "git" ? (
            <GitStatusPanel
              onSelectFile={handleSelectFile}
              onSelectWorkingTreeFile={selectWorkingTreeFile}
            />
          ) : viewMode === "commits" ? (
            <CommitsPanel
              onSelectCommit={handleCommitSelect}
              selectedCommitHash={selectedCommitHash}
            />
          ) : (
            <>
              {/* Panel toolbar */}
              {viewMode === "changes" && hasChanges && (
                <PanelToolbar>
                  <ProgressBar
                    value={
                      stats.total > 0
                        ? (stats.reviewed + stats.rejected) / stats.total
                        : 0
                    }
                    color="bg-status-approved"
                  />
                  <DisplayModeToggle
                    mode={changesDisplayMode}
                    onChange={setChangesDisplayMode}
                  />
                </PanelToolbar>
              )}
              {viewMode === "browse" && allDirPaths.size > 0 && (
                <PanelToolbar>
                  <span className="flex-1 text-xs font-medium text-fg-muted select-none">
                    All Files
                  </span>
                  <SearchButton onClick={() => setContentSearchOpen(true)} />
                  <ExpandCollapseButtons
                    onExpandAll={() => expandAll(allDirPaths)}
                    onCollapseAll={collapseAll}
                  />
                </PanelToolbar>
              )}

              {/* File tree */}
              <div className="flex-1 overflow-y-auto scrollbar-thin">
                {viewMode === "changes" ? (
                  !hasChanges ? (
                    /* Empty state when no changes exist */
                    <div className="flex flex-col items-center justify-center h-full px-6 py-12">
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
                    <>
                      {/* Start Guided Review CTA (when no groups yet) */}
                      {!hasGroups && !groupingLoading && hunks.length > 0 && (
                        <div className="px-3 py-2">
                          <button
                            type="button"
                            onClick={startGuide}
                            disabled={guideLoading}
                            className="flex items-center gap-1.5 w-full rounded-md bg-status-classifying/15 px-2.5 py-1.5 text-xs font-medium text-status-classifying border border-status-classifying/20 hover:bg-status-classifying/25 transition-colors disabled:opacity-50"
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
                          className={`flex items-center gap-2 w-full px-3 py-1.5 text-xs font-medium transition-colors ${
                            guideContentMode === "overview"
                              ? "bg-status-modified/10 text-status-modified"
                              : "text-fg-muted hover:text-fg-secondary hover:bg-surface-raised/50"
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
                              <span className="text-status-classifying ml-auto shrink-0">
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
                                className="h-3.5 w-3.5 text-status-trusted animate-spin"
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
                            )
                          }
                          badge={`${trustedHunkCount}/${trustableHunkCount}`}
                          badgeColor="status-trusted"
                          isOpen={trustOpen}
                          onToggle={() => setTrustOpen(!trustOpen)}
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
                                className="h-3.5 w-3.5 text-status-classifying animate-spin"
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
                                className="h-3.5 w-3.5 text-status-classifying"
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
                          badgeColor="status-modified"
                          isOpen={groupsOpen}
                          onToggle={() => setGroupsOpen(!groupsOpen)}
                          quickActions={groupsQuickActions}
                        >
                          {/* Group error */}
                          {groupingError && (
                            <div className="px-3 py-1.5">
                              <div className="rounded bg-status-rejected/10 px-2 py-1.5 inset-ring-1 inset-ring-status-rejected/20">
                                <p className="text-xxs text-status-rejected mb-1">
                                  Failed: {groupingError}
                                </p>
                                <button
                                  type="button"
                                  onClick={() => generateGrouping()}
                                  className="text-xxs text-fg-muted hover:text-fg-secondary transition-colors"
                                >
                                  Retry
                                </button>
                              </div>
                            </div>
                          )}

                          {/* Loading state */}
                          {groupingLoading && !hasGroups && (
                            <div className="px-3 py-3 text-center">
                              <span className="text-xxs text-fg-muted">
                                Generating groups…
                              </span>
                            </div>
                          )}

                          {/* Stale indicator */}
                          {stale && !groupingLoading && (
                            <div className="px-3 py-1">
                              <button
                                onClick={() => generateGrouping()}
                                className="flex items-center gap-1 rounded-full bg-status-modified/15 px-1.5 py-0.5 text-xxs font-medium text-status-modified hover:bg-status-modified/25 transition-colors"
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
                              const data = groupActionData.get(group.title);
                              return (
                                <div
                                  key={group.title}
                                  className="group flex items-center"
                                >
                                  <button
                                    type="button"
                                    onClick={() => handleGroupClick(i)}
                                    className={`flex items-center gap-1.5 flex-1 min-w-0 px-3 py-1.5 text-xs transition-colors ${groupItemStyle(isActive, isCompleted)}`}
                                  >
                                    {isCompleted ? (
                                      <span className="text-status-approved shrink-0">
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
                                      <span className="w-4 text-center text-xxs text-fg-faint shrink-0 tabular-nums">
                                        {i + 1}
                                      </span>
                                    )}
                                    <span className="truncate flex-1 text-left">
                                      {group.title}
                                    </span>
                                    {!isCompleted && unreviewedCount > 0 && (
                                      <span className="text-xxs text-status-modified/70 tabular-nums shrink-0">
                                        {unreviewedCount}
                                      </span>
                                    )}
                                  </button>
                                  <GroupItemOverflowMenu
                                    unreviewedIds={data?.unreviewedIds ?? []}
                                    reviewedIds={data?.reviewedIds ?? []}
                                    onApprove={() =>
                                      approveHunkIds(data?.unreviewedIds ?? [])
                                    }
                                    onReject={() =>
                                      rejectHunkIds(data?.unreviewedIds ?? [])
                                    }
                                    onReset={() =>
                                      unapproveHunkIds(data?.reviewedIds ?? [])
                                    }
                                  />
                                </div>
                              );
                            })}
                          </div>

                          {/* All groups done */}
                          {hasGroups && totalGroupUnreviewed === 0 && (
                            <div className="px-3 py-1.5">
                              <span className="text-xxs text-status-approved font-medium">
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
                            className="h-3.5 w-3.5 text-fg-muted"
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
                            ? () => expandAll(needsReviewDirPaths)
                            : undefined
                        }
                        onCollapseAll={
                          changesDisplayMode === "tree"
                            ? collapseAll
                            : undefined
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
                          icon={
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
                          }
                          badge={stats.savedForLater}
                          badgeColor="status-modified"
                          isOpen={savedForLaterOpen}
                          onToggle={() =>
                            setSavedForLaterOpen(!savedForLaterOpen)
                          }
                          onUnapproveAll={
                            savedForLaterHunkIds.length > 0
                              ? handleUnsaveAll
                              : undefined
                          }
                          unapproveAllLabel="Unsave all"
                          onExpandAll={
                            changesDisplayMode === "tree"
                              ? () => expandAll(savedForLaterDirPaths)
                              : undefined
                          }
                          onCollapseAll={
                            changesDisplayMode === "tree"
                              ? collapseAll
                              : undefined
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

                      {/* Reviewed section */}
                      <SectionHeader
                        title="Reviewed"
                        icon={
                          <svg
                            className="h-3.5 w-3.5 text-fg-muted"
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
                            ? () => expandAll(reviewedDirPaths)
                            : undefined
                        }
                        onCollapseAll={
                          changesDisplayMode === "tree"
                            ? collapseAll
                            : undefined
                        }
                      >
                        <FileListSection
                          treeEntries={sectionedFiles.reviewed}
                          flatFilePaths={flatSectionedFiles.reviewed}
                          displayMode={changesDisplayMode}
                          hunkContext="reviewed"
                          emptyMessage="No files reviewed yet"
                        />
                      </SectionHeader>
                    </>
                  )
                ) : (
                  <>
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
                            showSizeBar
                          />
                        ))
                      ) : (
                        <div className="py-4 text-center">
                          <p className="text-xs text-fg-muted">No files</p>
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
