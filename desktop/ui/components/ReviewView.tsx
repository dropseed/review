import {
  type ReactNode,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useReviewStore } from "../stores";
import { useProvideCommandUi } from "../commands/host";
import { getMissingRefs } from "../stores/slices/groupingSlice";
import { getApiClient } from "../api";
import type { ReviewTarget } from "../types";
import {
  useMenuEvents,
  useFileWatcher,
  useKeyboardNavigation,
  useMouseNavigation,
  useCelebration,
  useLspClient,
  useDeepLinkFocus,
  useScopeReconciliation,
  useReviewTier,
} from "../hooks";
import { useAsyncAction } from "../hooks/useAsyncAction";
import { FilesPanelDock } from "./FilesPanel/FilesPanelDock";
import { CodeHalfHeader } from "./Stage/CodeHalfHeader";
import { ContentArea } from "./ContentArea";
import { WarningIcon } from "./ui/icons";
import { ActivityBar } from "./ActivityBar";
import { CompareRefDeletedNotice } from "./CompareRefDeletedNotice";

const DebugModal = lazy(() =>
  import("./modals/DebugModal").then((m) => ({ default: m.DebugModal })),
);
const ClassificationsModal = lazy(() =>
  import("./modals/ClassificationsModal").then((m) => ({
    default: m.ClassificationsModal,
  })),
);

interface ReviewViewProps {
  comparisonReady: number;
  onStartReview?: (path: string, target: ReviewTarget) => Promise<void>;
}

