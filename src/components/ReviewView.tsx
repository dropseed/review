import { useEffect, useCallback, useState, useRef } from "react";
import { toast } from "sonner";
import { FilesPanel } from "./FilesPanel";
import { ContentArea } from "./ContentArea";
import { DebugModal } from "./DebugModal";
import { SettingsModal } from "./SettingsModal";
import { CommitDetailModal } from "./CommitDetailModal";
import { FileFinder } from "./FileFinder";
import { ContentSearch } from "./ContentSearch";
import { SymbolSearch } from "./SymbolSearch";
import { ClassificationsModal } from "./ClassificationsModal";
import { FeedbackPanel } from "./FeedbackPanel";
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

interface ReviewViewProps {
  onOpenRepo: () => Promise<void>;
  onNewWindow: () => Promise<void>;
  comparisonReady: boolean;
}

export function ReviewView({
  onOpenRepo,
  onNewWindow,
  comparisonReady,
}: ReviewViewProps) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const classifying = useReviewStore((s) => s.classifying);
  const classificationError = useReviewStore((s) => s.classificationError);
  const hunks = useReviewStore((s) => s.hunks);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const navigateToOverview = useReviewStore((s) => s.navigateToOverview);
  const remoteInfo = useReviewStore((s) => s.remoteInfo);
  const refresh = useReviewStore((s) => s.refresh);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const closeSplit = useReviewStore((s) => s.closeSplit);
  const showClassificationsModal = useReviewStore(
    (s) => s.classificationsModalOpen,
  );
  const setShowClassificationsModal = useReviewStore(
    (s) => s.setClassificationsModalOpen,
  );
  const loadingProgress = useReviewStore((s) => s.loadingProgress);

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

  // Close handler: cascading close (split -> browse -> overview -> window)
  const handleClose = useCallback(async () => {
    if (secondaryFile !== null) {
      closeSplit();
    } else if (topLevelView === "browse") {
      navigateToOverview();
    } else {
      const platform = getPlatformServices();
      await platform.window.close();
    }
  }, [secondaryFile, topLevelView, closeSplit, navigateToOverview]);

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
      setShowClassificationsModal(false);
      navigateToBrowse(filePath);
      const idx = hunks.findIndex((h) => h.id === hunkId);
      if (idx >= 0) useReviewStore.setState({ focusedHunkIndex: idx });
    },
    [hunks, navigateToBrowse],
  );

  // Toast notifications for classification progress
  const classificationToastId = useRef<string | number | undefined>();
  const wasClassifying = useRef(false);
  useEffect(() => {
    if (classifying && !wasClassifying.current) {
      // Classification started
      classificationToastId.current = toast("Classifying hunks…", {
        duration: Infinity,
        icon: (
          <svg
            className="h-4 w-4 animate-spin text-violet-400"
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
        ),
      });
    } else if (wasClassifying.current && !classifying) {
      // Classification finished — dismiss the progress toast
      if (classificationToastId.current !== undefined) {
        toast.dismiss(classificationToastId.current);
        classificationToastId.current = undefined;
      }
      if (!classificationError) {
        toast("Classification complete", { duration: 2000 });
      }
    }
    wasClassifying.current = classifying;
  }, [classifying, classificationError]);

  const { sidebarWidth, handleResizeStart } = useSidebarResize({
    sidebarPosition: "right",
  });

  useKeyboardNavigation();

  useMenuEvents({
    handleClose,
    handleNewTab,
    handleOpenRepo: onOpenRepo,
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

  const repoName =
    remoteInfo?.name ||
    repoPath?.replace(/\/+$/, "").split("/").pop() ||
    "repo";

  // When the sidebar is collapsed, shrink the header and add left padding
  // to clear the macOS traffic lights
  const headerLayout = tabRailCollapsed ? "h-[34px] pl-[76px]" : "h-12 pl-4";

  return (
    <div className="flex h-full flex-row bg-stone-900">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header
          className={`flex items-center justify-between bg-stone-900 shadow-[0_1px_0_0_rgba(255,255,255,0.04)] pr-4 ${headerLayout}`}
          data-tauri-drag-region
        >
          {/* Left: breadcrumb */}
          <div className="flex items-center gap-3 min-w-0">
            <ReviewBreadcrumb repoName={repoName} comparison={comparison} />
          </div>

          {/* Right: review progress */}
          <div className="flex items-center gap-3">
            {totalHunks > 0 ? (
              <button
                type="button"
                onClick={navigateToOverview}
                className="flex items-center gap-2 px-2 py-1 -mx-2 -my-1 rounded-md
                           hover:bg-white/[0.06] transition-colors duration-100 cursor-default"
              >
                {state === "approved" && (
                  <span className="text-xs font-medium text-emerald-400">
                    Approved
                  </span>
                )}
                {state === "changes_requested" && (
                  <span className="text-xs font-medium text-rose-400">
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
          </div>
        </header>

        {/* Loading progress bar */}
        {loadingProgress && (
          <div className="h-0.5 w-full overflow-hidden shrink-0">
            {loadingProgress.phase === "hunks" && loadingProgress.total > 0 ? (
              <div
                className="h-full bg-amber-500/60 transition-[width] duration-300 ease-out"
                style={{
                  width: `${Math.round((loadingProgress.current / loadingProgress.total) * 100)}%`,
                }}
              />
            ) : (
              <div className="h-full w-1/4 bg-amber-500/40 animate-[shimmer_1.5s_ease-in-out_infinite]" />
            )}
          </div>
        )}

        {/* Main content */}
        <main className="relative flex flex-1 flex-col overflow-hidden bg-stone-900">
          <ContentArea />
          <FeedbackPanel />
        </main>
      </div>

      {/* FilesPanel (right side) */}
      <aside
        className="relative flex flex-shrink-0 flex-col bg-stone-900 shadow-[-1px_0_0_0_rgba(255,255,255,0.04)]"
        style={{ width: `${sidebarWidth}rem` }}
      >
        {/* Sidebar content */}
        <div className="flex-1 overflow-hidden">
          <FilesPanel
            onSelectCommit={(commit) => setSelectedCommitHash(commit.hash)}
          />
        </div>

        {/* Resize handle (on left edge of right sidebar) */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onMouseDown={handleResizeStart}
          className="absolute top-0 left-0 h-full w-1 cursor-col-resize hover:bg-amber-500/50 active:bg-amber-500"
        />
      </aside>

      {/* Debug Modal */}
      {showDebugModal && (
        <DebugModal
          isOpen={showDebugModal}
          onClose={() => setShowDebugModal(false)}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
        />
      )}

      {/* Commit Detail Modal */}
      {selectedCommitHash && (
        <CommitDetailModal
          isOpen={!!selectedCommitHash}
          onClose={() => setSelectedCommitHash(null)}
          commitHash={selectedCommitHash}
        />
      )}

      {/* File Finder */}
      {showFileFinder && (
        <FileFinder
          isOpen={showFileFinder}
          onClose={() => setShowFileFinder(false)}
        />
      )}

      {/* Content Search */}
      {showContentSearch && (
        <ContentSearch
          isOpen={showContentSearch}
          onClose={() => setShowContentSearch(false)}
        />
      )}

      {/* Symbol Search */}
      {showSymbolSearch && (
        <SymbolSearch
          isOpen={showSymbolSearch}
          onClose={() => setShowSymbolSearch(false)}
        />
      )}

      {/* Classifications Modal */}
      {showClassificationsModal && (
        <ClassificationsModal
          isOpen={showClassificationsModal}
          onClose={() => setShowClassificationsModal(false)}
          onSelectHunk={handleClassificationSelectHunk}
        />
      )}
    </div>
  );
}
