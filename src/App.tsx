import { useEffect, useCallback, useState, useRef } from "react";
import { FilesPanel } from "./components/FilesPanel";
import { SplitContainer } from "./components/SplitContainer";
import { DebugModal } from "./components/DebugModal";
import { TrustModal } from "./components/TrustModal";
import { SettingsModal } from "./components/SettingsModal";
import { FileFinder } from "./components/FileFinder";
import { GitStatusIndicator } from "./components/GitStatusIndicator";
import { StartScreen } from "./components/StartScreen";
import { ComparisonHeader } from "./components/ComparisonHeader";
import { useReviewStore } from "./stores/reviewStore";
import { isHunkTrusted, makeComparison, type Comparison } from "./types";
import {
  CODE_FONT_SIZE_DEFAULT,
  CODE_FONT_SIZE_MIN,
  CODE_FONT_SIZE_MAX,
  CODE_FONT_SIZE_STEP,
} from "./utils/preferences";
import { setLoggerRepoPath, clearLog } from "./utils/logger";
import { getApiClient } from "./api";
import { getPlatformServices } from "./platform";

// Get repo path from URL query parameter (for multi-window support)
function getRepoPathFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("repo");
}

// Get comparison key from URL query parameter (for multi-window support)
function getComparisonKeyFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("comparison");
}

// Parse comparison key back into a Comparison object
// Key format: "old..new" or "old..new+working-tree"
function parseComparisonKey(key: string): Comparison | null {
  const workingTree = key.endsWith("+working-tree");
  const cleanKey = workingTree ? key.replace("+working-tree", "") : key;

  const parts = cleanKey.split("..");
  if (parts.length !== 2) return null;

  const [oldRef, newRef] = parts;
  if (!oldRef || !newRef) return null;

  return makeComparison(oldRef, newRef, workingTree);
}

