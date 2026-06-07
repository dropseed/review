import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useReviewStore } from "../../stores";
import { flattenFilesWithStatus } from "../../stores/types";
import { useHunkIdsByStatus } from "../../stores/selectors/hunks";
import { useTrustCounts, useKnownPatternIds } from "../../hooks/useTrustCounts";
import {
  isHunkTrusted,
  hunkLabels,
  type DiffHunk,
  type ReviewState,
} from "../../types";
import { DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";
import { CollapsibleSection } from "../ui/collapsible-section";
import { XIcon } from "../ui/icons";
import { RollingDiffButton } from "../ui/rolling-diff-button";
import { TrustSection } from "../GuideView/TrustSection";
import { FileListSection, CHECK_ICON } from "./FileListSection";
import { GuideGroupList, useGuideGroupState } from "./GuideGroupList";
import { FilenameModal } from "./FilenameModal";
import { ReviewNotesPanel } from "./ReviewNotesPanel";
import { ReviewCommentsPanel } from "./ReviewCommentsPanel";
import { ReviewActionBar } from "./ReviewActionBar";
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

const GUIDE_ICON = (
  <svg
    className="h-3.5 w-3.5 text-guide"
    viewBox="0 0 24 24"
    fill="currentColor"
  >
    <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
  </svg>
);

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
  /** Number of hunks the action affects. Omit for actions that open a tool. */
  count?: number;
  onAction: () => void;
}

interface SectionHeaderProps {
  title: string;
  icon?: ReactNode;
  badge?: number | string;
  badgeColor?:
    | "status-modified"
    | "status-approved"
    | "status-trusted"
    | "status-pending"
    | "guide";
  isOpen: boolean;
  onToggle: () => void;
  onApproveAll?: () => void;
  onUnapproveAll?: () => void;
  unapproveAllLabel?: string;
  quickActions?: QuickActionItem[];
  onExpandAll?: () => void;
  onCollapseAll?: () => void;
  additionalMenuContent?: ReactNode;
  actionContent?: ReactNode;
  statusBadge?: ReactNode;
  children: ReactNode;
}

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
  actionContent,
  statusBadge,
  children,
}: SectionHeaderProps) {
  const badgeColors = {
    "status-modified": "bg-status-modified/20 text-status-modified",
    "status-approved": "bg-status-approved/20 text-status-approved",
    "status-trusted": "bg-status-trusted/20 text-status-trusted",
    "status-pending": "bg-status-pending/20 text-status-pending",
    guide: "bg-guide/15 text-guide",
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

      {quickActions && quickActions.length > 0 && (
        <>
          {(onApproveAll || onUnapproveAll) && <DropdownMenuSeparator />}
          {quickActions.map((qa) => (
            <DropdownMenuItem key={qa.label} onClick={qa.onAction}>
              <span className="flex-1">{qa.label}</span>
              {qa.count !== undefined && (
                <span className="ml-2 text-xxs tabular-nums text-fg-muted">
                  {qa.count}
                </span>
              )}
            </DropdownMenuItem>
          ))}
        </>
      )}

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
      statusBadge={statusBadge}
      isOpen={isOpen}
      onToggle={onToggle}
      actionContent={actionContent}
      menuContent={menuContent}
    >
      {children}
    </CollapsibleSection>
  );
}

interface SectionedFilesGroup {
  needsReview: ProcessedFileEntry[];
  savedForLater: ProcessedFileEntry[];
  reviewed: ProcessedFileEntry[];
}

interface FlatSectionedFilesGroup {
  needsReview: string[];
  savedForLater: string[];
  reviewed: string[];
}

interface ReviewStats {
  pending: number;
  approved: number;
  trusted: number;
  reviewed: number;
  total: number;
  rejected: number;
  savedForLater: number;
  needsReviewFiles: number;
  reviewedFiles: number;
}

