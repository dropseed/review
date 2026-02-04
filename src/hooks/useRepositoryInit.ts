import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { makeComparison, type Comparison } from "../types";
import { setLoggerRepoPath, clearLog } from "../utils/logger";
import { getApiClient } from "../api";
import { getPlatformServices } from "../platform";
import { useReviewStore } from "../stores";

// Session storage key for the local repo path
const REPO_PATH_KEY = "repoPath";

/** Store the local repo path in sessionStorage */
function storeRepoPath(path: string) {
  sessionStorage.setItem(REPO_PATH_KEY, path);
}

/** Get the local repo path from sessionStorage */
export function getStoredRepoPath(): string | null {
  return sessionStorage.getItem(REPO_PATH_KEY);
}

// Get repo path from URL query parameter (for multi-window bootstrap)
function getRepoPathFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get("repo");
}

// Get comparison key from URL query parameter (for multi-window bootstrap)
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

/**
 * Resolve the route prefix (owner/repo) from a repo path.
 * Uses the git remote to get "owner/repo", falls back to "local/dirname".
 */
async function resolveRoutePrefix(repoPath: string): Promise<string> {
  try {
    const apiClient = getApiClient();
    const info = await apiClient.getRemoteInfo(repoPath);
    if (info?.name) {
      return info.name; // e.g. "dropseed/plain"
    }
  } catch {
    // Fall through to local fallback
  }
  // No remote — use directory name
  const parts = repoPath.replace(/\/+$/, "").split("/");
  const dirname = parts[parts.length - 1] || "repo";
  return `local/${dirname}`;
}

/**
 * Get the working tree comparison key for a repo.
 * Returns `defaultBranch..currentBranch+working-tree`
 */
async function getWorkingTreeComparisonKey(repoPath: string): Promise<string> {
  const apiClient = getApiClient();
  const [defaultBranch, currentBranch] = await Promise.all([
    apiClient.getDefaultBranch(repoPath).catch(() => "main"),
    apiClient.getCurrentBranch(repoPath).catch(() => "HEAD"),
  ]);
  return `${defaultBranch}..${currentBranch}+working-tree`;
}

/**
 * Validate that a path is a git repository, showing an error dialog if not.
 * Returns true if valid, false otherwise.
 */
async function validateGitRepo(path: string): Promise<boolean> {
  const apiClient = getApiClient();
  const platform = getPlatformServices();

  const isRepo = await apiClient.isGitRepo(path);
  if (!isRepo) {
    await platform.dialogs.message(
      "The selected directory is not a git repository.",
      { title: "Not a Git Repository", kind: "error" },
    );
    return false;
  }
  return true;
}

// Repository status for distinguishing loading states
export type RepoStatus =
  | "loading"
  | "found"
  | "not_found"
  | "welcome"
  | "error";

