import { useEffect, useCallback, useMemo, useState, useRef } from "react";
import { FilesPanel } from "./FilesPanel";
import { SplitContainer } from "./SplitContainer";
import { DebugModal } from "./DebugModal";
import { SettingsModal } from "./SettingsModal";
import { CommitDetailModal } from "./CommitDetailModal";
import { FileFinder } from "./FileFinder";
import { ContentSearch } from "./ContentSearch";
import { SymbolSearch } from "./SymbolSearch";
import { ClassificationsModal } from "./ClassificationsModal";
import { GitStatusIndicator } from "./GitStatusIndicator";
import { ComparisonHeader } from "./ComparisonHeader";
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
} from "../hooks";

interface ReviewViewProps {
  onBack: () => void;
  onOpenRepo: () => Promise<void>;
  onNewWindow: () => Promise<void>;
  comparisonReady: boolean;
}

export function ReviewView({
  onBack,
  onOpenRepo,
  onNewWindow,
  comparisonReady,
}: ReviewViewProps) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const sidebarPosition = useReviewStore((s) => s.sidebarPosition);
  const classifying = useReviewStore((s) => s.classifying);
  const classificationError = useReviewStore((s) => s.classificationError);
  const classifyingHunkIds = useReviewStore((s) => s.classifyingHunkIds);
  const hunks = useReviewStore((s) => s.hunks);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const navigateToOverview = useReviewStore((s) => s.navigateToOverview);
  const remoteInfo = useReviewStore((s) => s.remoteInfo);
  const refresh = useReviewStore((s) => s.refresh);
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const closeSplit = useReviewStore((s) => s.closeSplit);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);
  const showClassificationsModal = useReviewStore(
    (s) => s.classificationsModalOpen,
  );
  const setShowClassificationsModal = useReviewStore(
    (s) => s.setClassificationsModalOpen,
  );

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

  // Close handler: cascading close (split -> file -> window)
  const handleClose = useCallback(async () => {
    if (secondaryFile !== null) {
      closeSplit();
    } else if (selectedFile !== null) {
      setSelectedFile(null);
      navigateToOverview();
    } else {
      const platform = getPlatformServices();
      await platform.window.close();
    }
  }, [
    secondaryFile,
    selectedFile,
    closeSplit,
    setSelectedFile,
    navigateToOverview,
  ]);

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
    sidebarPosition,
  });

  useKeyboardNavigation({
    handleOpenRepo: onOpenRepo,
    setShowDebugModal,
    setShowSettingsModal,
    setShowFileFinder,
    setShowContentSearch,
    setShowSymbolSearch,
  });

  useMenuEvents({
    handleClose,
    handleNewTab,
    handleOpenRepo: onOpenRepo,
    handleNewWindow: onNewWindow,
    handleRefresh,
    setShowDebugModal,
    setShowSettingsModal,
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

  // Diff stats computed from hunks
  const diffStats = useMemo(() => {
    const filePaths = new Set(hunks.map((h) => h.filePath));
    let additions = 0;
    let deletions = 0;
    for (const hunk of hunks) {
      for (const line of hunk.lines) {
        if (line.type === "added") additions++;
        else if (line.type === "removed") deletions++;
      }
    }
    return { fileCount: filePaths.size, additions, deletions };
  }, [hunks]);

  return (
    <div className="flex h-screen flex-col bg-stone-950">
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b border-stone-800 bg-stone-900 px-4">
        {/* Left: back button + repo name + comparison refs */}
        <div className="flex items-center gap-2">
          {/* Back button */}
          <SimpleTooltip content="Back to start">
            <button
              onClick={onBack}
              className="flex items-center justify-center w-7 h-7 rounded-md
                         text-stone-500 hover:text-stone-200 hover:bg-stone-800/60
                         transition-colors duration-100
                         focus:outline-hidden focus:ring-2 focus:ring-stone-500/50"
              aria-label="Back to start screen"
            >
              <svg
                className="w-4 h-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M19 12H5" />
                <path d="M12 19l-7-7 7-7" />
              </svg>
            </button>
          </SimpleTooltip>

          <span className="text-xs text-stone-500">
            {remoteInfo?.name ||
              repoPath?.replace(/\/+$/, "").split("/").pop() ||
              "repo"}
          </span>

          <ComparisonHeader
            comparison={comparison}
            diffStats={diffStats}
            onStatsClick={navigateToOverview}
            isOverviewActive={topLevelView === "overview"}
          />
        </div>

        {/* Right: review controls */}
        <div className="flex items-center gap-3">
          {/* Review progress */}
          {totalHunks > 0 ? (
            <div className="group relative flex items-center gap-2">
              <span className="text-xs text-stone-500">Hunks reviewed</span>
              <span className="font-mono text-xs tabular-nums text-stone-400">
                {reviewedHunks}/{totalHunks}
              </span>
              <div className="progress-bar w-24">
                <div
                  className="progress-bar-trusted"
                  style={{
                    width: `${(trustedHunks / totalHunks) * 100}%`,
                  }}
                />
                <div
                  className="progress-bar-approved"
                  style={{
                    width: `${(approvedHunks / totalHunks) * 100}%`,
                    left: `${(trustedHunks / totalHunks) * 100}%`,
                  }}
                />
                <div
                  className="progress-bar-rejected"
                  style={{
                    width: `${(rejectedHunks / totalHunks) * 100}%`,
                    left: `${((trustedHunks + approvedHunks) / totalHunks) * 100}%`,
                  }}
                />
              </div>
              {state === "approved" && (
                <span className="text-xxs font-medium text-lime-400">
                  Approved
                </span>
              )}
              {state === "changes_requested" && (
                <span className="text-xxs font-medium text-rose-400">
                  Changes Requested
                </span>
              )}
              {/* Hover tooltip */}
              <div
                className="absolute top-full right-0 mt-1 hidden group-hover:block
                            bg-stone-900 border border-stone-700 rounded px-2 py-1.5
                            text-xs whitespace-nowrap z-50 shadow-lg"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-cyan-500" />
                  <span className="text-stone-300">
                    Trusted: {trustedHunks}
                  </span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-2 h-2 rounded-full bg-lime-500" />
                  <span className="text-stone-300">
                    Approved: {approvedHunks}
                  </span>
                </div>
                {rejectedHunks > 0 && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-2 h-2 rounded-full bg-rose-500" />
                    <span className="text-stone-300">
                      Rejected: {rejectedHunks}
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <span className="text-xs text-stone-500">No changes to review</span>
          )}
        </div>
      </header>

      {/* Main content */}
      <div
        className={`flex flex-1 overflow-hidden ${sidebarPosition === "right" ? "flex-row-reverse" : "flex-row"}`}
      >
        {/* Sidebar */}
        <aside
          className={`relative flex flex-shrink-0 flex-col bg-stone-900 ${
            sidebarPosition === "right"
              ? "border-l border-stone-800"
              : "border-r border-stone-800"
          }`}
          style={{ width: `${sidebarWidth}rem` }}
        >
          {/* Sidebar content */}
          <div className="flex-1 overflow-hidden">
            <FilesPanel
              onSelectCommit={(commit) => setSelectedCommitHash(commit.hash)}
            />
          </div>

          {/* Resize handle */}
          <div
            onMouseDown={handleResizeStart}
            className={`absolute top-0 h-full w-1 cursor-col-resize hover:bg-lime-500/50 active:bg-lime-500 ${
              sidebarPosition === "right" ? "left-0" : "right-0"
            }`}
          />
        </aside>

        {/* Code viewer */}
        <main className="relative flex flex-1 flex-col overflow-hidden bg-stone-950">
          <SplitContainer />
        </main>
      </div>

      {/* Status Bar */}
      <footer className="flex h-8 items-center justify-between border-t border-stone-800 bg-stone-900 px-4 text-2xs">
        <div className="flex items-center gap-3">
          <GitStatusIndicator />
          {/* Classification progress indicator */}
          {classifyingHunkIds.size > 0 && (
            <div className="flex items-center gap-1.5 text-violet-400">
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
              <span className="tabular-nums">
                Classifying {classifyingHunkIds.size} hunk
                {classifyingHunkIds.size !== 1 ? "s" : ""}
              </span>
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 text-stone-600">
          {remoteInfo && (
            <button
              onClick={() => {
                const platform = getPlatformServices();
                platform.opener.openUrl(remoteInfo.browseUrl);
              }}
              className="flex items-center gap-1 text-stone-500 hover:text-stone-300 transition-colors"
              title={remoteInfo.browseUrl}
            >
              {remoteInfo.browseUrl.includes("github.com") ? (
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
                </svg>
              ) : (
                <svg
                  className="h-3 w-3"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              )}
              <span>{remoteInfo.name}</span>
            </button>
          )}
          <span>
            <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
              {"\u2318"}P
            </kbd>
            <span className="ml-1">find file</span>
          </span>
          <span>
            <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
              {"\u2318"}R
            </kbd>
            <span className="ml-1">symbols</span>
          </span>
          <span>
            <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
              {"\u2318"}⇧F
            </kbd>
            <span className="ml-1">search</span>
          </span>
        </div>
      </footer>

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
