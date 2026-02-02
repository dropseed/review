import { useEffect, useCallback, useState, useRef } from "react";
import { FilesPanel } from "./components/FilesPanel";
import { SplitContainer } from "./components/SplitContainer";
import { DebugModal } from "./components/DebugModal";
import { SettingsModal } from "./components/SettingsModal";
import { CommitDetailModal } from "./components/CommitDetailModal";
import { FileFinder } from "./components/FileFinder";
import { ContentSearch } from "./components/ContentSearch";
import { SymbolSearch } from "./components/SymbolSearch";
import { GitStatusIndicator } from "./components/GitStatusIndicator";
import { WelcomePage } from "./components/WelcomePage";
import { ComparisonHeader } from "./components/ComparisonHeader";
import { TooltipProvider, SimpleTooltip } from "./components/ui/tooltip";
import { useReviewStore } from "./stores";
import { getPlatformServices } from "./platform";
import { getApiClient } from "./api";
import {
  useGlobalShortcut,
  useWindowTitle,
  useSidebarResize,
  useMenuEvents,
  useFileWatcher,
  useRepositoryInit,
  useComparisonLoader,
  useKeyboardNavigation,
  useReviewProgress,
} from "./hooks";

/** Returns the appropriate loading progress message based on current phase */
function getLoadingProgressText(
  loadingProgress: { phase: string; current: number; total: number } | null,
): string {
  if (!loadingProgress) {
    return "Loading review...";
  }
  switch (loadingProgress.phase) {
    case "files":
      return "Finding changed files...";
    case "hunks":
      return `Loading file ${loadingProgress.current} of ${loadingProgress.total}...`;
    default:
      return "Detecting moved code...";
  }
}

