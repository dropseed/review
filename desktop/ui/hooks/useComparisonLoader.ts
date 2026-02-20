import { useEffect } from "react";
import { useReviewStore } from "../stores";

/**
 * Coordinates loading of files and review state when comparison is ready.
 *
 * Data loaded lazily by their respective UI components:
 * - Commits: CommitsPanel triggers loadCommits on mount
 * - Symbols: FilesPanel triggers loadSymbols when flat mode is entered
 */
export function useComparisonLoader(
  comparisonReady: number,
  setInitialLoading: (loading: boolean) => void,
): void {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparisonKey = useReviewStore((s) => s.comparison.key);

  useEffect(() => {
    if (!repoPath || !comparisonReady) return;

    // Actions are stable Zustand references -- safe to read from getState()
    const {
      clearSearch,
      startActivity,
      endActivity,
      loadReviewState,
      loadFiles,
      loadAllFiles,
      loadGitStatus,
      loadRemoteInfo,
      syncTotalDiffHunks,
      classifyStaticHunks,
      restoreGuideFromState,
    } = useReviewStore.getState();

    // Clear stale search results from previous comparison
    clearSearch();

    let cancelled = false;

    async function loadData(): Promise<void> {
      try {
        // Load review state and files in parallel
        // (review state is only needed by classifyStaticHunks, which runs after both complete)
        startActivity("load-state", "Loading review state", 10);
        await Promise.all([
          loadReviewState().then(() => endActivity("load-state")),
          loadFiles(),
          loadAllFiles(),
          loadGitStatus(),
        ]);
        if (cancelled) return;

        // Sync total diff hunk count into review state for accurate sidebar progress
        syncTotalDiffHunks();
        // Run static (rule-based) classification only -- no AI on load
        classifyStaticHunks();
        // Restore guide data from persisted state (if still fresh)
        restoreGuideFromState();
        // Fire-and-forget: remote info is cosmetic (header breadcrumb)
        loadRemoteInfo();
      } catch (err) {
        if (!cancelled) console.error("Failed to load data:", err);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    loadData();

    return () => {
      cancelled = true;
    };
  }, [repoPath, comparisonReady, comparisonKey, setInitialLoading]);
}