export function ReviewView({
  comparisonReady,
  onStartReview,
}: ReviewViewProps): ReactNode {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparison = useReviewStore((s) => s.comparison);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const reviewBaseOverride = useReviewStore((s) => s.reviewBaseOverride);
  const activeOverlay = useReviewStore((s) => s.activeOverlay);
  const closeOverlay = useReviewStore((s) => s.closeOverlay);

  // A comparison whose base or compare branch was deleted resolves to git's
  // empty tree, so the diff would otherwise render every file as a deletion.
  // The freshness check (which also drives the sidebar warning) records the
  // missing refs; surface them here instead of the bogus all-deleted diff.
  const reviewMissingRefs = useReviewStore((s) => s.reviewMissingRefs);
  const missingRefs = useMemo(
    () => getMissingRefs(reviewMissingRefs, repoPath, reviewRef),
    [reviewMissingRefs, repoPath, reviewRef],
  );
  const compareRefMissing = missingRefs.length > 0;

  // When this comparison's missing refs return (branch restored or fetched),
  // the file list in the store is still the stale all-deleted diff. Reload so
  // the recovered view shows the real diff rather than the leftover deletions.
  // Tracking the comparison key alongside the flag keeps this scoped to "the
  // same review recovered" — switching to a healthy review also clears the
  // flag, but that review's diff is already being loaded by the comparison
  // loader, so refreshing there would just be redundant work.
  const comparisonKey = comparison?.key ?? null;
  const prevCompareRefState = useRef({ missing: false, key: comparisonKey });
  useEffect(() => {
    const prev = prevCompareRefState.current;
    prevCompareRefState.current = {
      missing: compareRefMissing,
      key: comparisonKey,
    };
    if (!prev.missing || compareRefMissing || prev.key !== comparisonKey)
      return;
    // Only a genuine recovery (the branch returned for a review we're still
    // viewing) should reload. Deleting the review also clears its missing-refs
    // flag, but it nulls activeReviewKey in the same update — refreshing there
    // would reload (and re-create) the review we just removed.
    const { activeReviewKey, repoPath: activeRepo } = useReviewStore.getState();
    const stillActive =
      activeReviewKey?.repoPath === activeRepo &&
      activeReviewKey?.ref === reviewRef;
    if (stillActive) {
      useReviewStore.getState().refresh();
    }
  }, [compareRefMissing, comparisonKey, reviewRef]);

  // Read-only preview mode
  const readOnlyPreview = useReviewStore((s) => s.readOnlyPreview);
  const worktreeStale = useReviewStore((s) => s.worktreeStale);
  const worktreePath = useReviewStore((s) => s.worktreePath);
  const localActivity = useReviewStore((s) => s.localActivity);

  const isOnCurrentBranch = useMemo(() => {
    if (!repoPath || !comparison) return false;
    const repo = localActivity.find((r) => r.repoPath === repoPath);
    return (
      repo?.branches.find((b) => b.name === comparison.head)?.isCurrent ?? false
    );
  }, [localActivity, repoPath, comparison]);
  const updateWorktreeAction = useCallback(async () => {
    if (!repoPath || !comparison || !worktreePath) return;
    const client = getApiClient();
    const newSha = await client.resolveRef(repoPath, comparison.head);
    await client.updateWorktreeHead(repoPath, worktreePath, newSha);
    useReviewStore.getState().setWorktreeStale(false);
    const { loadFiles, loadAllFiles, syncTotalDiffHunks, classifyStaticHunks } =
      useReviewStore.getState();
    await Promise.all([loadFiles(), loadAllFiles()]);
    syncTotalDiffHunks();
    classifyStaticHunks();
  }, [repoPath, comparison, worktreePath]);
  const [handleUpdateWorktree, updatingWorktree] = useAsyncAction(
    updateWorktreeAction,
    "update worktree",
  );

  const startReviewAction = useCallback(async () => {
    if (!repoPath || !reviewRef || !onStartReview) return;
    await onStartReview(repoPath, {
      ref: reviewRef,
      baseOverride: reviewBaseOverride ?? undefined,
    });
  }, [repoPath, reviewRef, reviewBaseOverride, onStartReview]);
  const [handleStartReviewClick, startingReview] = useAsyncAction(
    startReviewAction,
    "start review",
  );

  const ensureMaterialized = useReviewStore((s) => s.ensureMaterialized);
  const checkoutAction = useCallback(async () => {
    await ensureMaterialized("enable LSP features");
  }, [ensureMaterialized]);
  const [handleCheckoutClick, checkingOut] = useAsyncAction(
    checkoutAction,
    "checkout worktree",
  );

  const [isRefreshing, setIsRefreshing] = useState(false);

  // Manual refresh handler
  const handleRefresh = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await Promise.all([
        useReviewStore.getState().refresh(),
        useReviewStore.getState().loadLocalActivity(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [isRefreshing]);

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
      useReviewStore.getState().closeOverlay("classifications");
      useReviewStore.getState().navigateToBrowse(filePath, { hunkId });
      useReviewStore.setState({
        scrollTarget: { type: "hunk", hunkId },
      });
    },
    [],
  );

  useKeyboardNavigation();
  // Deliberately not `newWindow` or `closeTab` — AppShell already provides
  // those, and the same handler registered twice makes which one wins depend on
  // effect-run order.
  useProvideCommandUi(
    useMemo(
      () => ({
        newTab: () => void handleNewTab(),
        refresh: () => void handleRefresh(),
      }),
      [handleNewTab, handleRefresh],
    ),
  );
  useMouseNavigation();
  // Hold deep-link focus until the diff is real again — consuming it against the
  // all-deleted diff behind the notice would drop the requested hunk.
  useDeepLinkFocus(!compareRefMissing);

  useMenuEvents();

  useFileWatcher(comparisonReady);
  useLspClient();
  useScopeReconciliation();
  useReviewTier();

  // The terminal is not here: it docks beside this whole screen from the app
  // shell (see TerminalDock), so a shell outlives the review it was started in.

  // Celebration on 100% reviewed — suppressed when the compared branch is gone
  // so confetti can't fire over the bogus all-deleted diff behind the notice.
  useCelebration(!compareRefMissing);

  return (
    <div className="flex h-full flex-row bg-surface">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Status banners — hidden while the deleted-ref notice is shown */}
        {!compareRefMissing && (
          <>
            {/* Read-only preview banner */}
            {readOnlyPreview && (
              <div className="flex items-center justify-between gap-3 border-b border-edge bg-surface-raised/50 px-4 py-2">
                <span className="text-xs text-fg-muted">
                  Read-only preview — approvals are disabled
                </span>
                {onStartReview && (
                  <button
                    type="button"
                    onClick={handleStartReviewClick}
                    disabled={startingReview}
                    className="shrink-0 rounded-lg bg-sage-500 px-3 py-1.5 text-xs font-semibold text-surface
                         hover:bg-sage-400 transition-colors duration-150
                         disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {startingReview ? "Starting..." : "Start Review"}
                  </button>
                )}
              </div>
            )}

            {/* Stale worktree indicator */}
            {worktreeStale && worktreePath && !readOnlyPreview && (
              <div className="flex items-center gap-2 border-b border-edge bg-amber-500/5 px-4 py-1.5">
                <WarningIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                <span className="text-xs text-fg-muted flex-1">
                  Worktree is behind branch tip — review may not reflect latest
                  changes
                </span>
                <button
                  type="button"
                  onClick={handleUpdateWorktree}
                  disabled={updatingWorktree}
                  className="text-xs font-medium text-amber-600 hover:text-amber-500
                         disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {updatingWorktree ? "Updating..." : "Update"}
                </button>
              </div>
            )}

            {/* Checkout prompt — shown for reviews without a worktree.
            Skipped when on the current branch, since the main working tree
            already matches the branch being reviewed (LSP works correctly). */}
            {!readOnlyPreview && !worktreePath && !isOnCurrentBranch && (
              <div className="flex items-center gap-2 border-b border-edge px-4 py-1.5">
                <span className="text-xs text-fg-faint flex-1">
                  Check out to enable LSP features (hover, go-to-definition)
                </span>
                <button
                  type="button"
                  onClick={handleCheckoutClick}
                  disabled={checkingOut}
                  className="text-xs font-medium text-fg-muted hover:text-fg-secondary
                         disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                >
                  {checkingOut ? "Checking out..." : "Check out"}
                </button>
              </div>
            )}
          </>
        )}

        {/* Content region. The deleted-ref notice replaces the diff when the
            compared branch no longer exists. */}
        <main className="relative flex flex-1 flex-row overflow-hidden bg-surface">
          {/* Activity island — floats over the top of the content region */}
          {comparison && !compareRefMissing && <ActivityBar />}
          {/* The code half is one rounded, raised card — the same one a
              terminal pane uses — holding its own header, the diff, and the
              files column. Its padding is the gutter the terminal dock leaves
              for it, which is why it is unconditional: this screen doesn't know
              whether a terminal is beside it, or on which side. */}
          <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden p-2">
            <div className="panel-card relative flex min-h-0 flex-1 flex-col overflow-hidden bg-surface">
              <CodeHalfHeader />
              <div className="flex min-h-0 flex-1 flex-row overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                  {compareRefMissing ? (
                    <CompareRefDeletedNotice
                      repoPath={repoPath!}
                      comparison={comparison!}
                      missingRefs={missingRefs}
                    />
                  ) : (
                    <ContentArea />
                  )}
                </div>

                {/* The files column — hidden when the compared branch is
                    gone, since its list would otherwise show every file as
                    deleted. */}
                {!compareRefMissing && <FilesPanelDock />}
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Debug Modal */}
      {activeOverlay === "debug" && (
        <Suspense fallback={null}>
          <DebugModal isOpen onClose={() => closeOverlay("debug")} />
        </Suspense>
      )}

      {/* The palette — files, symbols, and content search included — is
          mounted at the shell in router.tsx, not here. */}

      {/* Classifications Modal */}
      {activeOverlay === "classifications" && (
        <Suspense fallback={null}>
          <ClassificationsModal
            isOpen
            onClose={() => closeOverlay("classifications")}
            onSelectHunk={handleClassificationSelectHunk}
          />
        </Suspense>
      )}
    </div>
  );
}
