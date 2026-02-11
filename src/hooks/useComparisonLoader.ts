import { useEffect } from "react";
import { useReviewStore } from "../stores";

/**
 * Coordinates loading of files, review state, and commits when comparison is ready.
 */
export function useComparisonLoader(
  comparisonReady: boolean,
  setInitialLoading: (loading: boolean) => void,
) {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparisonKey = useReviewStore((s) => s.comparison.key);
  const loadFiles = useReviewStore((s) => s.loadFiles);
  const loadAllFiles = useReviewStore((s) => s.loadAllFiles);
  const loadReviewState = useReviewStore((s) => s.loadReviewState);
  const loadGitStatus = useReviewStore((s) => s.loadGitStatus);
  const loadRemoteInfo = useReviewStore((s) => s.loadRemoteInfo);
  const loadCommits = useReviewStore((s) => s.loadCommits);
  const classifyStaticHunks = useReviewStore((s) => s.classifyStaticHunks);
  const syncTotalDiffHunks = useReviewStore((s) => s.syncTotalDiffHunks);
  const restoreGuideFromState = useReviewStore((s) => s.restoreGuideFromState);
  const loadSymbols = useReviewStore((s) => s.loadSymbols);

  useEffect(() => {
    if (repoPath && comparisonReady) {
      let cancelled = false;
      const loadData = async () => {
        try {
          // Load review state FIRST to ensure labels are available before auto-classification
          await loadReviewState();
          if (cancelled) return;
          // Then load files and other data in parallel
          await Promise.all([
            loadFiles(),
            loadAllFiles(),
            loadGitStatus(),
            loadRemoteInfo(),
            loadCommits(repoPath),
          ]);
          if (cancelled) return;
          // Sync total diff hunk count into review state for accurate sidebar progress
          syncTotalDiffHunks();
          // Run static (rule-based) classification only — no AI on load
          classifyStaticHunks();
          // Restore guide data from persisted state (if still fresh)
          restoreGuideFromState();
          // Load symbols eagerly (also computes symbol-linked hunks)
          await loadSymbols();
        } catch (err) {
          if (!cancelled) console.error("Failed to load data:", err);
        } finally {
          if (!cancelled) setInitialLoading(false);
        }
      };
      loadData();
      return () => {
        cancelled = true;
      };
    }
  }, [
    repoPath,
    comparisonReady,
    comparisonKey,
    loadFiles,
    loadAllFiles,
    loadReviewState,
    loadGitStatus,
    loadRemoteInfo,
    loadCommits,
    classifyStaticHunks,
    syncTotalDiffHunks,
    restoreGuideFromState,
    loadSymbols,
    setInitialLoading,
  ]);
}
