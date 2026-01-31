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
  const triggerAutoClassification = useReviewStore(
    (s) => s.triggerAutoClassification,
  );

  useEffect(() => {
    if (repoPath && comparisonReady) {
      const loadData = async () => {
        try {
          // Load review state FIRST to ensure labels are available before auto-classification
          await loadReviewState();
          // Then load files (skip auto-classify) and other data in parallel
          await Promise.all([
            loadFiles(true),
            loadAllFiles(),
            loadGitStatus(),
            loadRemoteInfo(),
            loadCommits(repoPath),
          ]);
          // Now trigger auto-classification with the loaded review state
          triggerAutoClassification();
        } catch (err) {
          console.error("Failed to load data:", err);
        } finally {
          setInitialLoading(false);
        }
      };
      loadData();
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
    triggerAutoClassification,
    setInitialLoading,
  ]);
}