export interface ReviewTabContentProps {
  sectionedFiles: SectionedFilesGroup;
  flatSectionedFiles: FlatSectionedFilesGroup;
  stats: ReviewStats;
  renamedDirPaths: Set<string>;
  hunks: DiffHunk[];
  reviewState: ReviewState | null;
  expandAll: (dirPaths: Set<string>, excludePaths?: Set<string>) => void;
  collapseAll: () => void;
  // Collapse state is owned by the parent FilesPanel so it survives switching
  // tabs (this component otherwise unmounts on tab switch).
  needsReviewOpen: boolean;
  setNeedsReviewOpen: (open: boolean) => void;
  savedForLaterOpen: boolean;
  setSavedForLaterOpen: (open: boolean) => void;
  reviewedOpen: boolean;
  setReviewedOpen: (open: boolean) => void;
  trustOpen: boolean;
  setTrustOpen: (open: boolean) => void;
}

/**
 * The "Review" tab inside the FilesPanel: four collapsible sections
 * (Reviewed, Needs Review, Saved for Later, Trust) plus the review notes,
 * comments, action bar, and the filename quick-action modal.
 *
 * Owns its own collapse, modal, and quick-action derivation state. All
 * heavy file-tree data is computed once in the parent and passed down so
 * we don't re-do the work for every tab switch.
 */
