import { useEffect, useRef } from "react";
import { getApiClient } from "../api";
import { shouldIgnoreReviewStateReload } from "../stores/slices/reviewSlice";
import { useReviewStore } from "../stores";

/**
 * Manages file watcher lifecycle and listens for review state/git change events.
 */
export function useFileWatcher(comparisonReady: boolean) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const loadReviewState = useReviewStore((s) => s.loadReviewState);
  const refresh = useReviewStore((s) => s.refresh);
  const loadGlobalReviews = useReviewStore((s) => s.loadGlobalReviews);
  const checkReviewsFreshness = useReviewStore((s) => s.checkReviewsFreshness);
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const comparison = useReviewStore((s) => s.comparison);
  const setActiveReviewKey = useReviewStore((s) => s.setActiveReviewKey);

  // Use refs to avoid stale closures in event handlers
  const repoPathRef = useRef(repoPath);
  const loadReviewStateRef = useRef(loadReviewState);
  const refreshRef = useRef(refresh);
  const loadGlobalReviewsRef = useRef(loadGlobalReviews);
  const checkReviewsFreshnessRef = useRef(checkReviewsFreshness);
  const comparisonReadyRef = useRef(comparisonReady);
  const gitChangedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeReviewKeyRef = useRef(activeReviewKey);
  const comparisonRef = useRef(comparison);
  const setActiveReviewKeyRef = useRef(setActiveReviewKey);

  useEffect(() => {
    repoPathRef.current = repoPath;
    loadReviewStateRef.current = loadReviewState;
    refreshRef.current = refresh;
    loadGlobalReviewsRef.current = loadGlobalReviews;
    checkReviewsFreshnessRef.current = checkReviewsFreshness;
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
      apiClient.onReviewStateChanged((eventRepoPath) => {
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
            apiClient
              .reviewExists(eventRepoPath, comp)
              .then((exists) => {
                if (!exists) {
                  console.log(
                    "[watcher] Active review was deleted externally, clearing active key",
                  );
                  setActiveReviewKeyRef.current(null);
                } else {
                  console.log("[watcher] Reloading review state...");
                  loadReviewStateRef.current();
                }
              })
              .catch(() => {
                // If the check fails, fall back to reloading
                loadReviewStateRef.current();
              })
              .finally(() => {
                loadGlobalReviewsRef.current();
              });
            return;
          }
          console.log("[watcher] Reloading review state...");
          loadReviewStateRef.current();
        }
        // Refresh sidebar for external review state changes
        loadGlobalReviewsRef.current();
      }),
    );
    console.log("[watcher] Listening for review-state-changed");

    // Git state changed (branch switch, new commit, etc.)
    // Debounce at 2s to avoid rapid refreshes during active editing
    unlistenFns.push(
      apiClient.onGitChanged((eventRepoPath) => {
        console.log("[watcher] Received git-changed event:", eventRepoPath);
        if (eventRepoPath === repoPathRef.current) {
          // Only refresh if a comparison has been selected (not on start screen)
          if (!comparisonReadyRef.current) {
            console.log("[watcher] Skipping refresh - no comparison selected");
            return;
          }
          // Clear any pending debounce timer
          if (gitChangedTimerRef.current) {
            clearTimeout(gitChangedTimerRef.current);
          }
          console.log("[watcher] Debouncing refresh (2s)...");
          gitChangedTimerRef.current = setTimeout(() => {
            gitChangedTimerRef.current = null;
            console.log("[watcher] Refreshing...");
            refreshRef.current();
          }, 2000);
        }
        // Always update sidebar freshness on git changes
        checkReviewsFreshnessRef.current();
      }),
    );
    console.log("[watcher] Listening for git-changed");

    return () => {
      if (gitChangedTimerRef.current) {
        clearTimeout(gitChangedTimerRef.current);
      }
      unlistenFns.forEach((fn) => fn());
    };
  }, [repoPath]);
}
