import { useEffect, useState, useCallback } from "react";
import { makeComparison, type Comparison } from "../types";
import { setLoggerRepoPath, clearLog } from "../utils/logger";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";
import { useReviewStore } from "../stores/reviewStore";

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

// Repository status for distinguishing loading states
export type RepoStatus = "loading" | "found" | "not_found" | "error";

type AppView = "start" | "review";

interface UseRepositoryInitReturn {
  repoStatus: RepoStatus;
  repoError: string | null;
  view: AppView;
  comparisonReady: boolean;
  setComparisonReady: (ready: boolean) => void;
  initialLoading: boolean;
  setInitialLoading: (loading: boolean) => void;
  handleSelectReview: (comparison: Comparison) => void;
  handleBackToStart: () => void;
  handleOpenRepo: () => Promise<void>;
  handleNewWindow: () => Promise<void>;
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => void;
}

/**
 * Handles repository initialization, URL parsing, and comparison setup.
 * Always loads a comparison on startup (from URL, last active, or default).
 */
export function useRepositoryInit(): UseRepositoryInitReturn {
  const repoPath = useReviewStore((s) => s.repoPath);
  const setRepoPath = useReviewStore((s) => s.setRepoPath);
  const setComparison = useReviewStore((s) => s.setComparison);
  const loadCurrentComparison = useReviewStore((s) => s.loadCurrentComparison);
  const saveCurrentComparison = useReviewStore((s) => s.saveCurrentComparison);
  const addRecentRepository = useReviewStore((s) => s.addRecentRepository);

  // Repository status tracking
  const [repoStatus, setRepoStatus] = useState<RepoStatus>("loading");
  const [repoError, setRepoError] = useState<string | null>(null);

  const [view, setView] = useState<AppView>("review");
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
      setRepoStatus("found");
      addRecentRepository(urlRepoPath);
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
        setRepoStatus("found");
        addRecentRepository(path);
      })
      .catch((err) => {
        const errorMessage = err instanceof Error ? err.message : String(err);
        // Distinguish "not a repo" from actual errors
        if (
          errorMessage.includes("Not a git repository") ||
          errorMessage.includes("not a git repository") ||
          errorMessage.includes("No git repository found")
        ) {
          setRepoStatus("not_found");
        } else {
          setRepoStatus("error");
          setRepoError(errorMessage);
        }
        console.error("Repository init error:", err);
      });
  }, [setRepoPath, addRecentRepository]);

  // When repo path changes, always load a comparison
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
          return;
        }
      }

      // No URL comparison — load last active (falls back to default_branch..working_tree)
      loadCurrentComparison()
        .then(() => {
          setComparisonReady(true);
          setInitialLoading(true);
        })
        .catch((err) => {
          console.error("Failed to load current comparison:", err);
          setComparisonReady(true);
          setInitialLoading(true);
        });
    }
  }, [repoPath, setComparison, loadCurrentComparison]);

  // Handle selecting a review from the start screen or reviews list
  const handleSelectReview = useCallback(
    (selectedComparison: Comparison) => {
      const currentKey = useReviewStore.getState().comparison.key;
      setComparison(selectedComparison);
      saveCurrentComparison();
      setComparisonReady(true);
      // Only show loading spinner if the comparison actually changed;
      // if the same review is re-selected, data is already loaded.
      if (selectedComparison.key !== currentKey) {
        setInitialLoading(true);
      }
      setView("review");
    },
    [setComparison, saveCurrentComparison],
  );

  // Navigate back to start screen
  const handleBackToStart = useCallback(() => {
    setView("start");
  }, []);

  // Handle closing the current repo (go to welcome page)
  const handleCloseRepo = useCallback(() => {
    setRepoPath(null);
    setRepoStatus("not_found");
    setRepoError(null);
    setComparisonReady(false);
  }, [setRepoPath]);

  // Handle selecting a repo (from welcome page recent list)
  const handleSelectRepo = useCallback(
    (path: string) => {
      setRepoPath(path);
      setLoggerRepoPath(path);
      clearLog();
      setRepoStatus("found");
      setRepoError(null);
      addRecentRepository(path);
    },
    [setRepoPath, addRecentRepository],
  );

  // Open a repository in the current window (standard Cmd+O behavior)
  const handleOpenRepo = useCallback(async () => {
    const platform = getPlatformServices();
    try {
      const selected = await platform.dialogs.openDirectory({
        title: "Open Repository",
      });

      if (selected) {
        // Open in current window
        setRepoPath(selected);
        setLoggerRepoPath(selected);
        clearLog();
        setRepoStatus("found");
        setRepoError(null);
        addRecentRepository(selected);
      }
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, [setRepoPath, addRecentRepository]);

  // Open a new window (Cmd+N behavior)
  const handleNewWindow = useCallback(async () => {
    const apiClient = getApiClient();
    try {
      // Open a new window - pass empty string to get welcome page
      await apiClient.openRepoWindow("");
    } catch (err) {
      console.error("Failed to open new window:", err);
    }
  }, []);

  return {
    repoStatus,
    repoError,
    view,
    comparisonReady,
    setComparisonReady,
    initialLoading,
    setInitialLoading,
    handleSelectReview,
    handleBackToStart,
    handleOpenRepo,
    handleNewWindow,
    handleCloseRepo,
    handleSelectRepo,
  };
}
