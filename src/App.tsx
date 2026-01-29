import { useEffect, useCallback, useState } from "react";
import { FilesPanel } from "./components/FilesPanel";
import { SplitContainer } from "./components/SplitContainer";
import { DebugModal } from "./components/DebugModal";
import { TrustModal } from "./components/TrustModal";
import { SettingsModal } from "./components/SettingsModal";
import { CommitDetailModal } from "./components/CommitDetailModal";
import { FileFinder } from "./components/FileFinder";
import { ContentSearch } from "./components/ContentSearch";
import { GitStatusIndicator } from "./components/GitStatusIndicator";
import { WelcomePage } from "./components/WelcomePage";
import { ComparisonHeader } from "./components/ComparisonHeader";
import { useReviewStore } from "./stores/reviewStore";
import { isHunkTrusted } from "./types";
import {
  useGlobalShortcut,
  useWindowTitle,
  useSidebarResize,
  useMenuEvents,
  useFileWatcher,
  useRepositoryInit,
  useComparisonLoader,
  useKeyboardNavigation,
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
  const {
    repoPath,
    setRepoPath,
    comparison,
    setComparison,
    loadCurrentComparison,
    loadFiles,
    loadAllFiles,
    loadReviewState,
    loadGitStatus,
    saveCurrentComparison,
    reviewState,
    hunks,
    focusedHunkIndex,
    approveHunk,
    rejectHunk,
    nextFile,
    prevFile,
    nextHunk,
    prevHunk,
    sidebarPosition,
    codeFontSize,
    setCodeFontSize,
    loadPreferences,
    refresh,
    classifyingHunkIds,
    checkClaudeAvailable,
    triggerAutoClassification,
    // Split view state and actions
    secondaryFile,
    closeSplit,
    setSplitOrientation,
    splitOrientation,
    // Main view mode
    mainViewMode,
    setMainViewMode,
    // Loading progress
    loadingProgress,
    // History
    loadCommits,
  } = useReviewStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [showTrustModal, setShowTrustModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const [showContentSearch, setShowContentSearch] = useState(false);
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

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();
    checkClaudeAvailable();
  }, [loadPreferences, checkClaudeAvailable]);

  // Custom hooks
  useGlobalShortcut();

  const {
    repoStatus,
    repoError,
    comparisonReady,
    initialLoading,
    setInitialLoading,
    handleSelectReview,
    handleOpenRepo,
    handleNewWindow,
    handleSelectRepo,
  } = useRepositoryInit({
    repoPath,
    setRepoPath,
    setComparison,
    loadCurrentComparison,
    saveCurrentComparison,
  });

  useWindowTitle(repoPath, comparison, comparisonReady);

  const { sidebarWidth, handleResizeStart } = useSidebarResize({
    sidebarPosition,
  });

  useKeyboardNavigation({
    hunks,
    focusedHunkIndex,
    nextFile,
    prevFile,
    nextHunk,
    prevHunk,
    approveHunk,
    rejectHunk,
    handleOpenRepo,
    codeFontSize,
    setCodeFontSize,
    secondaryFile,
    closeSplit,
    setSplitOrientation,
    splitOrientation,
    setShowDebugModal,
    setShowSettingsModal,
    setShowFileFinder,
    setShowContentSearch,
  });

  useMenuEvents({
    handleOpenRepo,
    handleNewWindow,
    handleRefresh,
    codeFontSize,
    setCodeFontSize,
    setShowDebugModal,
    setShowSettingsModal,
  });

  useFileWatcher({
    repoPath,
    comparisonReady,
    loadReviewState,
    refresh,
  });

  useComparisonLoader({
    repoPath,
    comparisonReady,
    comparisonKey: comparison.key,
    loadFiles,
    loadAllFiles,
    loadReviewState,
    loadGitStatus,
    loadCommits,
    triggerAutoClassification,
    setInitialLoading,
  });

  // Calculate review progress
  const totalHunks = hunks.length;
  const trustedHunks = reviewState
    ? hunks.filter((h) => {
        const state = reviewState.hunks[h.id];
        return !state?.status && isHunkTrusted(state, reviewState.trustList);
      }).length
    : 0;
  const approvedHunks = reviewState
    ? hunks.filter((h) => reviewState.hunks[h.id]?.status === "approved").length
    : 0;
  const reviewedHunks = trustedHunks + approvedHunks;

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

  // Show welcome page when no repository is found
  if (repoStatus === "not_found") {
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
    <div className="flex h-screen flex-col bg-stone-950">
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b border-stone-800 bg-stone-900 px-4">
        {/* Left: comparison refs */}
        <ComparisonHeader
          comparison={comparison}
          repoPath={repoPath}
          onSelectReview={handleSelectReview}
        />

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
              </div>
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
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-lime-500" />
                  <span className="text-stone-300">
                    Approved: {approvedHunks}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <span className="text-xs text-stone-500">No changes to review</span>
          )}

          {/* View mode toggle */}
          <div className="flex items-center rounded-md bg-stone-800/50 p-0.5">
            <button
              onClick={() => setMainViewMode("single")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                mainViewMode === "single"
                  ? "bg-stone-700 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
              title="Single file view"
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
                <rect x="3" y="3" width="18" height="18" rx="2" />
              </svg>
              <span>Single</span>
            </button>
            <button
              onClick={() => setMainViewMode("rolling")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                mainViewMode === "rolling"
                  ? "bg-stone-700 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
              title="Rolling view - all files"
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
                <rect x="3" y="3" width="18" height="5" rx="1" />
                <rect x="3" y="10" width="18" height="5" rx="1" />
                <rect x="3" y="17" width="18" height="5" rx="1" />
              </svg>
              <span>Rolling</span>
            </button>
            <button
              onClick={() => setMainViewMode("overview")}
              className={`flex items-center gap-1 rounded px-2 py-1 text-xs transition-colors ${
                mainViewMode === "overview"
                  ? "bg-stone-700 text-stone-200"
                  : "text-stone-500 hover:text-stone-300"
              }`}
              title="Overview - symbol changes"
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
          </div>

          {/* Trust Settings button */}
          <button
            onClick={() => setShowTrustModal(true)}
            className="flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-stone-400 hover:bg-stone-800 hover:text-stone-200 transition-colors"
            title="Trust Settings"
          >
            <svg
              className="h-4 w-4"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <span>Trust</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-xxs font-medium tabular-nums ${
                (reviewState?.trustList.length ?? 0) > 0
                  ? "bg-cyan-500/20 text-cyan-400"
                  : "bg-stone-700 text-stone-500"
              }`}
            >
              {reviewState?.trustList.length ?? 0}
            </span>
          </button>
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
            <span className="ml-1">find</span>
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

      {/* Trust Modal */}
      <TrustModal
        isOpen={showTrustModal}
        onClose={() => setShowTrustModal(false)}
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
    </div>
  );
}

export default App;
