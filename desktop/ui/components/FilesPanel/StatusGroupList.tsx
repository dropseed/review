import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSpurStore } from "../../stores";
import { flattenFilesWithStatus } from "../../stores/types";
import { useHunkIdsByStatus } from "../../stores/selectors/hunks";
import { useTrustCounts, useKnownPatternIds } from "../../hooks/useTrustCounts";
import {
  isHunkTrusted,
  hunkLabels,
  type DiffHunk,
  type ReviewState,
  EMPTY_TRUST_LIST,
} from "../../types";
import { DropdownMenuItem, DropdownMenuSeparator } from "../ui/dropdown-menu";
import { RollingDiffButton } from "../ui/rolling-diff-button";
import { GroupHeader } from "./GroupHeader";
import { TrustSection } from "../GuideView/TrustSection";
import { FileListSection, CHECK_ICON } from "./FileListSection";
import { FileSelectionProvider } from "./FilesPanelContext";
import { FilenameModal } from "./FilenameModal";
import { SortMenuItems, SELECTED_CHECK } from "./PanelToolbar";
import type { ProcessedFileEntry } from "./types";
import { collectDirPaths } from "./FileTree.utils";

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

const APPROVE_ICON = (
  <svg
    className="h-3.5 w-3.5"
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
    strokeWidth={2.5}
  >
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const UNDO_ICON = (
  <svg
    className="h-3.5 w-3.5"
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
);

const matchesFilter = (entry: ProcessedFileEntry): boolean =>
  entry.matchesFilter;

interface QuickActionItem {
  label: string;
  count?: number;
  onAction: () => void;
}

function quickActionMenuItems(actions: QuickActionItem[]): ReactNode {
  return actions.map((qa) => (
    <DropdownMenuItem key={qa.label} onClick={qa.onAction}>
      <span className="flex-1">{qa.label}</span>
      {qa.count !== undefined && (
        <span className="ml-2 text-xxs tabular-nums text-fg-muted">
          {qa.count}
        </span>
      )}
    </DropdownMenuItem>
  ));
}

interface SectionedFilesGroup {
  needsReview: ProcessedFileEntry[];
  savedForLater: ProcessedFileEntry[];
  reviewed: ProcessedFileEntry[];
  trusted: ProcessedFileEntry[];
}

interface FlatSectionedFilesGroup {
  needsReview: string[];
  savedForLater: string[];
  reviewed: string[];
  trusted: string[];
}

interface ReviewStats {
  pending: number;
  approved: number;
  trusted: number;
  total: number;
  rejected: number;
  savedForLater: number;
  needsReviewFiles: number;
  reviewedFiles: number;
}

export interface StatusGroupListProps {
  sectionedFiles: SectionedFilesGroup;
  flatSectionedFiles: FlatSectionedFilesGroup;
  stats: ReviewStats;
  renamedDirPaths: Set<string>;
  hunks: DiffHunk[];
  reviewState: ReviewState | null;
  /**
   * Show one list of what changed instead of the four status groups.
   *
   * A commit being looked at has no review: no decisions recorded and none
   * that can be made. The status groups would be four promises this screen
   * cannot keep — "Reviewed 0 · No files reviewed yet" over a diff nothing can
   * be approved in. With no review state every hunk buckets as pending, so
   * this is the same rows the needs-review section already holds; what changes
   * is that they stop being called a queue.
   */
  changedOnly?: boolean;
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
 * The Review tab's default "Status" grouping: four groups bucketed by
 * effective review status (Trusted, Reviewed, Needs Review, Saved for
 * Later), each rendered on the shared group-header contract. A peer of the
 * Commits and Guide groupings — see FilesPanel/index.tsx.
 *
 * `changedOnly` collapses all four into one list of what changed, for a
 * comparison that has no review attached.
 */
export function StatusGroupList({
  sectionedFiles,
  flatSectionedFiles,
  stats,
  renamedDirPaths,
  hunks,
  reviewState,
  changedOnly = false,
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
}: StatusGroupListProps) {
  const [filenameModalOpen, setFilenameModalOpen] = useState(false);
  const [filenameModalMode, setFilenameModalMode] = useState<
    "approve" | "unapprove"
  >("approve");

  const files = useSpurStore((s) => s.files);
  const changesDisplayMode = useSpurStore((s) => s.changesDisplayMode);
  const setChangesDisplayMode = useSpurStore((s) => s.setChangesDisplayMode);

  // Load symbols when switching to flat mode (flat view annotates rows with
  // changed-symbol counts pulled from the symbol diff cache).
  const symbolsLoading = useSpurStore((s) => s.symbolsLoading);
  const symbolsLoaded = useSpurStore((s) => s.symbolsLoaded);
  const loadSymbols = useSpurStore((s) => s.loadSymbols);
  const anyFlatMode = changesDisplayMode === "flat";
  useEffect(() => {
    if (anyFlatMode && !symbolsLoaded && !symbolsLoading && files.length > 0) {
      loadSymbols();
    }
  }, [anyFlatMode, symbolsLoaded, symbolsLoading, files.length, loadSymbols]);

  const {
    pending: pendingHunkIds,
    reviewed: reviewedHunkIds,
    savedForLater: savedForLaterHunkIds,
    trusted: trustedHunkIds,
  } = useHunkIdsByStatus();

  const handleApproveAllHunks = useCallback(() => {
    if (pendingHunkIds.length > 0)
      useSpurStore.getState().approveHunkIds(pendingHunkIds);
  }, [pendingHunkIds]);

  const handleUnapproveAllHunks = useCallback(() => {
    if (reviewedHunkIds.length > 0)
      useSpurStore.getState().unapproveHunkIds(reviewedHunkIds);
  }, [reviewedHunkIds]);

  const handleUnsaveAll = useCallback(() => {
    if (savedForLaterHunkIds.length > 0)
      useSpurStore.getState().unapproveHunkIds(savedForLaterHunkIds);
  }, [savedForLaterHunkIds]);

  const openRollingDiff = useCallback((title: string, hunkIds: string[]) => {
    if (hunkIds.length === 0) return;
    useSpurStore.getState().openAdhocGroup({ title, hunkIds });
  }, []);

  // One rule for all four headers: the button stays visible with nothing to
  // show, disabled, so the header row is stable while a section drains.
  const rollingDiffAction = (title: string, hunkIds: string[]): ReactNode => (
    <RollingDiffButton
      onClick={() => openRollingDiff(title, hunkIds)}
      disabled={hunkIds.length === 0}
    />
  );

  // The expand/collapse pair every section's menu carries in tree mode, or
  // null in flat mode — callers use the null to skip separators and menus
  // that would otherwise render empty.
  const expandCollapseItems = (dirPaths: Set<string>): ReactNode =>
    changesDisplayMode === "tree" ? (
      <>
        <DropdownMenuItem onClick={() => expandAll(dirPaths, renamedDirPaths)}>
          Expand all
        </DropdownMenuItem>
        <DropdownMenuItem onClick={collapseAll}>Collapse all</DropdownMenuItem>
      </>
    ) : null;

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
            useSpurStore.getState().approveHunkIds(data.pendingIds),
        });
      }
    }
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
          const s = useSpurStore.getState();
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
            useSpurStore.getState().unapproveHunkIds(data.approvedIds),
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
  const { trustableHunkCount } = useTrustCounts(knownPatternIds);
  const isClassificationStale = useSpurStore((s) => s.isClassificationStale);

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

    const currentTrustList = reviewState?.trustList ?? EMPTY_TRUST_LIST;
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
          onAction: () => useSpurStore.getState().setTrustList([]),
        });
      } else {
        actions.push({
          label: "Trust all",
          count: matchedArray.length,
          onAction: () => {
            const merged = new Set([...currentTrustList, ...matchedArray]);
            useSpurStore.getState().setTrustList([...merged]);
          },
        });
      }
    }

    const stale = isClassificationStale();
    if (stale) {
      actions.push({
        label: "Reclassify (stale)",
        count: hunks.length,
        onAction: () => useSpurStore.getState().classifyStaticHunks(),
      });
    } else if (unlabeledCount > 0) {
      actions.push({
        label: "Classify unclassified",
        count: unlabeledCount,
        onAction: () => useSpurStore.getState().classifyStaticHunks(),
      });
    } else if (hunks.length > 0) {
      actions.push({
        label: "Reclassify all",
        count: hunks.length,
        onAction: () => useSpurStore.getState().reclassifyHunks(),
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

  const viewOptionsMenuContent = useMemo(
    () => (
      <>
        <SortMenuItems />
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
    [changesDisplayMode, setChangesDisplayMode],
  );

  // Per-section dir paths for expand/collapse (only needed in tree mode)
  const needsReviewDirPaths = useMemo(
    () => collectDirPaths(sectionedFiles.needsReview, matchesFilter),
    [sectionedFiles.needsReview],
  );
  const savedForLaterDirPaths = useMemo(
    () => collectDirPaths(sectionedFiles.savedForLater, matchesFilter),
    [sectionedFiles.savedForLater],
  );
  const reviewedDirPaths = useMemo(
    () => collectDirPaths(sectionedFiles.reviewed, matchesFilter),
    [sectionedFiles.reviewed],
  );
  const trustedDirPaths = useMemo(
    () => collectDirPaths(sectionedFiles.trusted, matchesFilter),
    [sectionedFiles.trusted],
  );

  const allChangesDirPaths = useMemo(() => {
    const combined = new Set<string>();
    for (const p of needsReviewDirPaths) combined.add(p);
    for (const p of savedForLaterDirPaths) combined.add(p);
    for (const p of reviewedDirPaths) combined.add(p);
    for (const p of trustedDirPaths) combined.add(p);
    return combined;
  }, [
    needsReviewDirPaths,
    savedForLaterDirPaths,
    reviewedDirPaths,
    trustedDirPaths,
  ]);

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

  const hasTrustedFiles =
    sectionedFiles.trusted.length > 0 || flatSectionedFiles.trusted.length > 0;

  const hasChanges =
    sectionedFiles.needsReview.length > 0 ||
    sectionedFiles.savedForLater.length > 0 ||
    sectionedFiles.reviewed.length > 0 ||
    flatSectionedFiles.needsReview.length > 0 ||
    flatSectionedFiles.savedForLater.length > 0 ||
    flatSectionedFiles.reviewed.length > 0 ||
    hasTrustedFiles;

  if (!hasChanges) {
    return (
      <div className="flex flex-1 items-center justify-center px-6">
        <div className="max-w-xs -translate-y-[8vh] text-center">
          <p className="text-sm text-fg-muted">No changes.</p>
          <p className="mt-2 text-sm text-fg-faint">
            The base and compare refs are identical.
          </p>
        </div>
      </div>
    );
  }

  if (changedOnly) {
    return (
      <FileSelectionProvider>
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {/* No status icon and no count pill: both are how a section says
              which state its hunks are in, and this one is not a state. The
              count rides in the title instead. */}
          <GroupHeader
            title={`Changed · ${stats.total}`}
            progress={{ done: 0, total: 0 }}
            isExpanded={needsReviewOpen}
            onToggleExpanded={() => setNeedsReviewOpen(!needsReviewOpen)}
            actionContent={rollingDiffAction("Changed", pendingHunkIds)}
            // What survives is what only affects reading: how the list is
            // sorted and shaped. Nothing here decides anything, which is the
            // whole reason the other menus are gone.
            menuContent={
              <>
                {expandCollapseItems(needsReviewDirPaths)}
                {changesDisplayMode === "tree" && <DropdownMenuSeparator />}
                {viewOptionsMenuContent}
              </>
            }
          >
            <FileListSection
              treeEntries={sectionedFiles.needsReview}
              flatFilePaths={flatSectionedFiles.needsReview}
              displayMode={changesDisplayMode}
              hunkContext="needs-review"
              emptyMessage="No files changed"
            />
          </GroupHeader>
        </div>
      </FileSelectionProvider>
    );
  }

  return (
    // Multi-select spans the status sections and nothing else: these four
    // lists are the run of rows a shift-click range is allowed to cross, and
    // the selection is meaningless once this panel unmounts.
    <FileSelectionProvider>
      <div className="flex-1 overflow-y-auto scrollbar-thin">
        {/* Trusted — auto-approved hunks, kept out of Reviewed so it stays
            re-reviewable. Shown whenever there are trusted files to list (which
            now live nowhere else) OR trustable patterns to manage. */}
        {(hasTrustedFiles || trustableHunkCount > 0) && (
          <GroupHeader
            leading={TRUST_ICON}
            title="Trusted"
            progress={{ done: stats.trusted, total: stats.trusted }}
            countTone="trusted"
            isExpanded={trustOpen}
            onToggleExpanded={() => setTrustOpen(!trustOpen)}
            actionContent={rollingDiffAction("Trusted", trustedHunkIds)}
            menuContent={
              <>
                {quickActionMenuItems(trustQuickActions)}
                {trustQuickActions.length > 0 && <DropdownMenuSeparator />}
                {hasTrustedFiles && (
                  <>
                    {expandCollapseItems(trustedDirPaths)}
                    {changesDisplayMode === "tree" && <DropdownMenuSeparator />}
                  </>
                )}
                <div className="max-h-[50vh] w-64 overflow-y-auto">
                  <div className="px-2 pb-1 pt-1.5 text-xxs font-medium uppercase tracking-wider text-fg-faint">
                    Trust patterns
                  </div>
                  <TrustSection />
                </div>
              </>
            }
          >
            <FileListSection
              treeEntries={sectionedFiles.trusted}
              flatFilePaths={flatSectionedFiles.trusted}
              displayMode={changesDisplayMode}
              hunkContext="trusted"
              emptyMessage="No trusted hunks"
            />
          </GroupHeader>
        )}

        {/* Reviewed */}
        <GroupHeader
          leading={REVIEWED_ICON}
          title="Reviewed"
          progress={{
            done: stats.approved + stats.rejected,
            total: stats.approved + stats.rejected,
          }}
          countTone="approved"
          isExpanded={reviewedOpen}
          onToggleExpanded={() => setReviewedOpen(!reviewedOpen)}
          quickAction={
            reviewedHunkIds.length > 0
              ? {
                  icon: UNDO_ICON,
                  label: "Unapprove all",
                  onClick: handleUnapproveAllHunks,
                }
              : undefined
          }
          // done===total by construction for this section (progress counts
          // everything reviewed as "done") — without this the hover action
          // never renders, since GroupHeader otherwise hides it once complete.
          showQuickActionWhenComplete
          actionContent={rollingDiffAction("Reviewed", reviewedHunkIds)}
          menuContent={
            <>
              {quickActionMenuItems(reviewedQuickActions)}
              {reviewedQuickActions.length > 0 && <DropdownMenuSeparator />}
              {expandCollapseItems(reviewedDirPaths)}
              {changesDisplayMode === "tree" && <DropdownMenuSeparator />}
              {viewOptionsMenuContent}
            </>
          }
        >
          <FileListSection
            treeEntries={sectionedFiles.reviewed}
            flatFilePaths={flatSectionedFiles.reviewed}
            displayMode={changesDisplayMode}
            hunkContext="reviewed"
            emptyMessage="No files reviewed yet"
          />
        </GroupHeader>

        {/* Needs Review */}
        <GroupHeader
          leading={NEEDS_REVIEW_ICON}
          title="Needs Review"
          progress={{ done: 0, total: stats.pending }}
          countTone="pending"
          isExpanded={needsReviewOpen}
          onToggleExpanded={() => setNeedsReviewOpen(!needsReviewOpen)}
          quickAction={
            pendingHunkIds.length > 0
              ? {
                  icon: APPROVE_ICON,
                  label: "Approve all",
                  onClick: handleApproveAllHunks,
                  tone: "approve",
                }
              : undefined
          }
          actionContent={rollingDiffAction("Needs Review", pendingHunkIds)}
          // With the rolling-diff item promoted to the header, flat mode can
          // leave this menu with nothing to say — pass nothing rather than
          // render a ⋯ that opens onto an empty dropdown.
          menuContent={
            needsReviewQuickActions.length > 0 ||
            changesDisplayMode === "tree" ? (
              <>
                {quickActionMenuItems(needsReviewQuickActions)}
                {needsReviewQuickActions.length > 0 &&
                  changesDisplayMode === "tree" && <DropdownMenuSeparator />}
                {expandCollapseItems(needsReviewDirPaths)}
              </>
            ) : undefined
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
        </GroupHeader>

        {/* Saved for Later */}
        {(sectionedFiles.savedForLater.length > 0 ||
          flatSectionedFiles.savedForLater.length > 0) && (
          <GroupHeader
            leading={SAVED_FOR_LATER_ICON}
            title="Saved for Later"
            progress={{ done: 0, total: stats.savedForLater }}
            countTone="saved"
            isExpanded={savedForLaterOpen}
            onToggleExpanded={() => setSavedForLaterOpen(!savedForLaterOpen)}
            quickAction={
              savedForLaterHunkIds.length > 0
                ? {
                    icon: UNDO_ICON,
                    label: "Unsave all",
                    onClick: handleUnsaveAll,
                  }
                : undefined
            }
            actionContent={rollingDiffAction(
              "Saved for Later",
              savedForLaterHunkIds,
            )}
            // Flat mode has no expand/collapse, and with the rolling-diff
            // item promoted to the header nothing else lives here — no menu
            // beats an empty one.
            menuContent={
              expandCollapseItems(savedForLaterDirPaths) ?? undefined
            }
          >
            <FileListSection
              treeEntries={sectionedFiles.savedForLater}
              flatFilePaths={flatSectionedFiles.savedForLater}
              displayMode={changesDisplayMode}
              hunkContext="needs-review"
              emptyMessage="No files saved for later"
            />
          </GroupHeader>
        )}
      </div>

      <FilenameModal
        open={filenameModalOpen}
        onOpenChange={setFilenameModalOpen}
        mode={filenameModalMode}
        hunks={hunks}
        hunkStates={reviewState?.hunks ?? {}}
        trustList={reviewState?.trustList ?? EMPTY_TRUST_LIST}
        onApproveAll={(ids) => useSpurStore.getState().approveHunkIds(ids)}
        onRejectAll={(ids) => useSpurStore.getState().rejectHunkIds(ids)}
        onUnapproveAll={(ids) => useSpurStore.getState().unapproveHunkIds(ids)}
        onNavigateToFile={(path) =>
          useSpurStore.getState().navigateToBrowse(path)
        }
      />
    </FileSelectionProvider>
  );
}
