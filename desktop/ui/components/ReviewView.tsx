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
import { clsx } from "clsx";
import { useReviewStore } from "../stores";
import { useProvideCommandUi } from "../commands/host";
import { getMissingRefs } from "../stores/slices/groupingSlice";
import { ephemeralView } from "../stores/selectors/viewpoint";
import { StartReviewButton } from "./StartReviewButton";
import { getApiClient } from "../api";
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
import { useElementWidth } from "../hooks/useElementWidth";
import { codeHalfIsNarrow } from "./Stage/compact";
import { rootFontSize } from "../utils/resize";

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
}

export function ReviewView({ comparisonReady }: ReviewViewProps): ReactNode {
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
  // A commit being looked at inside this tab. It owns the banner row while
  // it's up, because the notices below all describe the review's own diff.
  const viewingCommit = useReviewStore(ephemeralView);
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
    const {
      loadFiles,
      refreshAllFiles,
      syncTotalDiffHunks,
      classifyStaticHunks,
    } = useReviewStore.getState();
    await Promise.all([loadFiles(), refreshAllFiles()]);
    syncTotalDiffHunks();
    classifyStaticHunks();
  }, [repoPath, comparison, worktreePath]);
  const [handleUpdateWorktree, updatingWorktree] = useAsyncAction(
    updateWorktreeAction,
    "update worktree",
  );

  const startReviewTarget = useMemo(
    () =>
      repoPath && reviewRef
        ? {
            path: repoPath,
            target: {
              ref: reviewRef,
              baseOverride: reviewBaseOverride ?? undefined,
            },
          }
        : null,
    [repoPath, reviewRef, reviewBaseOverride],
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
  // Deliberately not `closeTab` — AppShell already provides it, and the same
  // handler registered twice makes which one wins depend on effect-run order.
  useProvideCommandUi(
    useMemo(
      () => ({
        refresh: () => void handleRefresh(),
      }),
      [handleRefresh],
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

  // The row the diff and the files column share. Its width is what caps the
  // files column — the window would let it take most of this row — and what
  // decides whether the row can hold both columns at all.
  const [codeRow, setCodeRow] = useState<HTMLDivElement | null>(null);
  const codeRowWidth = useElementWidth(codeRow);
  // Re-read per render rather than cached: the root font size follows the
  // UI-scale preference, and there is no resize event for a font-size change.
  const narrow = codeHalfIsNarrow(codeRowWidth, rootFontSize());

  // Which of the two columns a narrow code half is showing. Derived, never
  // stored: what the content area has open *is* the answer to "list or detail".
  //
  // Not `selectedFile` alone. `ContentArea` also gives the whole region to the
  // search results, the guide's stack and the rolling working-tree diff, none of
  // which set `selectedFile` — so keyed on the file, ⌘⇧F in a narrow half opened
  // the search view into the column this hides and left the file list on screen.
  // And the deleted-ref notice replaces the diff entirely while the files column
  // isn't rendered at all, which showed a header over nothing.
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const searchViewOpen = useReviewStore((s) => s.searchViewOpen);
  const guideContentMode = useReviewStore((s) => s.guideContentMode);
  const workingTreeMultiView = useReviewStore((s) => s.workingTreeMultiView);
  const listing =
    selectedFile === null &&
    !searchViewOpen &&
    guideContentMode === null &&
    workingTreeMultiView === null &&
    !compareRefMissing;

  return (
    <div className="flex h-full flex-row bg-surface">
      <div className="flex flex-1 flex-col min-w-0">
        {/* Status banners — hidden while the deleted-ref notice is shown, and
            while a commit is being peeked at: all three describe the review's
            own diff, which is not what is on screen. What a peek needs instead
            — which commit, and the way back — is the files column's comparison
            bar, and the offer to review it is that column's first row. */}
        {!compareRefMissing && !viewingCommit && (
          <>
            {readOnlyPreview && (
              <div className="flex items-center justify-between gap-3 border-b border-edge bg-surface-raised/50 px-4 py-2">
                <span className="text-xs text-fg-muted">
                  Read-only preview — approvals are disabled
                </span>
                <StartReviewButton
                  label="Start Review"
                  target={startReviewTarget}
                />
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
              <CodeHalfHeader narrow={narrow} />
              <div
                ref={setCodeRow}
                className="flex min-h-0 flex-1 flex-row overflow-hidden"
              >
                {/* At phone width the code half is list-or-detail, not a
                    column beside a column: the files list until a file is
                    picked, that file afterwards. `selectedFile` already means
                    exactly that, so nothing new is stored and nothing is
                    written — `filesPanelCollapsed` would have been the obvious
                    lever and is precisely the wrong one, being a persisted
                    desktop preference a thumb must not edit. Both stay mounted
                    for the reason the dock's halves do. */}
                <div
                  className={clsx(
                    "flex min-w-0 flex-1 flex-col overflow-hidden",
                    narrow && listing && "hidden",
                  )}
                >
                  {compareRefMissing ? (
                    <CompareRefDeletedNotice
                      repoPath={repoPath!}
                      comparison={comparison!}
                      missingRefs={missingRefs}
                    />
                  ) : (
                    <ContentArea narrow={narrow} />
                  )}
                </div>

                {/* The files column — hidden when the compared branch is
                    gone, since its list would otherwise show every file as
                    deleted. */}
                {!compareRefMissing && (
                  <div
                    className={clsx(
                      "flex min-h-0 flex-row overflow-hidden",
                      narrow
                        ? listing
                          ? "min-w-0 flex-1"
                          : "hidden"
                        : "shrink-0",
                    )}
                  >
                    <FilesPanelDock full={narrow} availablePx={codeRowWidth} />
                  </div>
                )}
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
