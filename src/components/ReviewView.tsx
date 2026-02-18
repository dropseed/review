import {
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useReviewStore } from "../stores";
import { getPlatformServices } from "../platform";
import { getApiClient } from "../api";
import {
  useSidebarResize,
  useMenuEvents,
  useFileWatcher,
  useKeyboardNavigation,
  useReviewProgress,
  useCelebration,
} from "../hooks";
import { FilesPanel } from "./FilesPanel";
import { ContentArea } from "./ContentArea";
import { FeedbackPanel } from "./FeedbackPanel";
import { ReviewBreadcrumb, ReviewTitle } from "./ReviewBreadcrumb";
import { SimpleTooltip } from "./ui/tooltip";
import { CircleProgress } from "./ui/circle-progress";
import { ActivityBar } from "./ActivityBar";

const DebugModal = lazy(() =>
  import("./modals/DebugModal").then((m) => ({ default: m.DebugModal })),
);
const CommitDetailModal = lazy(() =>
  import("./modals/CommitDetailModal").then((m) => ({
    default: m.CommitDetailModal,
  })),
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
  comparisonReady: boolean;
}

export function ReviewView({
  onNewWindow,
  comparisonReady,
}: ReviewViewProps): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const hunks = useReviewStore((s) => s.hunks);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const setGuideContentMode = useReviewStore((s) => s.setGuideContentMode);
  const guideTitle = useReviewStore((s) => s.guideTitle);
  const remoteInfo = useReviewStore((s) => s.remoteInfo);
  const refresh = useReviewStore((s) => s.refresh);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const closeSplit = useReviewStore((s) => s.closeSplit);
  const classificationsModalOpen = useReviewStore(
    (s) => s.classificationsModalOpen,
  );
  const setClassificationsModalOpen = useReviewStore(
    (s) => s.setClassificationsModalOpen,
  );

  const contentSearchOpen = useReviewStore((s) => s.contentSearchOpen);
  const setContentSearchOpen = useReviewStore((s) => s.setContentSearchOpen);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [showSymbolSearch, setShowSymbolSearch] = useState(false);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(
    null,
  );

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await refresh();
    } finally {
      setIsRefreshing(false);
    }
  }, [refresh, isRefreshing]);

  // Close handler: cascading close (split -> window)
  const handleClose = useCallback(async () => {
    if (secondaryFile !== null) {
      closeSplit();
    } else {
      const platform = getPlatformServices();
      await platform.window.close();
    }
  }, [secondaryFile, closeSplit]);

  // New tab handler: open a new tab with the current repo
  const handleNewTab = useCallback(async () => {
    const apiClient = getApiClient();
    try {
      await apiClient.openRepoWindow(repoPath || "");
    } catch (err) {
      console.error("Failed to open new tab:", err);
    }
  }, [repoPath]);

  // Index map for O(1) hunk ID → index lookups
  const hunkIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < hunks.length; i++) map.set(hunks[i].id, i);
    return map;
  }, [hunks]);

  // Navigate to a hunk from the classifications modal
  const handleClassificationSelectHunk = useCallback(
    (filePath: string, hunkId: string) => {
      setClassificationsModalOpen(false);
      navigateToBrowse(filePath);
      const idx = hunkIndexMap.get(hunkId);
      if (idx !== undefined) useReviewStore.setState({ focusedHunkIndex: idx });
    },
    [hunkIndexMap, navigateToBrowse, setClassificationsModalOpen],
  );

  const { sidebarWidth, handleResizeStart } = useSidebarResize({
    sidebarPosition: "right",
  });

  useKeyboardNavigation();

  useMenuEvents({
    handleClose,
    handleNewTab,
    handleNewWindow: onNewWindow,
    handleRefresh,
    setShowDebugModal,
    setShowFileFinder,
    setShowContentSearch: setContentSearchOpen,
    setShowSymbolSearch,
  });

  useFileWatcher(comparisonReady);

  // Review progress
  const {
    totalHunks,
    trustedHunks,
    approvedHunks,
    rejectedHunks,
    reviewedHunks,
    state,
  } = useReviewProgress();

  // Celebration on 100% reviewed
  useCelebration();

  const filesPanelCollapsed = useReviewStore((s) => s.filesPanelCollapsed);
  const toggleFilesPanel = useReviewStore((s) => s.toggleFilesPanel);

  const repoName =
    remoteInfo?.name ||
    repoPath?.replace(/\/+$/, "").split("/").pop() ||
    "repo";

  return (
    <div className="flex h-full flex-row bg-surface">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="@container relative bg-surface shadow-[0_1px_0_0_var(--color-edge)] py-2.5">
          {/* Top row: breadcrumb + activity + progress */}
          <div className="flex items-center justify-between pr-4">
            {/* Left: repo / comparison ref */}
            <div className="min-w-0 px-4">
              <ReviewBreadcrumb repoName={repoName} comparison={comparison} />
            </div>

            {/* Center: activity island (floating) */}
            <ActivityBar />

            {/* Right: review progress */}
            <div className="flex shrink-0 items-center gap-3">
              {totalHunks > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setGuideContentMode("overview");
                    useReviewStore.setState({ filesPanelCollapsed: false });
                  }}
                  className="flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-md
                             hover:bg-fg/[0.06] transition-colors duration-100 cursor-default"
                >
                  {state === "approved" && (
                    <span className="hidden @md:inline text-xs font-medium text-status-approved">
                      Approved
                    </span>
                  )}
                  {state === "changes_requested" && (
                    <span className="hidden @md:inline text-xs font-medium text-status-rejected">
                      Changes Requested
                    </span>
                  )}
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
                      percent={Math.round((reviewedHunks / totalHunks) * 100)}
                      size={20}
                      strokeWidth={2.5}
                      className="shrink-0 cursor-default"
                    />
                  </SimpleTooltip>
                </button>
              ) : null}
              <SimpleTooltip
                content={
                  filesPanelCollapsed ? "Show files panel" : "Hide files panel"
                }
              >
                <button
                  type="button"
                  onClick={toggleFilesPanel}
                  className="flex items-center justify-center w-7 h-7 rounded-md
                             hover:bg-surface-raised/60 transition-colors duration-100
                             focus:outline-hidden focus:ring-2 focus:ring-edge-default/50
                             text-fg-muted hover:text-fg-secondary"
                  aria-label={
                    filesPanelCollapsed
                      ? "Show files panel"
                      : "Hide files panel"
                  }
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <rect x="3" y="3" width="18" height="18" rx="3" />
                    <line x1="15" y1="3" x2="15" y2="21" />
                  </svg>
                </button>
              </SimpleTooltip>
            </div>
          </div>
          <ReviewTitle title={guideTitle} />
        </header>

        {/* Main content */}
        <main className="relative flex flex-1 flex-col overflow-hidden bg-surface">
          <ContentArea />
          <FeedbackPanel />
        </main>
      </div>

      {/* FilesPanel (right side) */}
      <aside
        className="relative flex flex-shrink-0 flex-col overflow-hidden"
        style={{ width: filesPanelCollapsed ? 0 : `${sidebarWidth}rem` }}
      >
        {/* Sidebar content - slides via transform (no layout reflow) */}
        <div
          className="flex flex-col flex-1 overflow-hidden bg-surface border-l border-edge transition-transform duration-200"
          style={{
            width: `${sidebarWidth}rem`,
            transform: filesPanelCollapsed
              ? "translateX(100%)"
              : "translateX(0)",
          }}
        >
          <div className="flex-1 overflow-hidden">
            <FilesPanel
              onSelectCommit={(commit) => setSelectedCommitHash(commit.hash)}
            />
          </div>

          {/* Resize handle (on left edge of right sidebar) */}
          {!filesPanelCollapsed && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              onMouseDown={handleResizeStart}
              className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-status-modified/50 active:bg-status-modified"
            />
          )}
        </div>
      </aside>

      {/* Debug Modal */}
      {showDebugModal && (
        <Suspense fallback={null}>
          <DebugModal
            isOpen={showDebugModal}
            onClose={() => setShowDebugModal(false)}
          />
        </Suspense>
      )}

      {/* Commit Detail Modal */}
      {selectedCommitHash && (
        <Suspense fallback={null}>
          <CommitDetailModal
            isOpen={!!selectedCommitHash}
            onClose={() => setSelectedCommitHash(null)}
            commitHash={selectedCommitHash}
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
            onClose={() => setClassificationsModalOpen(false)}
            onSelectHunk={handleClassificationSelectHunk}
          />
        </Suspense>
      )}
    </div>
  );
}
