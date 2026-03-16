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
  const refresh = useReviewStore((s) => s.refresh);
  const loadGlobalReviews = useReviewStore((s) => s.loadGlobalReviews);
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const loadLocalActivity = useReviewStore((s) => s.loadLocalActivity);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const comparison = useReviewStore((s) => s.comparison);
  const setActiveReviewKey = useReviewStore((s) => s.setActiveReviewKey);

  // Use refs to avoid stale closures in event handlers
  const repoPathRef = useRef(repoPath);
  const loadReviewStateRef = useRef(loadReviewState);
  const refreshRef = useRef(refresh);
  const loadGlobalReviewsRef = useRef(loadGlobalReviews);
  const checkReviewsFreshnessRef = useRef(checkReviewsFreshness);
  const loadLocalActivityRef = useRef(loadLocalActivity);
  const comparisonReadyRef = useRef(comparisonReady);
  const gitChangedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const refreshInProgressRef = useRef(false);
  const refreshRequestedRef = useRef(false);
  const localActivityInProgressRef = useRef(false);
  const localActivityRequestedRef = useRef(false);
  const activeReviewKeyRef = useRef(activeReviewKey);
  const comparisonRef = useRef(comparison);
  const setActiveReviewKeyRef = useRef(setActiveReviewKey);

  useEffect(() => {
    repoPathRef.current = repoPath;
    loadReviewStateRef.current = loadReviewState;
    refreshRef.current = refresh;
    loadGlobalReviewsRef.current = loadGlobalReviews;
    checkReviewsFreshnessRef.current = checkReviewsFreshness;
    loadLocalActivityRef.current = loadLocalActivity;
    comparisonReadyRef.current = comparisonReady;
    activeReviewKeyRef.current = activeReviewKey;
    comparisonRef.current = comparison;
    setActiveReviewKeyRef.current = setActiveReviewKey;
  }, [
    repoPath,
    loadReviewState,
    refresh,
    loadGlobalReviews,
    checkReviewsFreshness,
    loadLocalActivity,
    comparisonReady,
    activeReviewKey,
    comparison,
    setActiveReviewKey,
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
        loadGlobalReviewsRef.current();
      }),
    );
    console.log("[watcher] Listening for review-state-changed");

    // Git state changed (branch switch, new commit, etc.)
    // Debounce at 2s to avoid rapid refreshes during active editing.
    // Guard against overlapping refreshes: if one is in progress, defer
    // the next until it completes (then debounce again).
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
        console.log("[watcher] Refreshing...");
        try {
          await refreshRef.current();
        } finally {
          refreshInProgressRef.current = false;
          // If another change came in while we were refreshing, schedule again
          if (refreshRequestedRef.current) {
            refreshRequestedRef.current = false;
            console.log("[watcher] Deferred refresh requested, scheduling...");
            scheduleRefresh();
          }
        }
      }, 2000);
    };

    // Local activity changed — debounce at 500ms to avoid rapid refreshes
    // during git rebase. Guard against overlapping loads.
    const scheduleLocalActivity = () => {
      if (localActivityTimerRef.current) {
        clearTimeout(localActivityTimerRef.current);
      }
      localActivityTimerRef.current = setTimeout(async () => {
        localActivityTimerRef.current = null;
        if (localActivityInProgressRef.current) {
          localActivityRequestedRef.current = true;
          return;
        }
        localActivityInProgressRef.current = true;
        try {
          await loadLocalActivityRef.current();
        } finally {
          localActivityInProgressRef.current = false;
          if (localActivityRequestedRef.current) {
            localActivityRequestedRef.current = false;
            scheduleLocalActivity();
          }
        }
      }, 500);
    };

    unlistenFns.push(
      apiClient.onGitChanged((eventRepoPath) => {
        console.log("[watcher] Received git-changed event:", eventRepoPath);
        if (eventRepoPath === repoPathRef.current) {
          // Only refresh if a comparison has been selected (not on start screen)
          if (!comparisonReadyRef.current) {
            console.log("[watcher] Skipping refresh - no comparison selected");
            return;
          }
          scheduleRefresh();
          // Also refresh local activity so the sidebar shows the repo as
          // soon as it becomes dirty (git-changed fires on working tree
          // changes too, not just git state changes).
          scheduleLocalActivity();
        }
        // Always update sidebar freshness on git changes
        checkReviewsFreshnessRef.current();
      }),
    );
    console.log("[watcher] Listening for git-changed");

    unlistenFns.push(
      apiClient.onLocalActivityChanged(() => {
        console.log("[watcher] Received local-activity-changed event");
        scheduleLocalActivity();
      }),
    );
    console.log("[watcher] Listening for local-activity-changed");

    return () => {
      clearTimeout(gitChangedTimerRef.current!);
      gitChangedTimerRef.current = null;
      if (localActivityTimerRef.current) {
        clearTimeout(localActivityTimerRef.current);
        localActivityTimerRef.current = null;
      }
      refreshInProgressRef.current = false;
      refreshRequestedRef.current = false;
      localActivityInProgressRef.current = false;
      localActivityRequestedRef.current = false;
      unlistenFns.forEach((fn) => fn());
    };
  }, [repoPath]);
}
