import { useEffect } from "react";
import { getApiClient } from "../api";
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
  const comparisonKey = useReviewStore((s) => s.comparison?.key);
  const isStandaloneFile = useReviewStore((s) => s.isStandaloneFile);

  // Browse mode (git repo): load repo files and current branch when no comparison is set
  useEffect(() => {
    if (!repoPath || comparisonKey || isStandaloneFile) return;

    const { loadRepoFiles, loadCurrentBranch } = useReviewStore.getState();

    let cancelled = false;

    async function loadBrowseData(): Promise<void> {
      try {
        await Promise.all([loadRepoFiles(), loadCurrentBranch()]);
      } catch (err) {
        if (!cancelled) console.error("Failed to load browse data:", err);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    loadBrowseData();

    return () => {
      cancelled = true;
    };
  }, [repoPath, comparisonKey, isStandaloneFile, setInitialLoading]);

  // Standalone mode (non-git): load directory contents
  useEffect(() => {
    if (!repoPath || !isStandaloneFile) return;

    let cancelled = false;

    async function loadStandaloneData(): Promise<void> {
      try {
        const files = await getApiClient().listDirectoryPlain(repoPath!);
        if (!cancelled) {
          useReviewStore.setState({ allFiles: files, allFilesLoading: false });
        }
      } catch (err) {
        if (!cancelled) console.error("Failed to load directory:", err);
      } finally {
        if (!cancelled) setInitialLoading(false);
      }
    }

    loadStandaloneData();

    return () => {
      cancelled = true;
    };
  }, [repoPath, isStandaloneFile, setInitialLoading]);

  // Review mode: load files and review state when comparison is ready
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
      restoreNavigationSnapshot,
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
        // Restore navigation snapshot (selected file, view mode) from last visit
        restoreNavigationSnapshot();
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
