import { useEffect } from "react";

interface UseComparisonLoaderOptions {
  repoPath: string | null;
  comparisonReady: boolean;
  comparisonKey: string;
  loadFiles: (skipAutoClassify?: boolean) => Promise<void>;
  loadAllFiles: () => Promise<void>;
  loadReviewState: () => Promise<void>;
  loadGitStatus: () => Promise<void>;
  loadCommits: (repoPath: string, limit?: number) => Promise<void>;
  triggerAutoClassification: () => void;
  setInitialLoading: (loading: boolean) => void;
}

/**
 * Coordinates loading of files, review state, and commits when comparison is ready.
 */
export function useComparisonLoader({
  repoPath,
  comparisonReady,
  comparisonKey,
  loadFiles,
  loadAllFiles,
  loadReviewState,
  loadGitStatus,
  loadCommits,
  triggerAutoClassification,
  setInitialLoading,
}: UseComparisonLoaderOptions) {
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
    loadCommits,
    triggerAutoClassification,
    setInitialLoading,
  ]);
}
