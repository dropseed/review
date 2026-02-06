import { useEffect, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useOutletContext,
} from "react-router-dom";
import { UpdateBanner } from "./components/UpdateBanner";
import { TabRail } from "./components/TabRail";
import { getPlatformServices } from "./platform";
import { ReviewView } from "./components/ReviewView";
import { TooltipProvider } from "./components/ui/tooltip";
import { useReviewStore } from "./stores";
import {
  useRepositoryInit,
  useComparisonLoader,
  useWindowTitle,
  useFileRouteSync,
  useMenuState,
  type RepoStatus,
} from "./hooks";

/**
 * AppShell — layout wrapper that provides global effects and the ?repo= bootstrap.
 * Renders <Outlet /> for child routes.
 */
function AppShell() {
  const loadPreferences = useReviewStore((s) => s.loadPreferences);
  const loadOpenReviews = useReviewStore((s) => s.loadOpenReviews);
  const checkClaudeAvailable = useReviewStore((s) => s.checkClaudeAvailable);

  // Load preferences and tab state on mount
  useEffect(() => {
    loadPreferences();
    loadOpenReviews();
    checkClaudeAvailable();
  }, [loadPreferences, loadOpenReviews, checkClaudeAvailable]);

  const {
    repoStatus,
    repoError,
    comparisonReady,
    setInitialLoading,
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
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // Cmd/Ctrl+O to open repo
      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
        e.preventDefault();
        handleOpenRepoRef.current();
        return;
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

  // Keep native menu item enabled/disabled state in sync with the app view
  useMenuState();

  useComparisonLoader(comparisonReady, setInitialLoading);

  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);

  // Update window title on every route (welcome, start, review)
  useWindowTitle(repoPath, comparison, comparisonReady);

  return (
    <TooltipProvider delayDuration={300}>
      <UpdateBanner />
      <div className="flex h-screen">
        <TabRail onOpenRepo={handleOpenRepo} />
        <div className="flex flex-1 flex-col overflow-hidden bg-stone-950">
          <Outlet
            context={{
              repoStatus,
              repoError,
              repoPath,
              comparisonReady,
              handleOpenRepo,
              handleNewWindow,
              handleCloseRepo,
              handleSelectRepo,
            }}
          />
        </div>
      </div>
    </TooltipProvider>
  );
}

interface AppContext {
  repoStatus: RepoStatus;
  repoError: string | null;
  repoPath: string | null;
  comparisonReady: boolean;
  handleOpenRepo: () => Promise<void>;
  handleNewWindow: () => Promise<void>;
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => void;
}

function useAppContext() {
  return useOutletContext<AppContext>();
}

/** Empty state — shown at "/" when no tab is active */
function EmptyTabState() {
  const { repoStatus, repoError, handleOpenRepo } = useAppContext();

  if (repoStatus === "error") {
    return (
      <div className="flex h-full items-center justify-center">
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
            className="mt-4 px-4 py-2 rounded-lg bg-stone-800 text-stone-200 text-sm font-medium hover:bg-stone-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 transition-colors duration-150"
          >
            Open a Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <p className="text-sm text-stone-500">
          Open a repository to start reviewing
        </p>
        <p className="text-2xs text-stone-600">
          <kbd className="rounded bg-stone-800 px-1.5 py-0.5 text-xxs text-stone-500 font-mono">
            {"\u2318"}O
          </kbd>
          <span className="ml-1.5">to open a folder</span>
        </p>
      </div>
    </div>
  );
}

/** Review UI — shown at /:owner/:repo/review/:comparisonKey */
function ReviewRoute() {
  const { repoPath, comparisonReady, handleOpenRepo, handleNewWindow } =
    useAppContext();

  // Bidirectional sync between URL file path and store
  useFileRouteSync();

  // If no repo path, redirect to welcome
  if (!repoPath) {
    return <Navigate to="/" replace />;
  }

  return (
    <ReviewView
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
          <Route path="/" element={<EmptyTabState />} />
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
