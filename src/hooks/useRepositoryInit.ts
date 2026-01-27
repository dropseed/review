import { useEffect, useState, useCallback } from "react";
import { makeComparison, type Comparison } from "../types";
import { setLoggerRepoPath, clearLog } from "../utils/logger";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";

// Get repo path from URL query parameter (for multi-window support)
function getRepoPathFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("repo");
}

// Get comparison key from URL query parameter (for multi-window support)
function getComparisonKeyFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("comparison");
}

// Parse comparison key back into a Comparison object
// Key format: "old..new" or "old..new+working-tree"
function parseComparisonKey(key: string): Comparison | null {
  const workingTree = key.endsWith("+working-tree");
  const cleanKey = workingTree ? key.replace("+working-tree", "") : key;

  const parts = cleanKey.split("..");
  if (parts.length !== 2) return null;

  const [oldRef, newRef] = parts;
  if (!oldRef || !newRef) return null;

  return makeComparison(oldRef, newRef, workingTree);
}

interface UseRepositoryInitOptions {
  repoPath: string | null;
  setRepoPath: (path: string) => void;
  setComparison: (comparison: Comparison) => void;
  saveCurrentComparison: () => void;
}

interface UseRepositoryInitReturn {
  showStartScreen: boolean;
  setShowStartScreen: (show: boolean) => void;
  comparisonReady: boolean;
  setComparisonReady: (ready: boolean) => void;
  initialLoading: boolean;
  setInitialLoading: (loading: boolean) => void;
  handleSelectReview: (comparison: Comparison) => void;
  handleBackToStart: () => void;
  handleOpenRepo: () => Promise<void>;
}

/**
 * Handles repository initialization, URL parsing, and comparison setup.
 */
export function useRepositoryInit({
  repoPath,
  setRepoPath,
  setComparison,
  saveCurrentComparison,
}: UseRepositoryInitOptions): UseRepositoryInitReturn {
  // Start screen state - show by default unless URL has comparison
  const [showStartScreen, setShowStartScreen] = useState(true);
  const [comparisonReady, setComparisonReady] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);

  // Initialize repo path from URL or API
  useEffect(() => {
    // Check URL for repo path first (multi-window support)
    const urlRepoPath = getRepoPathFromUrl();
    if (urlRepoPath) {
      setRepoPath(urlRepoPath);
      setLoggerRepoPath(urlRepoPath);
      clearLog(); // Start fresh each session
      return;
    }

    // Fall back to getting current working directory from API
    const apiClient = getApiClient();
    apiClient
      .getCurrentRepo()
      .then((path) => {
        setRepoPath(path);
        setLoggerRepoPath(path);
        clearLog(); // Start fresh each session
      })
      .catch(console.error);
  }, [setRepoPath]);

  // Check URL for comparison when repo path changes
  // If URL has comparison, skip start screen; otherwise show start screen
  useEffect(() => {
    if (repoPath) {
      setComparisonReady(false);

      // Check URL for comparison (multi-window support with specific comparison)
      const urlComparisonKey = getComparisonKeyFromUrl();
      if (urlComparisonKey) {
        const parsedComparison = parseComparisonKey(urlComparisonKey);
        if (parsedComparison) {
          setComparison(parsedComparison);
          setComparisonReady(true);
          setInitialLoading(true);
          setShowStartScreen(false); // Skip start screen if URL has comparison
          return;
        }
      }

      // No URL comparison - show start screen
      setShowStartScreen(true);
      setComparisonReady(false);
    }
  }, [repoPath, setComparison]);

  // Handle selecting a review from the start screen
  const handleSelectReview = useCallback(
    (selectedComparison: Comparison) => {
      setComparison(selectedComparison);
      saveCurrentComparison();
      setComparisonReady(true);
      setInitialLoading(true);
      setShowStartScreen(false);
    },
    [setComparison, saveCurrentComparison],
  );

  // Handle going back to the start screen
  const handleBackToStart = useCallback(() => {
    setShowStartScreen(true);
  }, []);

  // Open a new window with a different repository
  const handleOpenRepo = useCallback(async () => {
    const platform = getPlatformServices();
    const apiClient = getApiClient();
    try {
      const selected = await platform.dialogs.openDirectory({
        title: "Open Repository",
      });

      if (selected) {
        // Open in a new window
        await apiClient.openRepoWindow(selected);
      }
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, []);

  return {
    showStartScreen,
    setShowStartScreen,
    comparisonReady,
    setComparisonReady,
    initialLoading,
    setInitialLoading,
    handleSelectReview,
    handleBackToStart,
    handleOpenRepo,
  };
}
