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
import { Sidebar } from "./components/Sidebar";
import { QueueDrawer } from "./components/Sidebar/QueueDrawer";
import { CompactBar } from "./components/Stage/CompactBar";
import { CompactNavProvider } from "./components/Stage/CompactNav";
import { ReviewView } from "./components/ReviewView";
import { NewReviewView } from "./components/NewReviewView";
import { TooltipProvider } from "./components/ui/tooltip";
import { TerminalDock } from "./components/Terminal/TerminalDock";
import { EmptyStage } from "./components/Stage/EmptyStage";
import { closeFocusedTerminal } from "./components/Terminal/close";
import { useReviewStore } from "./stores";
import { useFocusedWorkspace } from "./stores/selectors/workspaces";
import { findSidebarRow } from "./stores/selectors/sidebar";
import { activateSidebarRow } from "./utils/sidebar-tree";
import { makeReviewKey } from "./utils/review-key";
import { getErrorMessage } from "./utils/errors";
import { getPlatformServices } from "./platform";
import { prReviewTarget, type ReviewTarget, type ViewerPr } from "./types";
import {
  useRepositoryInit,
  useComparisonLoader,
  useWindowTitle,
  useFileRouteSync,
  useMenuState,
  useRepoActivitySync,
  useWorkspaceSync,
  useTerminalCheckoutSync,
  useTerminalEvents,
  useTerminalFileDrop,
  useViewerPrsSync,
  usePollWhileVisible,
  useWorkspaceDeepLink,
  useAttentionBadge,
  type RepoStatus,
} from "./hooks";
import { useReviewFreshness } from "./hooks/useReviewFreshness";
import { useIsCompact } from "./hooks/useIsCompact";
import {
  STATIC_COMMANDS,
  reviewCommands,
  workspaceCommands,
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

  // The workspace queue is deliberately not here: `useWorkspaceSync` owns its
  // load lifecycle, including the watcher and the focus refresh.
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
   * one started from the picker, or a PR row would produce a second kind of PR
   * review with its own quirks.
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

  // Cascading close (terminal pane → split → file → window). Shell-level
  // because the terminal is: ⌘W over a shell means "close this shell" wherever
  // that shell is on screen, and it must not reach past it to the window.
  const handleClose = useCallback(async () => {
    if (await closeFocusedTerminal()) return;
    const state = useReviewStore.getState();
    if (state.secondaryFile !== null) {
      state.closeSplit();
    } else if (state.selectedFile !== null) {
      useReviewStore.setState({ selectedFile: null });
    } else {
      const platform = getPlatformServices();
      await platform.window.close();
    }
  }, []);

  // The app's commands, and the shell-level actions they need. Shortcuts are
  // dispatched here rather than by the native menu, so they work identically
  // in the desktop app and in web mode (which has no native menu at all).
  //
  // The terminal's own commands ride in `STATIC_COMMANDS` and are registered
  // here rather than by the review screen, for the same reason its panel is
  // mounted here: ⌘` has to answer on the home screen too.
  useRegisterCommands(STATIC_COMMANDS);
  useRegisterCommands(reviewCommands);
  useRegisterCommands(workspaceCommands);
  useProvideCommandUi(
    useMemo(
      () => ({
        openRepo: () => handleOpenRepoRef.current(),
        closeTab: () => void handleClose(),
        navigate: (to: string) => navigate(to),
        // Activate by key the way the sidebar would: find the row and use its
        // own kind's handler, so a review row resolves its stored base and a
        // bare branch goes through read-only-preview detection. A key with no
        // row (rare — e.g. the sidebar hasn't loaded that repo yet) still
        // opens as a local branch rather than doing nothing.
        activateReviewKey: (repoPath: string, ref: string) => {
          const row = findSidebarRow(
            useReviewStore.getState(),
            makeReviewKey(repoPath, ref),
          );
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
      [handleClose, navigate],
    ),
  );
  useCommandDispatch();

  useMenuState();
  useReviewFreshness();
  useRepoActivitySync();
  useWorkspaceSync();
  useTerminalCheckoutSync();
  useTerminalEvents();
  // Tauri's window-level drag-and-drop, which is the *only* drop channel in the
  // desktop app — the webview never sees an HTML5 drop. It has to be mounted at
  // the shell, not inside the terminal panel: it also hit-tests every "Working
  // on" drop, and the panel is closed by default, which would leave dragging a
  // branch onto a work card doing nothing at all.
  useTerminalFileDrop();
  useViewerPrsSync();
  // Both halves of "a terminal stopped and nobody answered": the count the OS
  // wears, and the landing a tapped notification asks for.
  useAttentionBadge();
  useWorkspaceDeepLink();

  useComparisonLoader(comparisonReady, setInitialLoading);

  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);

  useWindowTitle(repoPath, comparison, comparisonReady);

  const compact = useIsCompact();

  return (
    <TooltipProvider delayDuration={300}>
      {/* h-dvh, not h-screen: on a phone `vh` is the tallest the viewport ever
          gets, so a bottom bar measured against it spends the first scroll
          hidden behind Safari's toolbar. */}
      <CompactNavProvider>
        {({ queueOpen, closeQueue }) => (
          <div className="flex h-dvh bg-surface">
            {/* The sidebar is chrome: it owns the window's left edge, and the
                two work halves float on it as rounded panels. At phone width
                there is no edge to spare, so the same component is a drawer
                over the stage instead — see QueueDrawer, opened by the
                hamburger on whichever half header is showing. */}
            {compact ? (
              <QueueDrawer open={queueOpen} onClose={closeQueue} />
            ) : (
              <Sidebar />
            )}

            {/* The stage: one workspace, as its two halves and nothing above
                them — the sidebar is where a workspace says what it is. The
                terminal dock is what splits them; it is mounted here rather
                than inside the review screen because tabs are global, so a
                shell has to survive going back to the home screen, and its
                xterms have to survive the route change. */}
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
              <TerminalDock>
                <Outlet
                  context={{
                    repoStatus,
                    repoError,
                    repoPath,
                    comparisonReady,
                    handleOpenRepo,
                    handleCloseRepo,
                    handleSelectRepo,
                    handleNewReview,
                    handleStartReview,
                  }}
                />
              </TerminalDock>

              {/* Which half is on screen. Leaving the workspace entirely is the
                  hamburger's job, not a third tab beside these two. */}
              {compact && <CompactBar />}
            </div>
          </div>
        )}
      </CompactNavProvider>

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
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => Promise<void>;
  handleNewReview: (path: string, target: ReviewTarget) => Promise<void>;
  handleStartReview: (path: string, target: ReviewTarget) => Promise<void>;
}

export function useAppContext() {
  return useOutletContext<AppContext>();
}

/**
 * What "/" shows: the focused workspace's empty state when there is one, and
 * the app's own empty states when there isn't.
 *
 * A workspace showing no repo has no comparison, so `focusWorkspace` sends it
 * here — which makes this route the workspace's first screen rather than one of
 * its own. That is exactly what the sidebar's `+` produces, so there is no
 * separate "create" flow to design.
 */
function EmptyTabState() {
  const { repoStatus, repoError, handleOpenRepo, handleNewReview } =
    useAppContext();
  const globalReviews = useReviewStore((s) => s.globalReviews);
  const globalReviewsLoading = useReviewStore((s) => s.globalReviewsLoading);
  const focusedWorkspace = useFocusedWorkspace();

  if (focusedWorkspace) return <EmptyStage />;

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
  const { repoPath, repoStatus, comparisonReady, handleStartReview } =
    useAppContext();

  useFileRouteSync();

  // "No repo yet" and "no repo" are different answers, and only the second one
  // is grounds for throwing the URL away. A cold load has no `repoPath` until
  // `useRepositoryInit` resolves one, so redirecting on the bare null sent
  // every deep link to "/" before it could be read — taking the ref and the
  // file path with it, which is why arriving at a file URL landed on the file
  // list. Nothing noticed while the desktop app restored its own last repo on
  // launch; an installed PWA cold-starts at a URL every single time.
  if (!repoPath) {
    if (repoStatus === "loading") return null;
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
