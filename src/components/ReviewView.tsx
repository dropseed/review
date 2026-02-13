import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { FilesPanel } from "./FilesPanel";
import { ContentArea } from "./ContentArea";
import { FeedbackPanel } from "./FeedbackPanel";

const DebugModal = lazy(() =>
  import("./modals/DebugModal").then((m) => ({ default: m.DebugModal })),
);
const SettingsModal = lazy(() =>
  import("./modals/SettingsModal").then((m) => ({ default: m.SettingsModal })),
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
import { ReviewBreadcrumb } from "./ReviewBreadcrumb";
import { SimpleTooltip } from "./ui/tooltip";
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
import { CircleProgress } from "./ui/circle-progress";
import { ActivityBar } from "./ActivityBar";

interface ReviewViewProps {
  onNewWindow: () => Promise<void>;
  comparisonReady: boolean;
}

export function ReviewView({ onNewWindow, comparisonReady }: ReviewViewProps) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const hunks = useReviewStore((s) => s.hunks);
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const navigateToGuide = useReviewStore((s) => s.navigateToGuide);
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
  const startGuide = useReviewStore((s) => s.startGuide);
  const guideLoading = useReviewStore((s) => s.guideLoading);
  const guideRecommended = useReviewStore((s) => s.hunks.length >= 8);

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [showContentSearch, setShowContentSearch] = useState(false);
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
    setShowSettingsModal,
    setShowFileFinder,
    setShowContentSearch,
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

  const tabRailCollapsed = useReviewStore((s) => s.tabRailCollapsed);
  const filesPanelCollapsed = useReviewStore((s) => s.filesPanelCollapsed);
  const toggleFilesPanel = useReviewStore((s) => s.toggleFilesPanel);

  const repoName =
    remoteInfo?.name ||
    repoPath?.replace(/\/+$/, "").split("/").pop() ||
    "repo";

  return (
    <div className="flex h-full flex-row bg-stone-900">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header
          className={`@container relative flex items-center justify-between bg-stone-900 shadow-[0_1px_0_0_rgba(255,255,255,0.04)] pr-4 h-12 ${tabRailCollapsed ? "pl-[84px]" : "pl-4"}`}
          data-tauri-drag-region
        >
          {/* Left: breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <ReviewBreadcrumb repoName={repoName} comparison={comparison} />
          </div>

          {/* Center: activity island (floating) */}
          <ActivityBar />

          {/* Right: review progress */}
          <div className="flex shrink-0 items-center gap-3">
            {guideRecommended &&
              topLevelView !== "guide" &&
              (selectedFile || secondaryFile) && (
                <button
                  type="button"
                  onClick={startGuide}
                  disabled={guideLoading}
                  className="flex items-center gap-1.5 rounded-md bg-violet-500/15 px-2.5 py-1 text-xs font-medium text-violet-300 border border-violet-500/20 hover:bg-violet-500/25 transition-colors disabled:opacity-50"
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
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={1.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z"
                      />
                    </svg>
                  )}
                  <span className="hidden @md:inline">
                    {guideLoading ? "Starting…" : "Guided Review"}
                  </span>
                </button>
              )}
            {totalHunks > 0 ? (
              <button
                type="button"
                onClick={navigateToGuide}
                className="flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-md
                           hover:bg-white/[0.06] transition-colors duration-100 cursor-default"
              >
                {state === "approved" && (
                  <span className="hidden @md:inline text-xs font-medium text-emerald-400">
                    Approved
                  </span>
                )}
                {state === "changes_requested" && (
                  <span className="hidden @md:inline text-xs font-medium text-rose-400">
                    Changes Requested
                  </span>
                )}
                <span className="font-mono text-xs tabular-nums text-stone-400">
                  {reviewedHunks}/{totalHunks}
                </span>
                <SimpleTooltip
                  content={
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-cyan-500" />
                        <span>Trusted: {trustedHunks}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        <span>Approved: {approvedHunks}</span>
                      </div>
                      {rejectedHunks > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="w-2 h-2 rounded-full bg-rose-500" />
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
                           hover:bg-stone-800/60 transition-colors duration-100
                           focus:outline-hidden focus:ring-2 focus:ring-stone-500/50
                           text-stone-500 hover:text-stone-300"
                aria-label={
                  filesPanelCollapsed ? "Show files panel" : "Hide files panel"
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
        </header>

        {/* Main content */}
        <main className="relative flex flex-1 flex-col overflow-hidden bg-stone-900">
          <ContentArea />
          <FeedbackPanel />
        </main>
      </div>

      {/* FilesPanel (right side) */}
      <aside
        className="relative flex flex-shrink-0 flex-col bg-stone-900 shadow-[-1px_0_0_0_rgba(255,255,255,0.04)] overflow-hidden transition-[width] duration-200"
        style={{ width: filesPanelCollapsed ? 0 : `${sidebarWidth}rem` }}
      >
        {/* Sidebar content */}
        <div
          className="flex-1 overflow-hidden"
          style={{ width: `${sidebarWidth}rem` }}
        >
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
            className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-amber-500/50 active:bg-amber-500"
          />
        )}
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

      {/* Settings Modal */}
      {showSettingsModal && (
        <Suspense fallback={null}>
          <SettingsModal
            isOpen={showSettingsModal}
            onClose={() => setShowSettingsModal(false)}
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
      {showContentSearch && (
        <Suspense fallback={null}>
          <ContentSearch
            isOpen={showContentSearch}
            onClose={() => setShowContentSearch(false)}
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