interface UseRepositoryInitReturn {
  repoStatus: RepoStatus;
  repoError: string | null;
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
 *
 * On mount, reads ?repo= from URL (Tauri bootstrap), stores the local path
 * in sessionStorage, resolves owner/repo, then navigates to the clean route.
 */
export function useRepositoryInit(): UseRepositoryInitReturn {
  const navigate = useNavigate();
  const repoPath = useReviewStore((s) => s.repoPath);
  const setRepoPath = useReviewStore((s) => s.setRepoPath);
  const setComparison = useReviewStore((s) => s.setComparison);
  const loadCurrentComparison = useReviewStore((s) => s.loadCurrentComparison);
  const addRecentRepository = useReviewStore((s) => s.addRecentRepository);

  // Repository status tracking
  const [repoStatus, setRepoStatus] = useState<RepoStatus>("loading");
  const [repoError, setRepoError] = useState<string | null>(null);

  const [comparisonReady, setComparisonReady] = useState(false);
  const [initialLoading, setInitialLoading] = useState(false);

  // Keep a stable ref for navigate so the init effect doesn't re-run
  // when the route changes (react-router v7 can change the navigate reference)
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Guard to ensure init only runs once
  const hasInitializedRef = useRef(false);

  // Initialize repo path from URL or API, then navigate to clean route
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const init = async () => {
      const nav = navigateRef.current;

      // Check URL for repo path first (Tauri bootstrap)
      const urlRepoPath = getRepoPathFromUrl();
      if (urlRepoPath) {
        setRepoPath(urlRepoPath);
        setLoggerRepoPath(urlRepoPath);
        clearLog();
        setRepoStatus("found");
        addRecentRepository(urlRepoPath);
        storeRepoPath(urlRepoPath);

        // Resolve owner/repo and navigate to review route
        const prefix = await resolveRoutePrefix(urlRepoPath);
        const urlComparisonKey = getComparisonKeyFromUrl();
        if (urlComparisonKey) {
          nav(`/${prefix}/review/${urlComparisonKey}`, { replace: true });
        } else {
          // Default to working tree comparison
          const workingTreeKey = await getWorkingTreeComparisonKey(urlRepoPath);
          nav(`/${prefix}/review/${workingTreeKey}`, { replace: true });
        }
        return;
      }

      // Check sessionStorage (page refresh case)
      // null = key absent (first launch) → fall through to cwd detection
      // "" = empty sentinel (user closed repo) → stay on welcome
      // path string = page refresh mid-session → restore the repo
      const storedPath = getStoredRepoPath();
      if (storedPath !== null) {
        if (storedPath === "") {
          // User previously closed the repo — stay on welcome
          setRepoStatus("welcome");
          return;
        }
        setRepoPath(storedPath);
        setLoggerRepoPath(storedPath);
        setRepoStatus("found");
        addRecentRepository(storedPath);
        return;
      }

      // Fall back to getting current working directory from API
      const apiClient = getApiClient();
      try {
        const path = await apiClient.getCurrentRepo();
        setRepoPath(path);
        setLoggerRepoPath(path);
        clearLog();
        setRepoStatus("found");
        addRecentRepository(path);
        storeRepoPath(path);

        // Resolve and navigate to review route (working tree by default)
        const prefix = await resolveRoutePrefix(path);
        const workingTreeKey = await getWorkingTreeComparisonKey(path);
        nav(`/${prefix}/review/${workingTreeKey}`, { replace: true });
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
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
      }
    };

    init();
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
    async (selectedComparison: Comparison) => {
      const currentKey = useReviewStore.getState().comparison.key;

      // Only reset state when switching to a different comparison.
      // setComparison already persists via saveCurrentComparison internally.
      if (selectedComparison.key !== currentKey) {
        setComparison(selectedComparison);
        setComparisonReady(true);
        setInitialLoading(true);
      }

      // Navigate to the review route
      if (repoPath) {
        const prefix = await resolveRoutePrefix(repoPath);
        navigateRef.current(`/${prefix}/review/${selectedComparison.key}`);
      }
    },
    [setComparison, repoPath],
  );

  // Navigate back to start screen
  const handleBackToStart = useCallback(async () => {
    if (repoPath) {
      const prefix = await resolveRoutePrefix(repoPath);
      navigateRef.current(`/${prefix}`);
    } else {
      navigateRef.current("/");
    }
  }, [repoPath]);

  // Handle closing the current repo (go to welcome page)
  const handleCloseRepo = useCallback(() => {
    setRepoPath(null);
    setRepoStatus("welcome");
    setRepoError(null);
    setComparisonReady(false);
    sessionStorage.setItem(REPO_PATH_KEY, "");
    navigateRef.current("/");
  }, [setRepoPath]);

  // Handle selecting a repo (from welcome page recent list)
  const handleSelectRepo = useCallback(
    async (path: string) => {
      if (!(await validateGitRepo(path))) return;

      setRepoPath(path);
      setLoggerRepoPath(path);
      clearLog();
      setRepoStatus("found");
      setRepoError(null);
      addRecentRepository(path);
      storeRepoPath(path);

      // Resolve and navigate directly to review (working tree by default)
      const prefix = await resolveRoutePrefix(path);
      const workingTreeKey = await getWorkingTreeComparisonKey(path);
      navigateRef.current(`/${prefix}/review/${workingTreeKey}`);
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
        if (!(await validateGitRepo(selected))) return;

        setRepoPath(selected);
        setLoggerRepoPath(selected);
        clearLog();
        setRepoStatus("found");
        setRepoError(null);
        addRecentRepository(selected);
        storeRepoPath(selected);

        // Resolve and navigate directly to review (working tree by default)
        const prefix = await resolveRoutePrefix(selected);
        const workingTreeKey = await getWorkingTreeComparisonKey(selected);
        navigateRef.current(`/${prefix}/review/${workingTreeKey}`);
      }
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, [setRepoPath, addRecentRepository]);

  // Open a new window (Cmd+N behavior)
  const handleNewWindow = useCallback(async () => {
    const apiClient = getApiClient();
    try {
      await apiClient.openRepoWindow("");
    } catch (err) {
      console.error("Failed to open new window:", err);
    }
  }, []);

  return {
    repoStatus,
    repoError,
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
