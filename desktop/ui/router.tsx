import { Suspense, lazy, useCallback, useEffect, useMemo, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useNavigate,
  useOutletContext,
} from "react-router-dom";
import { toast } from "sonner";
import { TabRail } from "./components/TabRail";
import { ReviewView } from "./components/ReviewView";
import { NewReviewView } from "./components/NewReviewView";
import { TooltipProvider } from "./components/ui/tooltip";
import { useReviewStore } from "./stores";
import { getSidebarTree } from "./stores/selectors/sidebar";
import { activateSidebarRow, allSidebarRows } from "./utils/sidebar-tree";
import { makeReviewKey } from "./utils/review-key";
import { getErrorMessage } from "./utils/errors";
import { prReviewTarget, type ReviewTarget, type ViewerPr } from "./types";
import {
  useRepositoryInit,
  useComparisonLoader,
  useWindowTitle,
  useFileRouteSync,
  useMenuState,
  useRepoActivitySync,
  useTerminalCheckoutSync,
  useViewerPrsSync,
  usePollWhileVisible,
  type RepoStatus,
} from "./hooks";
import { useReviewFreshness } from "./hooks/useReviewFreshness";
import {
  APP_COMMANDS,
  reviewCommands,
  useRegisterCommands,
  useCommandDispatch,
} from "./commands";
import { useProvideCommandUi } from "./commands/host";
import { Palette } from "./components/palette";

const SettingsModal = lazy(() =>
  import("./components/modals/SettingsModal").then((m) => ({
    default: m.SettingsModal,
  })),
);

const ACTIVITY_POLL_MS = 300_000;

/**
 * AppShell — layout wrapper that provides global effects and the ?repo= bootstrap.
 * Renders <Outlet /> for child routes.
 */
function AppShell() {
  const navigate = useNavigate();
  const activeOverlay = useReviewStore((s) => s.activeOverlay);
  const closeOverlay = useReviewStore((s) => s.closeOverlay);
  const loadGlobalReviews = useReviewStore((s) => s.loadGlobalReviews);
  const loadLocalActivity = useReviewStore((s) => s.loadLocalActivity);

  useEffect(() => {
    loadGlobalReviews();
    loadLocalActivity();
  }, [loadGlobalReviews, loadLocalActivity]);

  // Backstop poll for working-tree edits in non-active repos — their
  // lightweight watchers only see git metadata. Paused while hidden since
  // snapshotting every registered repo isn't free.
  usePollWhileVisible(loadLocalActivity, ACTIVITY_POLL_MS);

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
    handleActivateLocalBranch,
    handleNewReview,
    handleStartReview,
  } = useRepositoryInit();

  /**
   * Open a PR the sidebar surfaced but nothing local represents yet.
   *
   * The same path the comparison picker takes for a PR row — fetch the head,
   * write the review with its `githubPr`, resolve, navigate. Sharing it is the
   * point: a review started from the sidebar has to be indistinguishable from
   * one started from the picker, or the ephemeral row would produce a second
   * kind of PR review with its own quirks.
   */
  const handleActivateOpenPr = useCallback(
    (pr: ViewerPr) => {
      if (pr.repoPath == null) return;
      void handleStartReview(pr.repoPath, prReviewTarget(pr)).catch((err) => {
        console.error("Failed to open PR:", err);
        toast.error(`Couldn't open #${pr.number}: ${getErrorMessage(err)}`);
      });
    },
    [handleStartReview],
  );

  // Stable refs so the effect doesn't re-register on every render
  const handleOpenRepoRef = useRef(handleOpenRepo);
  handleOpenRepoRef.current = handleOpenRepo;
  const activateReviewRef = useRef(handleActivateReview);
  activateReviewRef.current = handleActivateReview;
  const activateLocalBranchRef = useRef(handleActivateLocalBranch);
  activateLocalBranchRef.current = handleActivateLocalBranch;
  const activateOpenPrRef = useRef(handleActivateOpenPr);
  activateOpenPrRef.current = handleActivateOpenPr;

  // The app's commands, and the shell-level actions they need. Shortcuts are
  // dispatched here rather than by the native menu, so they work identically
  // in the desktop app and in web mode (which has no native menu at all).
  useRegisterCommands(APP_COMMANDS);
  useRegisterCommands(reviewCommands);
  useProvideCommandUi(
    useMemo(
      () => ({
        openRepo: () => handleOpenRepoRef.current(),
        newWindow: () => handleNewWindow(),
        navigate: (to: string) => navigate(to),
        // Activate by key the way the sidebar would: find the row and use its
        // own kind's handler, so a review row resolves its stored base and a
        // bare branch goes through read-only-preview detection. A key with no
        // row (rare — e.g. the sidebar hasn't loaded that repo yet) still
        // opens as a local branch rather than doing nothing.
        activateReviewKey: (repoPath: string, ref: string) => {
          const state = useReviewStore.getState();
          const key = makeReviewKey(repoPath, ref);
          const tree = getSidebarTree(state, Date.now(), state.repoPath);
          const row = allSidebarRows(tree).find((r) => r.reviewKey === key);
          if (row) {
            activateSidebarRow(row, {
              onActivateReview: (review) =>
                void activateReviewRef.current(review).catch((err) => {
                  // Resolving the review can fail — its ref or worktree may be
                  // gone — and nothing has navigated yet, so an unhandled
                  // rejection leaves the click looking like a no-op.
                  console.error("Failed to open review:", err);
                  toast.error(
                    `Couldn't open ${review.ref}: ${getErrorMessage(err)}`,
                  );
                }),
              onActivateLocalBranch: (...args) =>
                activateLocalBranchRef.current(...args),
              onActivateOpenPr: (pr) => activateOpenPrRef.current(pr),
            });
            return;
          }
          activateLocalBranchRef.current(repoPath, ref, "");
        },
      }),
      [handleNewWindow, navigate],
    ),
  );
  useCommandDispatch();

  useMenuState();
  useReviewFreshness();
  useRepoActivitySync();
  useTerminalCheckoutSync();
  useViewerPrsSync();

  useComparisonLoader(comparisonReady, setInitialLoading);

  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);

  useWindowTitle(repoPath, comparison, comparisonReady);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-screen">
        {/* Left sidebar */}
        <TabRail
          onActivateReview={handleActivateReview}
          onActivateLocalBranch={handleActivateLocalBranch}
          onActivateOpenPr={handleActivateOpenPr}
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
              handleNewReview,
              handleStartReview,
            }}
          />
        </div>
      </div>

      {activeOverlay === "settings" && (
        <Suspense fallback={null}>
          <SettingsModal isOpen onClose={() => closeOverlay("settings")} />
        </Suspense>
      )}

      {/* Mounted at the shell, not inside the review screen, so ⌘K still
          offers "Open Repository" and "New Review" with nothing open. */}
      <Palette />
    </TooltipProvider>
  );
}

