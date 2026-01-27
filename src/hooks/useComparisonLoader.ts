import { useEffect } from "react";

interface UseComparisonLoaderOptions {
  repoPath: string | null;
  comparisonReady: boolean;
  showStartScreen: boolean;
  comparisonKey: string;
  loadFiles: (skipAutoClassify?: boolean) => Promise<void>;
  loadAllFiles: () => Promise<void>;
  loadReviewState: () => Promise<void>;
  loadGitStatus: () => Promise<void>;
  triggerAutoClassification: () => void;
  setInitialLoading: (loading: boolean) => void;
}

/**
 * Coordinates loading of files and review state when comparison is ready.
 */
export function useComparisonLoader({
  repoPath,
  comparisonReady,
  showStartScreen,
  comparisonKey,
  loadFiles,
  loadAllFiles,
  loadReviewState,
  loadGitStatus,
  triggerAutoClassification,
  setInitialLoading,
}: UseComparisonLoaderOptions) {
  // Load files and review state when comparison is ready and not on start screen
  useEffect(() => {
    if (repoPath && comparisonReady && !showStartScreen) {
      const loadData = async () => {
        try {
          // Load review state FIRST to ensure labels are available before auto-classification
          await loadReviewState();
          // Then load files (skip auto-classify) and other data in parallel
          await Promise.all([loadFiles(true), loadAllFiles(), loadGitStatus()]);
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
    showStartScreen,
    comparisonKey,
    loadFiles,
    loadAllFiles,
    loadReviewState,
    loadGitStatus,
    triggerAutoClassification,
    setInitialLoading,
  ]);
}
