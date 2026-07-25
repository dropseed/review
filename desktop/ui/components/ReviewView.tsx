import {
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../stores";
import { getMissingRefs } from "../stores/slices/groupingSlice";
import { getPlatformServices } from "../platform";
import { getApiClient } from "../api";
import type { ReviewTarget } from "../types";
import {
  useSidebarResize,
  useMenuEvents,
  useFileWatcher,
  useKeyboardNavigation,
  useMouseNavigation,
  useReviewProgress,
  useCelebration,
  useLspClient,
  useDeepLinkFocus,
  useScopeReconciliation,
  useTerminalEvents,
} from "../hooks";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { FilesPanel } from "./FilesPanel";
import { ContentArea } from "./ContentArea";
import { ResizeHandle } from "./ContentArea/ResizeHandle";
import { TerminalPanel } from "./Terminal/TerminalPanel";
import { ReviewBreadcrumb, ReviewTitle } from "./ReviewBreadcrumb";
import { SimpleTooltip } from "./ui/tooltip";
import { CircleProgress } from "./ui/circle-progress";
import { WarningIcon, TerminalIcon } from "./ui/icons";
import { ActivityBar } from "./ActivityBar";
import { SidebarResizeHandle } from "./ui/sidebar-resize-handle";
import { CompareRefDeletedNotice } from "./CompareRefDeletedNotice";

const DebugModal = lazy(() =>
  import("./modals/DebugModal").then((m) => ({ default: m.DebugModal })),
);
const FileFinder = lazy(() =>
  import("./search/FileFinder").then((m) => ({ default: m.FileFinder })),
);
const ContentSearch = lazy(() =>
  import("./search/ContentSearch").then((m) => ({ default: m.ContentSearch })),
);
const SymbolSearch = lazy(() =>
  import("./search/SymbolSearch").then((m) => ({ default: m.SymbolSearch })),
);
const ClassificationsModal = lazy(() =>
  import("./modals/ClassificationsModal").then((m) => ({
    default: m.ClassificationsModal,
  })),
);

interface ReviewViewProps {
  onNewWindow: () => Promise<void>;
  comparisonReady: number;
  onStartReview?: (path: string, target: ReviewTarget) => Promise<void>;
}

export function ReviewView({
  onNewWindow,
  comparisonReady,
  onStartReview,
}: ReviewViewProps): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const reviewBaseOverride = useReviewStore((s) => s.reviewBaseOverride);
  const remoteInfo = useReviewStore((s) => s.remoteInfo);
  const classificationsModalOpen = useReviewStore(
    (s) => s.classificationsModalOpen,
  );

  const contentSearchOpen = useReviewStore((s) => s.contentSearchOpen);
  const setContentSearchOpen = useReviewStore((s) => s.setContentSearchOpen);

  // A comparison whose base or compare branch was deleted resolves to git's
  // empty tree, so the diff would otherwise render every file as a deletion.
  // The freshness check (which also drives the sidebar warning) records the
  // missing refs; surface them here instead of the bogus all-deleted diff.
  const reviewMissingRefs = useReviewStore((s) => s.reviewMissingRefs);
  const missingRefs = useMemo(
    () => getMissingRefs(reviewMissingRefs, repoPath, reviewRef),
    [reviewMissingRefs, repoPath, reviewRef],
  );
  const compareRefMissing = missingRefs.length > 0;

  // When this comparison's missing refs return (branch restored or fetched),
  // the file list in the store is still the stale all-deleted diff. Reload so
  // the recovered view shows the real diff rather than the leftover deletions.
  // Tracking the comparison key alongside the flag keeps this scoped to "the
  // same review recovered" — switching to a healthy review also clears the
  // flag, but that review's diff is already being loaded by the comparison
  // loader, so refreshing there would just be redundant work.
  const comparisonKey = comparison?.key ?? null;
  const prevCompareRefState = useRef({ missing: false, key: comparisonKey });
  useEffect(() => {
    const prev = prevCompareRefState.current;
    prevCompareRefState.current = {
      missing: compareRefMissing,
      key: comparisonKey,
    };
    if (!prev.missing || compareRefMissing || prev.key !== comparisonKey)
      return;
    // Only a genuine recovery (the branch returned for a review we're still
    // viewing) should reload. Deleting the review also clears its missing-refs
    // flag, but it nulls activeReviewKey in the same update — refreshing there
    // would reload (and re-create) the review we just removed.
    const { activeReviewKey, repoPath: activeRepo } = useReviewStore.getState();
    const stillActive =
      activeReviewKey?.repoPath === activeRepo &&
      activeReviewKey?.ref === reviewRef;
    if (stillActive) {
      useReviewStore.getState().refresh();
    }
  }, [compareRefMissing, comparisonKey, reviewRef]);

  // Read-only preview mode
  const readOnlyPreview = useReviewStore((s) => s.readOnlyPreview);
  const worktreeStale = useReviewStore((s) => s.worktreeStale);
  const worktreePath = useReviewStore((s) => s.worktreePath);
  const localActivity = useReviewStore((s) => s.localActivity);
  const isOnCurrentBranch = useMemo(() => {
    if (!repoPath || !comparison) return false;
    const repo = localActivity.find((r) => r.repoPath === repoPath);
    return (
      repo?.branches.find((b) => b.name === comparison.head)?.isCurrent ?? false
    );
  }, [localActivity, repoPath, comparison]);
  const updateWorktreeAction = useCallback(async () => {
    if (!repoPath || !comparison || !worktreePath) return;
    const client = getApiClient();
    const newSha = await client.resolveRef(repoPath, comparison.head);
    await client.updateWorktreeHead(repoPath, worktreePath, newSha);
    useReviewStore.getState().setWorktreeStale(false);
    const { loadFiles, loadAllFiles, syncTotalDiffHunks, classifyStaticHunks } =
      useReviewStore.getState();
    await Promise.all([loadFiles(), loadAllFiles()]);
    syncTotalDiffHunks();
    classifyStaticHunks();
  }, [repoPath, comparison, worktreePath]);
  const [handleUpdateWorktree, updatingWorktree] = useAsyncAction(
    updateWorktreeAction,
    "update worktree",
  );

  const startReviewAction = useCallback(async () => {
    if (!repoPath || !reviewRef || !onStartReview) return;
    await onStartReview(repoPath, {
      ref: reviewRef,
      baseOverride: reviewBaseOverride ?? undefined,
    });
  }, [repoPath, reviewRef, reviewBaseOverride, onStartReview]);
  const [handleStartReviewClick, startingReview] = useAsyncAction(
    startReviewAction,
    "start review",
  );

  const checkoutWorktree = useReviewStore((s) => s.checkoutWorktree);
  const checkoutAction = useCallback(async () => {
    if (!repoPath || !comparison) return;
    await checkoutWorktree(repoPath, comparison);
  }, [repoPath, comparison, checkoutWorktree]);
  const [handleCheckoutClick, checkingOut] = useAsyncAction(
    checkoutAction,
    "checkout worktree",
  );

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        useReviewStore.getState().refresh(),
        useReviewStore.getState().loadLocalActivity(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

  // Close handler: cascading close (split -> file -> window)
  const handleClose = useCallback(async () => {
    const state = useReviewStore.getState();
    if (state.secondaryFile !== null) {
      state.closeSplit();
    } else if (state.selectedFile !== null) {
      useReviewStore.setState({ selectedFile: null });
    } else {
      const platform = getPlatformServices();
      await platform.window.close();
    }
  }, []);

  // New tab handler: open a new tab with the current repo
  const handleNewTab = useCallback(async () => {
    const apiClient = getApiClient();
    try {
      await apiClient.openRepoWindow(repoPath || "");
    } catch (err) {
      console.error("Failed to open new tab:", err);
    }
  }, [repoPath]);

  // Navigate to a hunk from the classifications modal
  const handleClassificationSelectHunk = useCallback(
    (filePath: string, hunkId: string) => {
      useReviewStore.getState().setClassificationsModalOpen(false);
      useReviewStore.getState().navigateToBrowse(filePath, { hunkId });
      useReviewStore.setState({
        scrollTarget: { type: "hunk", hunkId },
      });
    },
    [],
  );

  const { sidebarWidth, handleResizeStart } = useSidebarResize({
    sidebarPosition: "right",
  });

  useKeyboardNavigation();
  useMouseNavigation();
  // Hold deep-link focus until the diff is real again — consuming it against the
  // all-deleted diff behind the notice would drop the requested hunk.
  useDeepLinkFocus(!compareRefMissing);

  useMenuEvents({
    handleClose,
    handleNewTab,
    handleNewWindow: onNewWindow,
    handleRefresh,
    setShowDebugModal,
    setShowFileFinder,
    setShowContentSearch: setContentSearchOpen,
    setShowSymbolSearch,
    // No diff to search while the compared branch is gone.
    searchEnabled: !compareRefMissing,
  });

  useFileWatcher(comparisonReady);
  useLspClient();
  useScopeReconciliation();
  useTerminalEvents();

  // Terminal panel: left vertical pane inside the content region, sized via the
  // horizontal ResizeHandle and persisted in the store.
  const terminalPanelMode = useReviewStore((s) => s.terminalPanelMode);
  const terminalsSupported = useReviewStore((s) => s.terminalsSupported);
  const terminalPanelWidth = useReviewStore((s) => s.terminalPanelWidth);
  const setTerminalPanelWidth = useReviewStore((s) => s.setTerminalPanelWidth);
  const terminalDockSide = useReviewStore((s) => s.terminalDockSide);
  const toggleTerminalPanel = useReviewStore((s) => s.toggleTerminalPanel);
  const toggleTerminalPanelMaximized = useReviewStore(
    (s) => s.toggleTerminalPanelMaximized,
  );
  const contentRowRef = useRef<HTMLDivElement | null>(null);
  const panelMode = terminalsSupported ? terminalPanelMode : "closed";
  const showTerminalPanel = panelMode !== "closed";

  // ResizeHandle reports a fraction of the content row from its left edge. The
  // width is always the terminal pane's own width, measured from whichever side
  // it's docked on — so a right dock measures from the right edge (1 - fraction).
  const handleTerminalResize = useCallback(
    (fraction: number) => {
      const rowWidth = contentRowRef.current?.clientWidth ?? 0;
      if (rowWidth === 0) return;
      const sideFraction =
        terminalDockSide === "right" ? 1 - fraction : fraction;
      setTerminalPanelWidth(Math.round(sideFraction * rowWidth));
    },
    [setTerminalPanelWidth, terminalDockSide],
  );

  // Cmd+` toggles the panel, Cmd+Shift+Enter collapses/restores the diff beside
  // it (iTerm2's maximize-pane chord). Both work regardless of where focus is —
  // Cmd combos aren't forwarded to the PTY.
  useEffect(() => {
    if (!terminalsSupported) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.code === "Backquote") {
        e.preventDefault();
        toggleTerminalPanel();
      } else if (e.shiftKey && e.code === "Enter") {
        e.preventDefault();
        toggleTerminalPanelMaximized();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [terminalsSupported, toggleTerminalPanel, toggleTerminalPanelMaximized]);

  // Review progress
  const {
    totalHunks,
    trustedHunks,
    approvedHunks,
    rejectedHunks,
    reviewedHunks,
  } = useReviewProgress();

  // Celebration on 100% reviewed — suppressed when the compared branch is gone
  // so confetti can't fire over the bogus all-deleted diff behind the notice.
  useCelebration(!compareRefMissing);

  // The header doubles as the window's title bar on macOS; when the sidebar is
  // collapsed it also has to clear the traffic lights.
  const tabRailCollapsed = useReviewStore((s) => s.tabRailCollapsed);

  const repoName =
    remoteInfo?.name ||
    repoPath?.replace(/\/+$/, "").split("/").pop() ||
    "repo";

  return (
    <div className="flex h-full flex-row bg-surface">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header — drawn inside the macOS title bar strip, so it costs no
            vertical space of its own. Draggable except over its controls. */}
        <header
          data-tauri-drag-region
          className={`@container relative flex shrink-0 items-center gap-3 py-1 pr-3
                      min-h-[var(--title-bar-height)] ${
                        // With the sidebar collapsed there's nothing else to
                        // keep the header clear of the traffic lights.
                        tabRailCollapsed
                          ? "pl-[max(0.75rem,var(--traffic-light-inset))]"
                          : "pl-3"
                      }`}
        >
          {/* Left: repo / comparison ref, then the PR title if there is one */}
          <div
            className="flex min-w-0 flex-1 items-center gap-2"
            data-tauri-drag-region
          >
            <ReviewBreadcrumb repoName={repoName} comparison={comparison} />
            {!compareRefMissing && <ReviewTitle />}
          </div>

          {/* Center: activity island (floating) */}
          {comparison && !compareRefMissing && <ActivityBar />}

          {/* Right: terminal toggle + review progress */}
          <div className="flex shrink-0 items-center gap-2">
            {terminalsSupported && (
              <SimpleTooltip content="Toggle terminal (⌘`)" side="bottom">
                <button
                  type="button"
                  onClick={toggleTerminalPanel}
                  aria-label="Toggle terminal panel"
                  aria-pressed={showTerminalPanel}
                  className={`p-1.5 rounded transition-colors duration-100 hover:bg-fg/[0.06] ${
                    showTerminalPanel
                      ? "text-fg-secondary"
                      : "text-fg-faint hover:text-fg-muted"
                  }`}
                >
                  <TerminalIcon className="h-4 w-4" />
                </button>
              </SimpleTooltip>
            )}
            {comparison && !readOnlyPreview && !compareRefMissing && (
              <div className="flex shrink-0 items-center gap-3">
                {totalHunks > 0 ? (
                  <button
                    type="button"
                    onClick={() => {
                      useReviewStore.setState({
                        selectedFile: null,
                        guideContentMode: null,
                      });
                    }}
                    className="flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-md
                             hover:bg-fg/[0.06] transition-colors duration-100 cursor-default"
                  >
                    <span className="font-mono text-xs tabular-nums text-fg-muted">
                      {reviewedHunks}/{totalHunks}
                    </span>
                    <SimpleTooltip
                      content={
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-status-trusted" />
                            <span>Trusted: {trustedHunks}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="w-2 h-2 rounded-full bg-status-approved" />
                            <span>Approved: {approvedHunks}</span>
                          </div>
                          {rejectedHunks > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="w-2 h-2 rounded-full bg-status-rejected" />
                              <span>Rejected: {rejectedHunks}</span>
                            </div>
                          )}
                        </div>
                      }
                    >
                      <CircleProgress
                        percent={
                          totalHunks > 0
                            ? Math.round((reviewedHunks / totalHunks) * 100)
                            : 0
                        }
                        size={20}
                        strokeWidth={2.5}
                        className="shrink-0 cursor-default"
                        segments={[
                          {
                            percent:
                              totalHunks > 0
                                ? (trustedHunks / totalHunks) * 100
                                : 0,
                            color: "var(--color-status-trusted)",
                          },
                          {
                            percent:
                              totalHunks > 0
                                ? (approvedHunks / totalHunks) * 100
                                : 0,
                            color: "var(--color-status-approved)",
                          },
                          {
                            percent:
                              totalHunks > 0
                                ? (rejectedHunks / totalHunks) * 100
                                : 0,
                            color: "var(--color-status-rejected)",
                          },
                        ]}
                      />
                    </SimpleTooltip>
                  </button>
                ) : null}
              </div>
            )}
          </div>
        </header>

        {/* Status banners — hidden while the deleted-ref notice is shown */}
        {!compareRefMissing && (
          <>
            {/* Read-only preview banner */}
            {readOnlyPreview && (
              <div className="flex items-center justify-between gap-3 border-b border-edge bg-surface-raised/50 px-4 py-2">
                <span className="text-xs text-fg-muted">
                  Read-only preview — approvals are disabled
                </span>
                {onStartReview && (
                  <button
                    type="button"
                    onClick={handleStartReviewClick}
                    disabled={startingReview}
                    className="shrink-0 rounded-lg bg-sage-500 px-3 py-1.5 text-xs font-semibold text-surface
                         hover:bg-sage-400 transition-colors duration-150
                         disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {startingReview ? "Starting..." : "Start Review"}
                  </button>
                )}
              </div>
            )}

            {/* Stale worktree indicator */}
            {worktreeStale && worktreePath && !readOnlyPreview && (
              <div className="flex items-center gap-2 border-b border-edge bg-amber-500/5 px-4 py-1.5">
                <WarningIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="text-xs text-fg-muted flex-1">
                  Worktree is behind branch tip — review may not reflect latest
                  changes
                </span>
                <button
                  type="button"
                  onClick={handleUpdateWorktree}
                  disabled={updatingWorktree}
                  className="text-xs font-medium text-amber-600 hover:text-amber-500
                         disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {updatingWorktree ? "Updating..." : "Update"}
                </button>
              </div>
            )}

            {/* Checkout prompt — shown for reviews without a worktree.
            Skipped when on the current branch, since the main working tree
            already matches the branch being reviewed (LSP works correctly). */}
            {!readOnlyPreview && !worktreePath && !isOnCurrentBranch && (
              <div className="flex items-center gap-2 border-b border-edge px-4 py-1.5">
                <span className="text-xs text-fg-faint flex-1">
                  Check out to enable LSP features (hover, go-to-definition)
                </span>
                <button
                  type="button"
                  onClick={handleCheckoutClick}
                  disabled={checkingOut}
                  className="text-xs font-medium text-fg-muted hover:text-fg-secondary
                         disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {checkingOut ? "Checking out..." : "Check out"}
                </button>
              </div>
            )}
          </>
        )}

        {/* Content region — a resizable terminal pane docked left or right of
            the diff; docking side is persisted and swappable. The deleted-ref
            notice replaces the diff when the compared branch no longer exists. */}
        <main
          ref={contentRowRef}
          className="relative flex flex-1 flex-row overflow-hidden bg-surface"
        >
          {(() => {
            const dockLeft = showTerminalPanel && terminalDockSide === "left";
            const dockRight = showTerminalPanel && terminalDockSide === "right";
            const maximized = panelMode === "maximized";
            const terminalPane = (
              <div
                className={`overflow-hidden p-2 ${
                  maximized ? "min-w-0 flex-1" : "shrink-0"
                }`}
                style={maximized ? undefined : { width: terminalPanelWidth }}
              >
                <TerminalPanel />
              </div>
            );
            // Maximized: the terminal is the whole content region.
            if (maximized) return terminalPane;

            const terminalResize = (
              <ResizeHandle
                orientation="horizontal"
                onResize={handleTerminalResize}
              />
            );
            // The diff sits in the same rounded, raised card as a terminal
            // pane. The padding on the side facing the terminal is dropped so
            // the two cards share one gutter instead of stacking two.
            const diffPane = (
              <div
                className={`relative flex min-w-0 flex-1 flex-col overflow-hidden p-2 ${
                  dockLeft ? "pl-0" : ""
                } ${dockRight ? "pr-0" : ""}`}
              >
                <div className="panel-card relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
                  {compareRefMissing ? (
                    <CompareRefDeletedNotice
                      repoPath={repoPath!}
                      comparison={comparison!}
                      missingRefs={missingRefs}
                    />
                  ) : (
                    <ContentArea />
                  )}
                </div>
              </div>
            );
            return (
              <>
                {dockLeft && (
                  <>
                    {terminalPane}
                    {terminalResize}
                  </>
                )}
                {diffPane}
                {dockRight && (
                  <>
                    {terminalResize}
                    {terminalPane}
                  </>
                )}
              </>
            );
          })()}
        </main>
      </div>

      {/* FilesPanel (right side) — hidden when the compared branch is gone,
          since its file list would otherwise show every file as deleted. */}
      {!compareRefMissing && (
        <aside
          className="relative flex flex-shrink-0 flex-col overflow-hidden"
          style={{ width: `${sidebarWidth}rem` }}
        >
          <div
            className="flex flex-col flex-1 overflow-hidden bg-surface border-l border-edge"
            style={{ width: `${sidebarWidth}rem` }}
          >
            <div className="flex-1 overflow-hidden">
              <FilesPanel />
            </div>

            <SidebarResizeHandle
              position="left"
              onMouseDown={handleResizeStart}
            />
          </div>
        </aside>
      )}

      {/* Debug Modal */}
      {showDebugModal && (
        <Suspense fallback={null}>
          <DebugModal
            isOpen={showDebugModal}
            onClose={() => setShowDebugModal(false)}
          />
        </Suspense>
      )}

      {/* File Finder */}
      {showFileFinder && (
        <Suspense fallback={null}>
          <FileFinder
            isOpen={showFileFinder}
            onClose={() => setShowFileFinder(false)}
          />
        </Suspense>
      )}

      {/* Content Search */}
      {contentSearchOpen && (
        <Suspense fallback={null}>
          <ContentSearch
            isOpen={contentSearchOpen}
            onClose={() => setContentSearchOpen(false)}
          />
        </Suspense>
      )}

      {/* Symbol Search */}
      {showSymbolSearch && (
        <Suspense fallback={null}>
          <SymbolSearch
            isOpen={showSymbolSearch}
            onClose={() => setShowSymbolSearch(false)}
          />
        </Suspense>
      )}

      {/* Classifications Modal */}
      {classificationsModalOpen && (
        <Suspense fallback={null}>
          <ClassificationsModal
            isOpen={classificationsModalOpen}
            onClose={() =>
              useReviewStore.getState().setClassificationsModalOpen(false)
            }
            onSelectHunk={handleClassificationSelectHunk}
          />
        </Suspense>
      )}
    </div>
  );
}
