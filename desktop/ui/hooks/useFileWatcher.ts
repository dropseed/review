import type { MutableRefObject } from "react";
import { useEffect, useRef } from "react";
import { getApiClient } from "../api";
import { shouldIgnoreReviewStateReload } from "../stores/slices/reviewSlice";
import { useReviewStore } from "../stores";

/**
 * Manages file watcher lifecycle and listens for review state/git change events.
 */
export function useFileWatcher(comparisonReady: number) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const loadReviewState = useReviewStore((s) => s.loadReviewState);
  const applyWatcherEvent = useReviewStore((s) => s.applyWatcherEvent);
  const loadGlobalReviews = useReviewStore((s) => s.loadGlobalReviews);
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const comparison = useReviewStore((s) => s.comparison);
  const setActiveReviewKey = useReviewStore((s) => s.setActiveReviewKey);
  const isStandaloneFile = useReviewStore((s) => s.isStandaloneFile);
  const loadRepoFiles = useReviewStore((s) => s.loadRepoFiles);
  const loadCurrentBranch = useReviewStore((s) => s.loadCurrentBranch);

  // Use refs to avoid stale closures in event handlers
  const repoPathRef = useRef(repoPath);
  const loadReviewStateRef = useRef(loadReviewState);
  const applyWatcherEventRef = useRef(applyWatcherEvent);
  const loadGlobalReviewsRef = useRef(loadGlobalReviews);
  const checkReviewsFreshnessRef = useRef(checkReviewsFreshness);
  const comparisonReadyRef = useRef(comparisonReady);
  const isStandaloneFileRef = useRef(isStandaloneFile);
  const loadRepoFilesRef = useRef(loadRepoFiles);
  const loadCurrentBranchRef = useRef(loadCurrentBranch);
  const gitChangedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browseRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const browseRefreshInProgressRef = useRef(false);
  const browseRefreshRequestedRef = useRef(false);
  const refreshInProgressRef = useRef(false);
  const refreshRequestedRef = useRef(false);
  const activeReviewKeyRef = useRef(activeReviewKey);
  const comparisonRef = useRef(comparison);
  const setActiveReviewKeyRef = useRef(setActiveReviewKey);
  // Debounce timers for the global-reviews refresh and freshness check —
  // both fan out to N git subprocesses per call, so coalescing edit-storms
  // into a single trailing call is important for battery.
  const globalReviewsDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const freshnessDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );

  useEffect(() => {
    repoPathRef.current = repoPath;
    loadReviewStateRef.current = loadReviewState;
    applyWatcherEventRef.current = applyWatcherEvent;
    loadGlobalReviewsRef.current = loadGlobalReviews;
    checkReviewsFreshnessRef.current = checkReviewsFreshness;
    comparisonReadyRef.current = comparisonReady;
    activeReviewKeyRef.current = activeReviewKey;
    comparisonRef.current = comparison;
    setActiveReviewKeyRef.current = setActiveReviewKey;
    isStandaloneFileRef.current = isStandaloneFile;
    loadRepoFilesRef.current = loadRepoFiles;
    loadCurrentBranchRef.current = loadCurrentBranch;
  }, [
    repoPath,
    loadReviewState,
    applyWatcherEvent,
    loadGlobalReviews,
    checkReviewsFreshness,
    comparisonReady,
    activeReviewKey,
    comparison,
    setActiveReviewKey,
    isStandaloneFile,
    loadRepoFiles,
    loadCurrentBranch,
  ]);

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
  useEffect(() => {
    if (!repoPath) return;

    const apiClient = getApiClient();

    const WATCHER_DEBOUNCE_MS = 1500;
    const trailingDebounce =
      (
        ref: MutableRefObject<ReturnType<typeof setTimeout> | null>,
        fn: () => void,
      ) =>
      () => {
        if (ref.current !== null) clearTimeout(ref.current);
        ref.current = setTimeout(() => {
          ref.current = null;
          fn();
        }, WATCHER_DEBOUNCE_MS);
      };
    const debouncedLoadGlobalReviews = trailingDebounce(
      globalReviewsDebounceRef,
      () => loadGlobalReviewsRef.current(),
    );
    const debouncedCheckFreshness = trailingDebounce(freshnessDebounceRef, () =>
      checkReviewsFreshnessRef.current(),
    );
    const unlistenFns: (() => void)[] = [];

    // Review state changed externally
    unlistenFns.push(
      apiClient.onReviewStateChanged(async (eventRepoPath) => {
        console.log(
          "[watcher] Received review-state-changed event:",
          eventRepoPath,
        );
        // Skip events triggered by our own saves — saveReviewState already
        // patches the sidebar entry, so a full loadGlobalReviews is unnecessary.
        if (
          eventRepoPath === repoPathRef.current &&
          shouldIgnoreReviewStateReload()
        ) {
          console.log(
            "[watcher] Ignoring review-state-changed - triggered by our own save",
          );
          return;
        }
        if (eventRepoPath === repoPathRef.current) {
          // Check if the active review still exists on disk before reloading.
          // If it was deleted externally, clear the active key (same as internal delete).
          const activeKey = activeReviewKeyRef.current;
          const comp = comparisonRef.current;
          if (activeKey && comp) {
            let exists = false;
            try {
              exists = await apiClient.reviewExists(eventRepoPath, comp);
            } catch {
              // If the check fails, fall back to reloading
            }

            if (!exists) {
              console.log(
                "[watcher] Active review was deleted externally, clearing active key",
              );
              setActiveReviewKeyRef.current(null);
            } else {
              console.log("[watcher] Reloading review state...");
              loadReviewStateRef.current();
            }
          } else {
            console.log("[watcher] Reloading review state...");
            loadReviewStateRef.current();
          }
        }
        // Refresh sidebar for external review state changes
        debouncedLoadGlobalReviews();
      }),
    );
    console.log("[watcher] Listening for review-state-changed");

    // Git change: debounce 2s to avoid rapid refreshes during editing. The
    // set of changed paths and the `gitStateChanged` flag accumulated across
    // rapid events in the debounce window is unioned into a single call so
    // nothing is dropped.
    const pendingChangedPathsRef = { current: new Set<string>() };
    const pendingGitStateRef = { current: false };

    const scheduleRefresh = () => {
      clearTimeout(gitChangedTimerRef.current!);
      console.log("[watcher] Debouncing refresh (2s)...");
      gitChangedTimerRef.current = setTimeout(async () => {
        gitChangedTimerRef.current = null;
        if (refreshInProgressRef.current) {
          console.log("[watcher] Refresh already in progress, deferring...");
          refreshRequestedRef.current = true;
          return;
        }
        refreshInProgressRef.current = true;

        // Take a snapshot of the pending event aggregate and clear the buffers
        // before awaiting, so incoming events during the refresh accumulate
        // into the NEXT batch rather than being lost.
        const changedPaths = Array.from(pendingChangedPathsRef.current);
        const gitStateChanged = pendingGitStateRef.current;
        pendingChangedPathsRef.current = new Set<string>();
        pendingGitStateRef.current = false;

        console.log(
          `[watcher] Applying watcher event (paths=${changedPaths.length}, gitState=${gitStateChanged})...`,
        );
        try {
          await applyWatcherEventRef.current({
            changedPaths,
            gitStateChanged,
          });
        } finally {
          refreshInProgressRef.current = false;
          if (refreshRequestedRef.current) {
            refreshRequestedRef.current = false;
            console.log("[watcher] Deferred refresh requested, scheduling...");
            scheduleRefresh();
          }
        }
      }, 2000);
    };

    // Browse mode refresh: reload file tree and branch info on git changes.
    // Debounce at 2s with same overlap guard as review-mode refresh.
    const scheduleBrowseRefresh = () => {
      clearTimeout(browseRefreshTimerRef.current!);
      console.log("[watcher] Debouncing browse refresh (2s)...");
      browseRefreshTimerRef.current = setTimeout(async () => {
        browseRefreshTimerRef.current = null;
        if (browseRefreshInProgressRef.current) {
          console.log(
            "[watcher] Browse refresh already in progress, deferring...",
          );
          browseRefreshRequestedRef.current = true;
          return;
        }
        browseRefreshInProgressRef.current = true;
        console.log("[watcher] Refreshing browse mode...");
        try {
          await Promise.all([
            loadRepoFilesRef.current(),
            loadCurrentBranchRef.current(),
          ]);
        } finally {
          browseRefreshInProgressRef.current = false;
          if (browseRefreshRequestedRef.current) {
            browseRefreshRequestedRef.current = false;
            console.log(
              "[watcher] Deferred browse refresh requested, scheduling...",
            );
            scheduleBrowseRefresh();
          }
        }
      }, 2000);
    };

    unlistenFns.push(
      apiClient.onGitChanged((payload) => {
        console.log(
          "[watcher] Received git-changed event:",
          payload.repoPath,
          `(paths=${payload.changedPaths.length}, gitState=${payload.gitStateChanged})`,
        );
        if (payload.repoPath === repoPathRef.current) {
          // Union incoming event into the pending aggregate so a single
          // debounced flush applies everything that happened in the window.
          for (const p of payload.changedPaths) {
            pendingChangedPathsRef.current.add(p);
          }
          if (payload.gitStateChanged) {
            pendingGitStateRef.current = true;
          }

          if (!comparisonReadyRef.current) {
            // Browse mode: refresh file tree and branch info
            // (standalone files have no git, so skip)
            if (!isStandaloneFileRef.current) {
              scheduleBrowseRefresh();
            }
          } else {
            // Review mode: surgical refresh via the aggregate handler.
            // Sidebar activity is no longer refreshed here — it arrives as
            // a scoped `repo-activity-changed` delta, filtered by the
            // backend's activity cache.
            scheduleRefresh();
          }
        }
        // Always update sidebar freshness on git changes
        debouncedCheckFreshness();
      }),
    );
    console.log("[watcher] Listening for git-changed");

    return () => {
      clearTimeout(gitChangedTimerRef.current!);
      gitChangedTimerRef.current = null;
      clearTimeout(browseRefreshTimerRef.current!);
      browseRefreshTimerRef.current = null;
      if (globalReviewsDebounceRef.current !== null) {
        clearTimeout(globalReviewsDebounceRef.current);
        globalReviewsDebounceRef.current = null;
      }
      if (freshnessDebounceRef.current !== null) {
        clearTimeout(freshnessDebounceRef.current);
        freshnessDebounceRef.current = null;
      }
      refreshInProgressRef.current = false;
      refreshRequestedRef.current = false;
      browseRefreshInProgressRef.current = false;
      browseRefreshRequestedRef.current = false;
      unlistenFns.forEach((fn) => fn());
    };
  }, [repoPath]);
}