function App() {
  const {
    repoPath,
    setRepoPath,
    comparison,
    setComparison,
    loadFiles,
    loadAllFiles,
    loadReviewState,
    loadGitStatus,
    saveCurrentComparison,
    reviewState,
    hunks,
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
  } = useReviewStore();

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);

  // Start screen state - show by default unless URL has comparison
  const [showStartScreen, setShowStartScreen] = useState(true);

  const [sidebarWidth, setSidebarWidth] = useState(19.2); // in rem (288px / 15px base)
  const [showDebugModal, setShowDebugModal] = useState(false);
  const [showTrustModal, setShowTrustModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showFileFinder, setShowFileFinder] = useState(false);
  const isResizing = useRef(false);

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

  // Register global shortcut to focus the app (Cmd/Ctrl+Shift+R)
  useEffect(() => {
    const shortcut = "CommandOrControl+Shift+R";
    const platform = getPlatformServices();

    const registerShortcut = async () => {
      try {
        await platform.shortcuts.register(shortcut, async () => {
          await platform.window.show();
          await platform.window.focus();
        });
      } catch (err) {
        // Shortcut may already be registered or in use
        console.debug("Global shortcut registration skipped:", err);
      }
    };

    registerShortcut();

    return () => {
      platform.shortcuts.unregister(shortcut).catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Check URL for repo path first (multi-window support)
    const urlRepoPath = getRepoPathFromUrl();
    if (urlRepoPath) {
      setRepoPath(urlRepoPath);
      setLoggerRepoPath(urlRepoPath);
      clearLog(); // Start fresh each session
      return;
    }

    // Fall back to getting current working directory from API
    const apiClient = getApiClient();
    apiClient
      .getCurrentRepo()
      .then((path) => {
        setRepoPath(path);
        setLoggerRepoPath(path);
        clearLog(); // Start fresh each session
      })
      .catch(console.error);
  }, [setRepoPath]);

  // Open a new window with a different repository
  const handleOpenRepo = useCallback(async () => {
    const platform = getPlatformServices();
    const apiClient = getApiClient();
    try {
      const selected = await platform.dialogs.openDirectory({
        title: "Open Repository",
      });

      if (selected) {
        // Open in a new window
        await apiClient.openRepoWindow(selected);
      }
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, []);

  // Track if comparison has been initialized for this repo
  const [comparisonReady, setComparisonReady] = useState(false);

  // Handle selecting a review from the start screen
  const handleSelectReview = useCallback(
    (selectedComparison: Comparison) => {
      setComparison(selectedComparison);
      saveCurrentComparison();
      setComparisonReady(true);
      setInitialLoading(true);
      setShowStartScreen(false);
    },
    [setComparison, saveCurrentComparison],
  );

  // Handle going back to the start screen
  const handleBackToStart = useCallback(() => {
    setShowStartScreen(true);
  }, []);

  // Check URL for comparison when repo path changes
  // If URL has comparison, skip start screen; otherwise show start screen
  useEffect(() => {
    if (repoPath) {
      setComparisonReady(false);

      // Check URL for comparison (multi-window support with specific comparison)
      const urlComparisonKey = getComparisonKeyFromUrl();
      if (urlComparisonKey) {
        const parsedComparison = parseComparisonKey(urlComparisonKey);
        if (parsedComparison) {
          setComparison(parsedComparison);
          setComparisonReady(true);
          setInitialLoading(true);
          setShowStartScreen(false); // Skip start screen if URL has comparison
          return;
        }
      }

      // No URL comparison - show start screen
      setShowStartScreen(true);
      setComparisonReady(false);
    }
  }, [repoPath, setComparison]);

  // Update window title when comparison changes
  useEffect(() => {
    if (repoPath) {
      const platform = getPlatformServices();
      const repoName = repoPath.split("/").pop() || "Repository";
      if (showStartScreen || !comparisonReady) {
        // Just show repo name on start screen
        platform.window.setTitle(repoName).catch(console.error);
      } else {
        const compareDisplay = comparison.workingTree
          ? "Working Tree"
          : comparison.new;
        const title = `${repoName} — ${comparison.old}..${compareDisplay}`;
        platform.window.setTitle(title).catch(console.error);
      }
    }
  }, [repoPath, comparisonReady, comparison, showStartScreen]);

  // Load files and review state when comparison is ready and not on start screen
  useEffect(() => {
    if (repoPath && comparisonReady && !showStartScreen) {
      const loadData = async () => {
        try {
          // Load review state FIRST to ensure labels are available before auto-classification
          await loadReviewState();
          // Then load files (skip auto-classify) and other data in parallel
          await Promise.all([loadFiles(true), loadAllFiles(), loadGitStatus()]);
          // Now trigger auto-classification with the loaded review state
          triggerAutoClassification();
        } catch (err) {
          console.error("Failed to load data:", err);
        } finally {
          setInitialLoading(false);
        }
      };
      loadData();
    }
  }, [
    repoPath,
    comparisonReady,
    showStartScreen,
    comparison.key,
    loadFiles,
    loadAllFiles,
    loadReviewState,
    loadGitStatus,
    triggerAutoClassification,
  ]);

  // Sidebar resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      // Calculate width based on sidebar position
      // Get the root font size to convert pixels to rem
      const rootFontSize = parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const pixelWidth =
        sidebarPosition === "left" ? e.clientX : window.innerWidth - e.clientX;
      // Convert to rem and clamp between 13.33rem (200px) and 40rem (600px)
      const newWidth = Math.max(13.33, Math.min(40, pixelWidth / rootFontSize));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [sidebarPosition]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't capture keys when typing in inputs
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Cmd/Ctrl+O to open repository
      if ((event.metaKey || event.ctrlKey) && event.key === "o") {
        event.preventDefault();
        handleOpenRepo();
        return;
      }

      // Cmd/Ctrl+Shift+D to open debug modal
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "d"
      ) {
        event.preventDefault();
        setShowDebugModal(true);
        return;
      }

      // Cmd/Ctrl+, to open settings modal
      if ((event.metaKey || event.ctrlKey) && event.key === ",") {
        event.preventDefault();
        setShowSettingsModal(true);
        return;
      }

      // Cmd/Ctrl+P to open file finder
      if ((event.metaKey || event.ctrlKey) && event.key === "p") {
        event.preventDefault();
        setShowFileFinder(true);
        return;
      }

      // Escape to close split view (only when split is active)
      if (event.key === "Escape" && secondaryFile !== null) {
        event.preventDefault();
        closeSplit();
        return;
      }

      // Cmd/Ctrl+Shift+\ to toggle split orientation
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key === "\\"
      ) {
        event.preventDefault();
        setSplitOrientation(
          splitOrientation === "horizontal" ? "vertical" : "horizontal",
        );
        return;
      }

      // Cmd/Ctrl++ to increase font size
      if (
        (event.metaKey || event.ctrlKey) &&
        (event.key === "=" || event.key === "+")
      ) {
        event.preventDefault();
        const newSize = Math.min(
          codeFontSize + CODE_FONT_SIZE_STEP,
          CODE_FONT_SIZE_MAX,
        );
        setCodeFontSize(newSize);
        return;
      }

      // Cmd/Ctrl+- to decrease font size
      if ((event.metaKey || event.ctrlKey) && event.key === "-") {
        event.preventDefault();
        const newSize = Math.max(
          codeFontSize - CODE_FONT_SIZE_STEP,
          CODE_FONT_SIZE_MIN,
        );
        setCodeFontSize(newSize);
        return;
      }

      // Cmd/Ctrl+0 to reset font size to default
      if ((event.metaKey || event.ctrlKey) && event.key === "0") {
        event.preventDefault();
        setCodeFontSize(CODE_FONT_SIZE_DEFAULT);
        return;
      }

      switch (event.key) {
        case "r":
          // Toggle view mode
          setMainViewMode(mainViewMode === "single" ? "rolling" : "single");
          break;
        case "j":
          // Navigate to next hunk (handles file switching automatically)
          nextHunk();
          break;
        case "k":
          // Navigate to previous hunk (handles file switching automatically)
          prevHunk();
          break;
        case "ArrowDown":
          if (event.metaKey || event.ctrlKey) {
            nextFile();
            event.preventDefault();
          }
          break;
        case "ArrowUp":
          if (event.metaKey || event.ctrlKey) {
            prevFile();
            event.preventDefault();
          }
          break;
        case "]":
          nextFile();
          break;
        case "[":
          prevFile();
          break;
      }
    },
    [
      nextFile,
      prevFile,
      nextHunk,
      prevHunk,
      handleOpenRepo,
      codeFontSize,
      setCodeFontSize,
      secondaryFile,
      closeSplit,
      setSplitOrientation,
      splitOrientation,
      mainViewMode,
      setMainViewMode,
    ],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Refs for menu event handlers to avoid stale closures
  const handleOpenRepoRef = useRef(handleOpenRepo);
  const handleRefreshRef = useRef(handleRefresh);
  const codeFontSizeRef = useRef(codeFontSize);
  const setCodeFontSizeRef = useRef(setCodeFontSize);
  useEffect(() => {
    handleOpenRepoRef.current = handleOpenRepo;
    handleRefreshRef.current = handleRefresh;
    codeFontSizeRef.current = codeFontSize;
    setCodeFontSizeRef.current = setCodeFontSize;
  }, [handleOpenRepo, handleRefresh, codeFontSize, setCodeFontSize]);

  // Listen for menu events (setup once, use refs to avoid re-subscribing)
  useEffect(() => {
    const platform = getPlatformServices();
    const unlistenFns: (() => void)[] = [];

    unlistenFns.push(
      platform.menuEvents.on("menu:open-repo", () => {
        handleOpenRepoRef.current();
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:show-debug", () => {
        setShowDebugModal(true);
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:open-settings", () => {
        setShowSettingsModal(true);
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:refresh", () => {
        handleRefreshRef.current();
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:zoom-in", () => {
        setCodeFontSizeRef.current(
          Math.min(
            codeFontSizeRef.current + CODE_FONT_SIZE_STEP,
            CODE_FONT_SIZE_MAX,
          ),
        );
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:zoom-out", () => {
        setCodeFontSizeRef.current(
          Math.max(
            codeFontSizeRef.current - CODE_FONT_SIZE_STEP,
            CODE_FONT_SIZE_MIN,
          ),
        );
      }),
    );

    unlistenFns.push(
      platform.menuEvents.on("menu:zoom-reset", () => {
        setCodeFontSizeRef.current(CODE_FONT_SIZE_DEFAULT);
      }),
    );

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, []); // Empty deps - setup once, use refs for current values

  // Start file watcher when repo is loaded
  useEffect(() => {
    if (!repoPath) return;

    const apiClient = getApiClient();
    console.log("[watcher] Starting file watcher for", repoPath);
    apiClient
      .startFileWatcher(repoPath)
      .then(() => console.log("[watcher] File watcher started for", repoPath))
      .catch((err: unknown) =>
        console.error("[watcher] Failed to start file watcher:", err),
      );

    return () => {
      console.log("[watcher] Stopping file watcher for", repoPath);
      apiClient.stopFileWatcher(repoPath).catch(() => {});
    };
  }, [repoPath]);

  // Listen for file watcher events
  // Use refs to avoid stale closures in event handlers
  const repoPathRef = useRef(repoPath);
  const loadReviewStateRef = useRef(loadReviewState);
  const refreshRef = useRef(refresh);
  const comparisonReadyRef = useRef(comparisonReady);
  useEffect(() => {
    repoPathRef.current = repoPath;
    loadReviewStateRef.current = loadReviewState;
    refreshRef.current = refresh;
    comparisonReadyRef.current = comparisonReady;
  }, [repoPath, loadReviewState, refresh, comparisonReady]);

  useEffect(() => {
    if (!repoPath) return;

    const apiClient = getApiClient();
    const unlistenFns: (() => void)[] = [];

    // Review state changed externally
    unlistenFns.push(
      apiClient.onReviewStateChanged((eventRepoPath) => {
        console.log(
          "[watcher] Received review-state-changed event:",
          eventRepoPath,
        );
        if (eventRepoPath === repoPathRef.current) {
          console.log("[watcher] Reloading review state...");
          loadReviewStateRef.current();
        }
      }),
    );
    console.log("[watcher] Listening for review-state-changed");

    // Git state changed (branch switch, new commit, etc.)
    unlistenFns.push(
      apiClient.onGitChanged((eventRepoPath) => {
        console.log("[watcher] Received git-changed event:", eventRepoPath);
        if (eventRepoPath === repoPathRef.current) {
          // Only refresh if a comparison has been selected (not on start screen)
          if (!comparisonReadyRef.current) {
            console.log("[watcher] Skipping refresh - no comparison selected");
            return;
          }
          console.log("[watcher] Refreshing...");
          refreshRef.current();
        }
      }),
    );
    console.log("[watcher] Listening for git-changed");

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, [repoPath]);

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

  if (!repoPath) {
    return (
      <div className="flex h-screen items-center justify-center bg-stone-950">
        <div className="flex flex-col items-center gap-4 animate-fade-in">
          <div className="h-8 w-8 rounded-full border-2 border-stone-700 border-t-lime-500 animate-spin" />
          <p className="text-stone-400">Loading repository...</p>
        </div>
      </div>
    );
  }

  // Show start screen when no comparison is selected
  if (showStartScreen) {
    return (
      <StartScreen
        repoPath={repoPath}
        onSelectReview={handleSelectReview}
        onOpenRepo={handleOpenRepo}
      />
    );
  }

  // Show loading indicator during initial load
  if (initialLoading) {
    const progressText = loadingProgress
      ? loadingProgress.phase === "files"
        ? "Finding changed files..."
        : loadingProgress.phase === "hunks"
          ? `Loading file ${loadingProgress.current} of ${loadingProgress.total}...`
          : "Detecting moved code..."
      : "Loading review...";

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
        <ComparisonHeader comparison={comparison} onBack={handleBackToStart} />

        {/* Progress indicator and Trust button */}
        <div className="flex items-center gap-3">
          {totalHunks > 0 ? (
            <div className="group relative flex items-center gap-2">
              <span className="text-xs text-stone-500">Reviewed</span>
              <span className="font-mono text-xs tabular-nums text-stone-400">
                {reviewedHunks}/{totalHunks}
              </span>
              <div className="progress-bar w-24">
                {/* Trusted segment (left) */}
                <div
                  className="progress-bar-trusted"
                  style={{ width: `${(trustedHunks / totalHunks) * 100}%` }}
                />
                {/* Approved segment (right of trusted) */}
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
            <span className="text-xs text-stone-500">Nothing to review</span>
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
              title="Single file view (r)"
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
              title="Rolling view - all files (r)"
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
            <FilesPanel />
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
            <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
              [
            </kbd>
            <span className="mx-0.5">/</span>
            <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
              ]
            </kbd>
            <span className="ml-1">files</span>
          </span>
          <span>
            <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
              r
            </kbd>
            <span className="ml-1">view</span>
          </span>
          <span>
            <kbd className="rounded bg-stone-800 px-1 py-0.5 text-xxs text-stone-500">
              {"\u2318"}P
            </kbd>
            <span className="ml-1">find</span>
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

      {/* File Finder */}
      <FileFinder
        isOpen={showFileFinder}
        onClose={() => setShowFileFinder(false)}
      />
    </div>
  );
}

export default App;
