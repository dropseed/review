import { useEffect, useRef } from "react";
import { getApiClient } from "../api";

interface UseFileWatcherOptions {
  repoPath: string | null;
  comparisonReady: boolean;
  loadReviewState: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * Manages file watcher lifecycle and listens for review state/git change events.
 */
export function useFileWatcher({
  repoPath,
  comparisonReady,
  loadReviewState,
  refresh,
}: UseFileWatcherOptions) {
  // Use refs to avoid stale closures in event handlers
  const repoPathRef = useRef(repoPath);
  const loadReviewStateRef = useRef(loadReviewState);
  const refreshRef = useRef(refresh);
  const comparisonReadyRef = useRef(comparisonReady);

  useEffect(() => {
    repoPathRef.current = repoPath;
    loadReviewStateRef.current = loadReviewState;
    refreshRef.current = refresh;
    comparisonReadyRef.current = comparisonReady;
  }, [repoPath, loadReviewState, refresh, comparisonReady]);

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
        if (eventRepoPath === repoPathRef.current) {
          console.log("[watcher] Reloading review state...");
          loadReviewStateRef.current();
        }
      }),
    );
    console.log("[watcher] Listening for review-state-changed");

    // Git state changed (branch switch, new commit, etc.)
    unlistenFns.push(
      apiClient.onGitChanged((eventRepoPath) => {
        console.log("[watcher] Received git-changed event:", eventRepoPath);
        if (eventRepoPath === repoPathRef.current) {
          // Only refresh if a comparison has been selected (not on start screen)
          if (!comparisonReadyRef.current) {
            console.log("[watcher] Skipping refresh - no comparison selected");
            return;
          }
          console.log("[watcher] Refreshing...");
          refreshRef.current();
        }
      }),
    );
    console.log("[watcher] Listening for git-changed");

    return () => {
      unlistenFns.forEach((fn) => fn());
    };
  }, [repoPath]);
}
