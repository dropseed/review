import { useEffect, useCallback, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FileTree } from "./components/FileTree";
import { CodeViewer } from "./components/CodeViewer";
import { ReviewFilePanel } from "./components/ReviewFilePanel";
import { ComparisonSelector } from "./components/ComparisonSelector";
import { DebugModal } from "./components/DebugModal";
import { TrustPatternsPanel } from "./components/TrustPatternsPanel";
import { useReviewStore } from "./stores/reviewStore";

// Get repo path from URL query parameter (for multi-window support)
function getRepoPathFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("repo");
}

type SidebarMode = "review" | "files" | "trust";

function App() {
  const {
    repoPath,
    setRepoPath,
    selectedFile,
    setSelectedFile,
    files,
    comparison,
    setComparison,
    loadFiles,
    loadAllFiles,
    loadReviewState,
    loadCurrentComparison,
    reviewState,
    hunks,
    nextFile,
    prevFile,
    nextHunk,
    prevHunk,
    sidebarPosition,
    setSidebarPosition,
    loadPreferences,
    revealFileInTree,
    refresh,
  } = useReviewStore();

  const [isRefreshing, setIsRefreshing] = useState(false);

  const [sidebarMode, setSidebarMode] = useState<SidebarMode>("review");
  const [sidebarWidth, setSidebarWidth] = useState(288); // 18rem = 288px
  const [showDebugModal, setShowDebugModal] = useState(false);
  const isResizing = useRef(false);

  // Reveal file in the files panel
  const handleRevealInTree = useCallback((path: string) => {
    setSidebarMode("files");
    revealFileInTree(path);
  }, [revealFileInTree]);

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
  }, [loadPreferences]);

  // Register global shortcut to focus the app (Cmd/Ctrl+Shift+R)
  useEffect(() => {
    const shortcut = "CommandOrControl+Shift+R";

    const registerShortcut = async () => {
      try {
        await register(shortcut, async () => {
          const window = getCurrentWindow();
          await window.show();
          await window.setFocus();
        });
      } catch (err) {
        // Shortcut may already be registered or in use
        console.debug("Global shortcut registration skipped:", err);
      }
    };

    registerShortcut();

    return () => {
      unregister(shortcut).catch(() => {});
    };
  }, []);

  useEffect(() => {
    // Check URL for repo path first (multi-window support)
    const urlRepoPath = getRepoPathFromUrl();
    if (urlRepoPath) {
      setRepoPath(urlRepoPath);
      return;
    }

    // Fall back to getting current working directory from Tauri
    invoke<string>("get_current_repo")
      .then((path) => {
        setRepoPath(path);
      })
      .catch(console.error);
  }, [setRepoPath]);

  // Open a new window with a different repository
  const handleOpenRepo = useCallback(async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Open Repository",
      });

      if (selected && typeof selected === "string") {
        // Open in a new window
        await invoke("open_repo_window", { repoPath: selected });
      }
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, []);

  // Load current comparison when repo path changes
  useEffect(() => {
    if (repoPath) {
      loadCurrentComparison();
    }
  }, [repoPath, loadCurrentComparison]);

  // Load files and review state when repo path or comparison changes
  useEffect(() => {
    if (repoPath) {
      const loadData = async () => {
        try {
          await Promise.all([loadFiles(), loadAllFiles(), loadReviewState()]);
        } catch (err) {
          console.error("Failed to load data:", err);
        }
      };
      loadData();
    }
  }, [repoPath, comparison.key, loadFiles, loadAllFiles, loadReviewState]);

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
      const newWidth = sidebarPosition === "left"
        ? Math.max(200, Math.min(600, e.clientX))
        : Math.max(200, Math.min(600, window.innerWidth - e.clientX));
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
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === "d") {
        event.preventDefault();
        setShowDebugModal(true);
        return;
      }

      switch (event.key) {
        case "j":
          nextHunk();
          break;
        case "k":
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
    [nextFile, prevFile, nextHunk, prevHunk, handleOpenRepo]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  // Listen for menu events
  useEffect(() => {
    const unlistenFns: (() => void)[] = [];

    listen("menu:open-repo", () => {
      handleOpenRepo();
    })
      .then((fn) => unlistenFns.push(fn))
      .catch((err) => console.error("Failed to listen for menu:open-repo:", err));

    listen<string>("menu:sidebar-position", (event) => {
      if (event.payload === "left" || event.payload === "right") {
        setSidebarPosition(event.payload);
      }
    })
      .then((fn) => unlistenFns.push(fn))
      .catch((err) => console.error("Failed to listen for menu:sidebar-position:", err));

    listen("menu:show-debug", () => {
      setShowDebugModal(true);
    })
      .then((fn) => unlistenFns.push(fn))
      .catch((err) => console.error("Failed to listen for menu:show-debug:", err));

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, [handleOpenRepo, setSidebarPosition]);

  // Start file watcher when repo is loaded
  useEffect(() => {
    if (!repoPath) return;

    console.log("[watcher] Starting file watcher for", repoPath);
    invoke("start_file_watcher", { repoPath })
      .then(() => console.log("[watcher] File watcher started for", repoPath))
      .catch((err) => console.error("[watcher] Failed to start file watcher:", err));

    return () => {
      console.log("[watcher] Stopping file watcher for", repoPath);
      invoke("stop_file_watcher", { repoPath }).catch(() => {});
    };
  }, [repoPath]);

  // Listen for file watcher events
  useEffect(() => {
    if (!repoPath) return;

    const unlistenFns: (() => void)[] = [];

    // Review state changed externally
    listen<string>("review-state-changed", (event) => {
      console.log("[watcher] Received review-state-changed event:", event.payload);
      if (event.payload === repoPath) {
        console.log("[watcher] Reloading review state...");
        loadReviewState();
      }
    })
      .then((fn) => {
        console.log("[watcher] Listening for review-state-changed");
        unlistenFns.push(fn);
      })
      .catch((err) => console.error("[watcher] Failed to listen for review-state-changed:", err));

    // Git state changed (branch switch, new commit, etc.)
    listen<string>("git-changed", (event) => {
      console.log("[watcher] Received git-changed event:", event.payload);
      if (event.payload === repoPath) {
        console.log("[watcher] Refreshing...");
        refresh();
      }
    })
      .then((fn) => {
        console.log("[watcher] Listening for git-changed");
        unlistenFns.push(fn);
      })
      .catch((err) => console.error("[watcher] Failed to listen for git-changed:", err));

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, [repoPath, loadReviewState, refresh]);

  // Calculate review progress
  const totalHunks = hunks.length;
  const trustedHunks = reviewState
    ? Object.values(reviewState.hunks).filter((h) => h.approvedVia === "trust").length
    : 0;
  const approvedHunks = reviewState
    ? Object.values(reviewState.hunks).filter((h) => h.approvedVia === "manual" || h.approvedVia === "ai").length
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

  const repoName = repoPath.split("/").pop() || "Repository";

  return (
    <div className="flex h-screen flex-col bg-stone-950">
      {/* Header */}
      <header className="flex h-12 items-center justify-between border-b border-stone-800 bg-stone-900 px-4">
        <div className="flex items-center gap-4">
          {/* Repo name */}
          <h1 className="text-sm font-medium text-stone-100">
            {repoName}
          </h1>

          {/* Comparison selector */}
          <ComparisonSelector repoPath={repoPath} value={comparison} onChange={setComparison} />

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="p-1.5 rounded-md text-stone-400 hover:text-stone-200 hover:bg-stone-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            title="Refresh (reload files and review state)"
          >
            <svg
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
              <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
              <path d="M16 21h5v-5" />
            </svg>
          </button>
        </div>

        {/* Progress indicator */}
        {totalHunks > 0 && (
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
                  left: `${(trustedHunks / totalHunks) * 100}%`
                }}
              />
            </div>
            {/* Hover tooltip */}
            <div className="absolute top-full right-0 mt-1 hidden group-hover:block
                            bg-stone-900 border border-stone-700 rounded px-2 py-1.5
                            text-xs whitespace-nowrap z-50 shadow-lg">
              <div className="flex items-center gap-2 mb-1">
                <span className="w-2 h-2 rounded-full bg-sky-500" />
                <span className="text-stone-300">Trusted: {trustedHunks}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-lime-500" />
                <span className="text-stone-300">Approved: {approvedHunks}</span>
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Main content */}
      <div className={`flex flex-1 overflow-hidden ${sidebarPosition === "right" ? "flex-row-reverse" : "flex-row"}`}>
        {/* Sidebar */}
        <aside
          className={`relative flex flex-shrink-0 flex-col bg-stone-900 ${
            sidebarPosition === "right" ? "border-l border-stone-800" : "border-r border-stone-800"
          }`}
          style={{ width: sidebarWidth }}
        >
          {/* Sidebar mode toggle */}
          <div className="flex border-b border-stone-800">
            <button
              onClick={() => setSidebarMode("review")}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                sidebarMode === "review"
                  ? "border-b-2 border-lime-500 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Review
            </button>
            <button
              onClick={() => setSidebarMode("files")}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                sidebarMode === "files"
                  ? "border-b-2 border-lime-500 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              All Files
            </button>
            <button
              onClick={() => setSidebarMode("trust")}
              className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
                sidebarMode === "trust"
                  ? "border-b-2 border-lime-500 text-stone-100"
                  : "text-stone-500 hover:text-stone-300"
              }`}
            >
              Trust
            </button>
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-y-auto scrollbar-thin">
            {sidebarMode === "review" ? (
              <ReviewFilePanel
                files={files}
                reviewState={reviewState}
                selectedFile={selectedFile}
                onSelectFile={setSelectedFile}
                onRevealInTree={handleRevealInTree}
                hunks={hunks}
              />
            ) : sidebarMode === "files" ? (
              <FileTree repoPath={repoPath} />
            ) : (
              <TrustPatternsPanel />
            )}
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
        <main className="flex flex-1 flex-col overflow-hidden bg-stone-950">
          {selectedFile ? (
            <CodeViewer filePath={selectedFile} />
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-3">
              <svg className="h-12 w-12 text-stone-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
              <p className="text-sm text-stone-500">Select a file to review</p>
              <p className="text-xs text-stone-600">
                <kbd>j</kbd>/<kbd>k</kbd> hunks · <kbd>[</kbd>/<kbd>]</kbd> files
              </p>
            </div>
          )}
        </main>
      </div>

      {/* Debug Modal */}
      <DebugModal isOpen={showDebugModal} onClose={() => setShowDebugModal(false)} />
    </div>
  );
}

export default App;