export function ReviewTabContent({
  sectionedFiles,
  flatSectionedFiles,
  stats,
  renamedDirPaths,
  hunks,
  reviewState,
  expandAll,
  collapseAll,
  needsReviewOpen,
  setNeedsReviewOpen,
  savedForLaterOpen,
  setSavedForLaterOpen,
  reviewedOpen,
  setReviewedOpen,
  trustOpen,
  setTrustOpen,
}: ReviewTabContentProps) {
  const [filenameModalOpen, setFilenameModalOpen] = useState(false);
  const [filenameModalMode, setFilenameModalMode] = useState<
    "approve" | "unapprove"
  >("approve");

  const files = useReviewStore((s) => s.files);
  const changesDisplayMode = useReviewStore((s) => s.changesDisplayMode);
  const setChangesDisplayMode = useReviewStore((s) => s.setChangesDisplayMode);
  const fileSortOrder = useReviewStore((s) => s.fileSortOrder);
  const setFileSortOrder = useReviewStore((s) => s.setFileSortOrder);

  // Load symbols when switching to flat mode (flat view annotates rows with
  // changed-symbol counts pulled from the symbol diff cache).
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);
  const anyFlatMode = changesDisplayMode === "flat";
  useEffect(() => {
    if (anyFlatMode && !symbolsLoaded && !symbolsLoading && files.length > 0) {
      loadSymbols();
    }
  }, [anyFlatMode, symbolsLoaded, symbolsLoading, files.length, loadSymbols]);

  const { guideActive } = useGuideGroupState();
  const startGuide = useReviewStore((s) => s.startGuide);
  const exitGuide = useReviewStore((s) => s.exitGuide);
  const generateGrouping = useReviewStore((s) => s.generateGrouping);
  const clearGrouping = useReviewStore((s) => s.clearGrouping);
  const groupingLoading = useReviewStore(
    (s) => s.getActiveGroupingEntry().groupingLoading,
  );

  const {
    pending: pendingHunkIds,
    reviewed: reviewedHunkIds,
    savedForLater: savedForLaterHunkIds,
  } = useHunkIdsByStatus();

  const handleApproveAllHunks = useCallback(() => {
    if (pendingHunkIds.length > 0)
      useReviewStore.getState().approveHunkIds(pendingHunkIds);
  }, [pendingHunkIds]);

  const handleUnapproveAllHunks = useCallback(() => {
    if (reviewedHunkIds.length > 0)
      useReviewStore.getState().unapproveHunkIds(reviewedHunkIds);
  }, [reviewedHunkIds]);

  const handleUnsaveAll = useCallback(() => {
    if (savedForLaterHunkIds.length > 0)
      useReviewStore.getState().unapproveHunkIds(savedForLaterHunkIds);
  }, [savedForLaterHunkIds]);

  const openRollingDiff = useCallback((title: string, hunkIds: string[]) => {
    if (hunkIds.length === 0) return;
    useReviewStore.getState().openAdhocGroup({ title, hunkIds });
  }, []);

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
        if (hunkState?.status?.value === "approved") {
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
          onAction: () =>
            useReviewStore.getState().approveHunkIds(data.pendingIds),
        });
      }
    }
    // Opens a glob-driven modal (matches by pattern, not just literal dupes),
    // so it's offered whenever there are hunks to target.
    if (hunks.length > 0) {
      actions.push({
        label: "Approve by filename…",
        onAction: () => {
          setFilenameModalMode("approve");
          setFilenameModalOpen(true);
        },
      });
    }
    return actions;
  }, [quickActionData, hunks.length]);

  // Count of approved + trusted hunks (for "Stage approved" action)
  const approvedOrTrustedCount = useMemo(() => {
    return hunks.filter((h) => {
      const state = reviewState?.hunks[h.id];
      if (state?.status?.value === "approved") return true;
      if (reviewState && isHunkTrusted(state, reviewState.trustList))
        return true;
      return false;
    }).length;
  }, [hunks, reviewState]);

  const reviewedQuickActions = useMemo(() => {
    const actions: QuickActionItem[] = [];

    if (approvedOrTrustedCount > 0) {
      actions.push({
        label: "Stage approved",
        count: approvedOrTrustedCount,
        onAction: async () => {
          const byFile = new Map<string, string[]>();
          for (const h of hunks) {
            const state = reviewState?.hunks[h.id];
            const isApproved = state?.status?.value === "approved";
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
    if (approvedOrTrustedCount > 0) {
      actions.push({
        label: "Unapprove by filename…",
        onAction: () => {
          setFilenameModalMode("unapprove");
          setFilenameModalOpen(true);
        },
      });
    }
    return actions;
  }, [quickActionData, approvedOrTrustedCount, hunks, reviewState]);

  // Trust section
  const knownPatternIds = useKnownPatternIds();
  const { trustedHunkCount, trustableHunkCount } =
    useTrustCounts(knownPatternIds);
  const isClassificationStale = useReviewStore((s) => s.isClassificationStale);

  const unlabeledCount = useMemo(
    () =>
      hunks.filter((h) => {
        const state = reviewState?.hunks[h.id];
        return hunkLabels(state).length === 0;
      }).length,
    [hunks, reviewState?.hunks],
  );

  const matchedPatternIds = useMemo(() => {
    if (!knownPatternIds || knownPatternIds.size === 0)
      return new Set<string>();
    const matched = new Set<string>();
    for (const hunk of hunks) {
      const labels = hunkLabels(reviewState?.hunks[hunk.id]);
      for (const label of labels) {
        if (knownPatternIds.has(label)) matched.add(label);
      }
    }
    return matched;
  }, [hunks, reviewState?.hunks, knownPatternIds]);

  const trustQuickActions = useMemo(() => {
    const actions: QuickActionItem[] = [];

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

  // Sort menu items + view options shown in the per-section "view" menu
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
    [sortMenuItems, changesDisplayMode, setChangesDisplayMode],
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

  const hasChanges =
    sectionedFiles.needsReview.length > 0 ||
    sectionedFiles.savedForLater.length > 0 ||
    sectionedFiles.reviewed.length > 0 ||
    flatSectionedFiles.needsReview.length > 0 ||
    flatSectionedFiles.savedForLater.length > 0 ||
    flatSectionedFiles.reviewed.length > 0;

  if (!hasChanges) {
    return (
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
        <p className="text-sm font-medium text-fg-muted mb-1">No changes</p>
        <p className="text-xs text-fg-muted text-center max-w-[200px]">
          The base and compare refs are identical
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        <ReviewNotesPanel />

        <ReviewCommentsPanel />

        {/* Reviewed section */}
        <SectionHeader
          title="Reviewed"
          icon={REVIEWED_ICON}
          badge={stats.reviewed + stats.rejected}
          badgeColor="status-approved"
          isOpen={reviewedOpen}
          onToggle={() => setReviewedOpen(!reviewedOpen)}
          onUnapproveAll={
            reviewedHunkIds.length > 0 ? handleUnapproveAllHunks : undefined
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
          actionContent={
            reviewedHunkIds.length > 0 ? (
              <RollingDiffButton
                label="View as rolling diff"
                onClick={() => openRollingDiff("Reviewed", reviewedHunkIds)}
              />
            ) : undefined
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
          statusBadge={
            guideActive ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-guide/10 px-1.5 py-0.5 text-xxs font-medium text-guide">
                <svg
                  className="h-2.5 w-2.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
                Guided
              </span>
            ) : undefined
          }
          isOpen={needsReviewOpen}
          onToggle={() => setNeedsReviewOpen(!needsReviewOpen)}
          onApproveAll={
            pendingHunkIds.length > 0 ? handleApproveAllHunks : undefined
          }
          quickActions={guideActive ? undefined : needsReviewQuickActions}
          onExpandAll={
            !guideActive && changesDisplayMode === "tree"
              ? () => expandAll(needsReviewDirPaths, renamedDirPaths)
              : undefined
          }
          onCollapseAll={
            !guideActive && changesDisplayMode === "tree"
              ? collapseAll
              : undefined
          }
          actionContent={
            <>
              {!guideActive && pendingHunkIds.length > 0 && (
                <RollingDiffButton
                  label="View as rolling diff"
                  onClick={() =>
                    openRollingDiff("Needs Review", pendingHunkIds)
                  }
                />
              )}
              {guideActive ? (
                <button
                  type="button"
                  onClick={exitGuide}
                  className="flex items-center justify-center w-6 h-6 rounded
                             text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors"
                  aria-label="Exit guided review"
                >
                  <XIcon className="w-3.5 h-3.5" />
                </button>
              ) : pendingHunkIds.length >= 4 ? (
                <button
                  type="button"
                  onClick={() => startGuide()}
                  className="flex items-center justify-center w-6 h-6 rounded
                             text-guide hover:bg-guide/10 transition-colors"
                  aria-label="Start guided review"
                >
                  {GUIDE_ICON}
                </button>
              ) : null}
            </>
          }
          additionalMenuContent={
            guideActive ? (
              <>
                <DropdownMenuItem
                  onClick={() => generateGrouping()}
                  disabled={groupingLoading}
                >
                  Regenerate
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={clearGrouping}
                  disabled={groupingLoading}
                >
                  Clear grouping
                </DropdownMenuItem>
              </>
            ) : undefined
          }
        >
          {guideActive ? (
            <GuideGroupList />
          ) : (
            <FileListSection
              treeEntries={sectionedFiles.needsReview}
              flatFilePaths={flatSectionedFiles.needsReview}
              displayMode={changesDisplayMode}
              hunkContext="needs-review"
              emptyIcon={CHECK_ICON}
              emptyMessage="No files need review"
            />
          )}
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
              savedForLaterHunkIds.length > 0 ? handleUnsaveAll : undefined
            }
            unapproveAllLabel="Unsave all"
            onExpandAll={
              changesDisplayMode === "tree"
                ? () => expandAll(savedForLaterDirPaths, renamedDirPaths)
                : undefined
            }
            onCollapseAll={
              changesDisplayMode === "tree" ? collapseAll : undefined
            }
            actionContent={
              savedForLaterHunkIds.length > 0 ? (
                <RollingDiffButton
                  label="View as rolling diff"
                  onClick={() =>
                    openRollingDiff("Saved for Later", savedForLaterHunkIds)
                  }
                />
              ) : undefined
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
      <ReviewActionBar />

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
    </>
  );
}
