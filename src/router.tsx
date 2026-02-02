import { useEffect, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useOutletContext,
} from "react-router-dom";
import type { Comparison } from "./types";
import { WelcomePage } from "./components/WelcomePage";
import { StartScreen } from "./components/StartScreen";
import { getPlatformServices } from "./platform";
import { ReviewView } from "./components/ReviewView";
import { TooltipProvider } from "./components/ui/tooltip";
import { useReviewStore } from "./stores";
import {
  useRepositoryInit,
  useGlobalShortcut,
  useComparisonLoader,
  useWindowTitle,
  useFileRouteSync,
  type RepoStatus,
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

/**
 * AppShell — layout wrapper that provides global effects and the ?repo= bootstrap.
 * Renders <Outlet /> for child routes.
 */
function AppShell() {
  const loadPreferences = useReviewStore((s) => s.loadPreferences);
  const checkClaudeAvailable = useReviewStore((s) => s.checkClaudeAvailable);

  // Load preferences on mount
  useEffect(() => {
    loadPreferences();
    checkClaudeAvailable();
  }, [loadPreferences, checkClaudeAvailable]);

  // Global shortcuts
  useGlobalShortcut();

  const {
    repoStatus,
    repoError,
    comparisonReady,
    initialLoading,
    setInitialLoading,
    handleSelectReview,
    handleBackToStart,
    handleOpenRepo,
    handleNewWindow,
    handleCloseRepo,
    handleSelectRepo,
  } = useRepositoryInit();

  // Global Cmd+O and menu:open-repo listener so it works on every route
  const handleOpenRepoRef = useRef(handleOpenRepo);
  handleOpenRepoRef.current = handleOpenRepo;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.key === "o" &&
        !(e.target instanceof HTMLInputElement) &&
        !(e.target instanceof HTMLTextAreaElement)
      ) {
        e.preventDefault();
        handleOpenRepoRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const platform = getPlatformServices();
    const unlistenMenu = platform.menuEvents.on("menu:open-repo", () => {
      handleOpenRepoRef.current();
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlistenMenu();
    };
  }, []);

  useComparisonLoader(comparisonReady, setInitialLoading);

  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const loadingProgress = useReviewStore((s) => s.loadingProgress);

  // Update window title on every route (welcome, start, review)
  useWindowTitle(repoPath, comparison, comparisonReady);

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

  return (
    <TooltipProvider delayDuration={300}>
      <Outlet
        context={{
          repoStatus,
          repoError,
          repoPath,
          comparisonReady,
          initialLoading,
          setInitialLoading,
          loadingProgress,
          handleSelectReview,
          handleBackToStart,
          handleOpenRepo,
          handleNewWindow,
          handleCloseRepo,
          handleSelectRepo,
        }}
      />
    </TooltipProvider>
  );
}

interface AppContext {
  repoStatus: RepoStatus;
  repoError: string | null;
  repoPath: string | null;
  comparisonReady: boolean;
  initialLoading: boolean;
  setInitialLoading: (loading: boolean) => void;
  loadingProgress: { phase: string; current: number; total: number } | null;
  handleSelectReview: (comparison: Comparison) => void;
  handleBackToStart: () => void;
  handleOpenRepo: () => Promise<void>;
  handleNewWindow: () => Promise<void>;
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => void;
}

function useAppContext() {
  return useOutletContext<AppContext>();
}

/** Welcome page — shown at "/" when no repo is loaded */
function WelcomeRoute() {
  const { repoStatus, repoError, handleOpenRepo, handleSelectRepo } =
    useAppContext();

  // If repo is loaded but we're on "/", that's fine — the init hook
  // will navigate us away once it resolves the route prefix.

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

  return (
    <WelcomePage onOpenRepo={handleOpenRepo} onSelectRepo={handleSelectRepo} />
  );
}

/** Start screen — shown at /:owner/:repo */
function StartRoute() {
  const { repoPath, handleSelectReview, handleCloseRepo } = useAppContext();

  // If no repo path resolved yet, redirect to welcome
  if (!repoPath) {
    return <Navigate to="/" replace />;
  }

  return (
    <StartScreen
      repoPath={repoPath}
      onSelectReview={handleSelectReview}
      onCloseRepo={handleCloseRepo}
    />
  );
}

/** Review UI — shown at /:owner/:repo/review/:comparisonKey */
function ReviewRoute() {
  const {
    repoPath,
    comparisonReady,
    initialLoading,
    loadingProgress,
    handleBackToStart,
    handleOpenRepo,
    handleNewWindow,
  } = useAppContext();

  // Bidirectional sync between URL file path and store
  useFileRouteSync();

  // If no repo path, redirect to welcome
  if (!repoPath) {
    return <Navigate to="/" replace />;
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
    <ReviewView
      onBack={handleBackToStart}
      onOpenRepo={handleOpenRepo}
      onNewWindow={handleNewWindow}
      comparisonReady={comparisonReady}
    />
  );
}

/** The root router component */
export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route path="/" element={<WelcomeRoute />} />
          <Route path="/:owner/:repo" element={<StartRoute />} />
          <Route
            path="/:owner/:repo/review/:comparisonKey/*"
            element={<ReviewRoute />}
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
