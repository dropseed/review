import { useEffect, useCallback, useState, useRef } from "react";
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

interface ReviewViewProps {
  onOpenRepo: () => Promise<void>;
  onNewWindow: () => Promise<void>;
  comparisonReady: boolean;
}

/** Circular progress indicator for the header. */
function HeaderCircleProgress({ percent }: { percent: number }) {
  const size = 20;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;
  const center = size / 2;
  const isComplete = percent >= 100;

  return (
    <svg
      width={size}
      height={size}
      className="shrink-0 cursor-default"
      role="progressbar"
      aria-valuenow={percent}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={`${percent}% reviewed`}
    >
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth={strokeWidth}
      />
      {percent > 0 && (
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={
            isComplete ? "var(--color-amber-500)" : "var(--color-sage-400)"
          }
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          className="transition-all duration-300"
        />
      )}
    </svg>
  );
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
  const classifyingHunkIds = useReviewStore((s) => s.classifyingHunkIds);
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

  // Send desktop notification when classification completes
  const wasClassifying = useRef(false);
  useEffect(() => {
    const notifyCompletion = async () => {
      if (wasClassifying.current && !classifying && !classificationError) {
        const platform = getPlatformServices();
        const hasPermission = await platform.notifications.requestPermission();
        if (hasPermission) {
          await platform.notifications.show(
            "Classification Complete",
            "All hunks have been classified by Claude.",
          );
        }
      }
      wasClassifying.current = classifying;
    };
    notifyCompletion();
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

  const repoName =
    remoteInfo?.name ||
    repoPath?.replace(/\/+$/, "").split("/").pop() ||
    "repo";

  return (
    <div className="flex h-full flex-row bg-stone-900">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Header */}
        <header className="flex h-12 items-center justify-between bg-stone-900 shadow-[0_1px_0_0_rgba(255,255,255,0.04)] px-4">
          {/* Left: breadcrumb + status indicators */}
          <div className="flex items-center gap-3 min-w-0">
            <ReviewBreadcrumb repoName={repoName} comparison={comparison} />
            {classifyingHunkIds.size > 0 && (
              <div className="flex items-center gap-1.5 text-violet-400 text-2xs shrink-0">
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
                <span className="tabular-nums" aria-live="polite">
                  Classifying {classifyingHunkIds.size} hunk
                  {classifyingHunkIds.size !== 1 ? "s" : ""}
                </span>
              </div>
            )}
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
                  <HeaderCircleProgress
                    percent={Math.round((reviewedHunks / totalHunks) * 100)}
                  />
                </SimpleTooltip>
              </button>
            ) : (
              <span className="text-xs text-stone-500">
                No changes to review
              </span>
            )}
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
      <DebugModal
        isOpen={showDebugModal}
        onClose={() => setShowDebugModal(false)}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettingsModal}
        onClose={() => setShowSettingsModal(false)}
      />

      {/* Commit Detail Modal */}
      <CommitDetailModal
        isOpen={!!selectedCommitHash}
        onClose={() => setSelectedCommitHash(null)}
        commitHash={selectedCommitHash}
      />

      {/* File Finder */}
      <FileFinder
        isOpen={showFileFinder}
        onClose={() => setShowFileFinder(false)}
      />

      {/* Content Search */}
      <ContentSearch
        isOpen={showContentSearch}
        onClose={() => setShowContentSearch(false)}
      />

      {/* Symbol Search */}
      <SymbolSearch
        isOpen={showSymbolSearch}
        onClose={() => setShowSymbolSearch(false)}
      />

      {/* Classifications Modal */}
      <ClassificationsModal
        isOpen={showClassificationsModal}
        onClose={() => setShowClassificationsModal(false)}
        onSelectHunk={handleClassificationSelectHunk}
      />
    </div>
  );
}