function App() {
  // Only subscribe to the values App actually renders
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const sidebarPosition = useReviewStore((s) => s.sidebarPosition);
  const classifying = useReviewStore((s) => s.classifying);
  const classificationError = useReviewStore((s) => s.classificationError);
  const classifyingHunkIds = useReviewStore((s) => s.classifyingHunkIds);
  const narrativeGenerating = useReviewStore((s) => s.narrativeGenerating);
  const symbolsLoading = useReviewStore((s) => s.symbolsLoading);
  const symbolsLoaded = useReviewStore((s) => s.symbolsLoaded);
  const topLevelView = useReviewStore((s) => s.topLevelView);
  const navigateToOverview = useReviewStore((s) => s.navigateToOverview);
  const loadingProgress = useReviewStore((s) => s.loadingProgress);
  const remoteInfo = useReviewStore((s) => s.remoteInfo);
  const loadPreferences = useReviewStore((s) => s.loadPreferences);
  const checkClaudeAvailable = useReviewStore((s) => s.checkClaudeAvailable);
  const refresh = useReviewStore((s) => s.refresh);
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const secondaryFile = useReviewStore((s) => s.secondaryFile);
  const closeSplit = useReviewStore((s) => s.closeSplit);
  const setSelectedFile = useReviewStore((s) => s.setSelectedFile);

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

  // Close handler: cascading close (split → file → window)
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

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();
    checkClaudeAvailable();
  }, [loadPreferences, checkClaudeAvailable]);

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

  // Custom hooks
  useGlobalShortcut();

  const {
    repoStatus,
    repoError,
    comparisonReady,
    initialLoading,
    setInitialLoading,
    handleBackToStart,
    handleOpenRepo,
    handleNewWindow,
    handleSelectRepo,
  } = useRepositoryInit();

  useWindowTitle(repoPath, comparison, comparisonReady);

  const { sidebarWidth, handleResizeStart } = useSidebarResize({
    sidebarPosition,
  });

  useKeyboardNavigation({
    handleOpenRepo,
    onBack: () => {},
    setShowDebugModal,
    setShowSettingsModal,
    setShowFileFinder,
    setShowContentSearch,
    setShowSymbolSearch,
  });

  useMenuEvents({
    handleClose,
    handleNewTab,
    handleOpenRepo,
    handleNewWindow,
    handleRefresh,
    setShowDebugModal,
    setShowSettingsModal,
  });

  useFileWatcher(comparisonReady);

  useComparisonLoader(comparisonReady, setInitialLoading);

  // Review progress (shared with OverviewView)
  const {
    totalHunks,
    trustedHunks,
    approvedHunks,
    rejectedHunks,
    reviewedHunks,
    state,
  } = useReviewProgress();

  // Show loading state while determining repo status
  if (repoStatus === "loading") {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="h-8 w-8 rounded-full border-2 border-stone-700 border-t-lime-500 animate-spin" />
          <p className="text-stone-400">Loading repository...</p>
        </div>
      </div>
    );
  }

  // Show welcome page when no repository is found or user closed the repo
  if (repoStatus === "not_found" || repoStatus === "welcome") {
    return (
      <WelcomePage
        onOpenRepo={handleOpenRepo}
        onSelectRepo={handleSelectRepo}
      />
    );
  }

  // Show error state for other errors
  if (repoStatus === "error") {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-red-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
              />
            </svg>
          </div>
          <h1 className="text-lg font-medium text-stone-200">
            Failed to load repository
          </h1>
          <p className="text-sm text-stone-400">{repoError}</p>
          <button
            onClick={handleOpenRepo}
            className="mt-4 px-4 py-2 rounded-lg bg-stone-800 text-stone-200 text-sm font-medium hover:bg-stone-700 transition-colors"
          >
            Open a Repository
          </button>
        </div>
      </div>
    );
  }

  // Guard for TypeScript - if we get here without repoPath, something is wrong
  if (!repoPath) {
    return null;
  }

  // Note: Start screen routing is now handled by react-router in router.tsx.
  // This component is no longer the entry point — see AppRouter in router.tsx.

  // Show loading indicator during initial load
  if (initialLoading) {
    const progressText = getLoadingProgressText(loadingProgress);

    return (
      <div className="flex h-screen items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="h-8 w-8 rounded-full border-2 border-stone-700 border-t-lime-500 animate-spin" />
          <p className="text-stone-400">{progressText}</p>
          {loadingProgress?.phase === "hunks" && loadingProgress.total > 0 && (
            <div className="w-48">
              <div className="h-1.5 w-full rounded-full bg-stone-800">
                <div
                  className="h-1.5 rounded-full bg-lime-500"
                  style={{
                    width: `${Math.round((loadingProgress.current / loadingProgress.total) * 100)}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen flex-col bg-stone-950">
        {/* Header */}
        <header className="flex h-12 items-center justify-between border-b border-stone-800 bg-stone-900 px-4">
          {/* Left: back button + repo name + comparison refs */}
          <div className="flex items-center gap-2">
            {/* Back button */}
            <SimpleTooltip content="Back to start">
              <button
                onClick={handleBackToStart}
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

            {remoteInfo && (
              <button
                onClick={() => {
                  const platform = getPlatformServices();
                  platform.opener.openUrl(remoteInfo.browseUrl);
                }}
                className="flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 transition-colors"
                title={remoteInfo.browseUrl}
              >
                <span>{remoteInfo.name}</span>
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
              </button>
            )}

            <ComparisonHeader comparison={comparison} />
          </div>

          {/* Right: review controls */}
          <div className="flex items-center gap-3">
            {/* Review progress */}
            {totalHunks > 0 ? (
              <div className="group relative flex items-center gap-2">
                <span className="text-xs text-stone-500">Reviewed</span>
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
              <span className="text-xs text-stone-500">
                No changes to review
              </span>
            )}

            {/* Overview button */}
            <SimpleTooltip content="Overview (Esc)">
              <button
                onClick={navigateToOverview}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                  topLevelView === "overview"
                    ? "bg-stone-800 text-stone-200"
                    : "text-stone-500 hover:bg-stone-800 hover:text-stone-300"
                }`}
              >
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                <span>Overview</span>
              </button>
            </SimpleTooltip>
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
            {/* Symbol extraction progress indicator */}
            {symbolsLoading && !symbolsLoaded && (
              <div className="flex items-center gap-1.5 text-amber-400">
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
                <span>Extracting symbols...</span>
              </div>
            )}
            {/* Narrative generation progress indicator */}
            {narrativeGenerating && (
              <div className="flex items-center gap-1.5 text-purple-400">
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
                <span>Generating narrative...</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 text-stone-600">
            <span>
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
                j
              </kbd>
              <span className="mx-0.5">/</span>
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
                k
              </kbd>
              <span className="ml-1">hunks</span>
            </span>
            <span>
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-emerald-500/70">
                a
              </kbd>
              <span className="mx-0.5">/</span>
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-rose-500/70">
                r
              </kbd>
              <span className="ml-1">approve/reject</span>
            </span>
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
      </div>
    </TooltipProvider>
  );
}

export default App;
