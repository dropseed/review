import { useEffect, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useOutletContext,
} from "react-router-dom";
import { TabRail } from "./components/TabRail";
import { SidebarPanelIcon } from "./components/ui/icons";
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
import { useReviewFreshness } from "./hooks/useReviewFreshness";

/**
 * AppShell — layout wrapper that provides global effects and the ?repo= bootstrap.
 * Renders <Outlet /> for child routes.
 */
function AppShell() {
  const loadPreferences = useReviewStore((s) => s.loadPreferences);
  const loadGlobalReviews = useReviewStore((s) => s.loadGlobalReviews);
  const checkClaudeAvailable = useReviewStore((s) => s.checkClaudeAvailable);

  useEffect(() => {
    loadPreferences();
    loadGlobalReviews();
    checkClaudeAvailable();
  }, [loadPreferences, loadGlobalReviews, checkClaudeAvailable]);

  const {
    repoStatus,
    repoError,
    comparisonReady,
    setInitialLoading,
    handleOpenRepo,
    handleNewWindow,
    handleCloseRepo,
    handleSelectRepo,
    handleActivateReview,
    handleNewReview,
  } = useRepositoryInit();

  // Stable ref so the effect doesn't re-register on every render
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

      if ((e.metaKey || e.ctrlKey) && e.key === "o") {
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

  useMenuState();
  useReviewFreshness();

  useComparisonLoader(comparisonReady, setInitialLoading);

  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);

  useWindowTitle(repoPath, comparison, comparisonReady);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen">
        <TabRail
          onActivateReview={handleActivateReview}
          onNewReview={handleNewReview}
        />
        <div className="flex flex-1 flex-col overflow-hidden bg-surface">
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
  const tabRailCollapsed = useReviewStore((s) => s.tabRailCollapsed);
  const toggleTabRail = useReviewStore((s) => s.toggleTabRail);

  if (repoStatus === "error") {
    return (
      <div
        className="flex h-full items-center justify-center"
        data-tauri-drag-region
      >
        <div className="flex flex-col items-center gap-4 max-w-md text-center px-6">
          <div className="w-12 h-12 rounded-full bg-status-rejected/10 flex items-center justify-center">
            <svg
              className="w-6 h-6 text-status-rejected"
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
          <h1 className="text-lg font-medium text-fg-secondary">
            Failed to load repository
          </h1>
          <p className="text-sm text-fg-muted">{repoError}</p>
          <button
            onClick={handleOpenRepo}
            className="mt-4 px-4 py-2 rounded-lg bg-surface-raised text-fg-secondary text-sm font-medium hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring/50 transition-colors duration-150"
          >
            Open a Repository
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="relative flex h-full items-center justify-center"
      data-tauri-drag-region
    >
      {tabRailCollapsed && (
        <button
          type="button"
          onClick={toggleTabRail}
          className="absolute top-2.5 left-2 flex items-center justify-center w-7 h-7 rounded-md
                     hover:bg-surface-hover/60 transition-colors duration-100
                     text-fg-muted hover:text-fg-secondary"
          aria-label="Show sidebar"
        >
          <SidebarPanelIcon />
        </button>
      )}
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <p className="text-sm text-fg-muted">
          Open a repository to start reviewing
        </p>
        <p className="text-2xs text-fg-faint">
          <kbd className="rounded bg-surface-raised px-1.5 py-0.5 text-xxs text-fg-muted font-mono">
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
  const { repoPath, comparisonReady, handleNewWindow } = useAppContext();

  useFileRouteSync();

  if (!repoPath) {
    return <Navigate to="/" replace />;
  }

  return (
    <ReviewView
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