interface AppContext {
  repoStatus: RepoStatus;
  repoError: string | null;
  repoPath: string | null;
  comparisonReady: number;
  handleOpenRepo: () => Promise<void>;
  handleNewWindow: () => Promise<void>;
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => Promise<void>;
  handleNewReview: (path: string, target: ReviewTarget) => Promise<void>;
  handleStartReview: (path: string, target: ReviewTarget) => Promise<void>;
}

export function useAppContext() {
  return useOutletContext<AppContext>();
}

/** Empty state — shown at "/" when no tab is active */
function EmptyTabState() {
  const { repoStatus, repoError, handleOpenRepo, handleNewReview } =
    useAppContext();
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  if (repoStatus === "error") {
    return (
      <div className="flex h-full items-center justify-center">
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

  // Show the inline new-review form as the onboarding experience when
  // there are no reviews (after loading completes)
  if (!globalReviewsLoading && globalReviews.length === 0) {
    return <NewReviewView onNewReview={handleNewReview} />;
  }

  return (
    <div className="relative flex h-full items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-center px-6">
        <p className="text-sm text-fg-muted">
          Select a review from the sidebar, or start a new one
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

/** New review — shown at "/new" */
function NewReviewRoute() {
  const { handleNewReview } = useAppContext();
  return <NewReviewView onNewReview={handleNewReview} />;
}

/** Review UI — shown at /:owner/:repo/review/:ref (ref is encodeURIComponent-encoded) */
function ReviewRoute() {
  const { repoPath, comparisonReady, handleStartReview } = useAppContext();

  useFileRouteSync();

  if (!repoPath) {
    return <Navigate to="/" replace />;
  }

  return (
    <ReviewView
      comparisonReady={comparisonReady}
      onStartReview={handleStartReview}
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
          <Route path="/new" element={<NewReviewRoute />} />
          <Route path="/:owner/:repo/browse/*" element={<ReviewRoute />} />
          <Route path="/:owner/:repo/review/:ref/*" element={<ReviewRoute />} />
          <Route path="/standalone/browse/*" element={<ReviewRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
