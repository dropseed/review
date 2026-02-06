import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { makeComparison, type Comparison } from "../types";
import type { GlobalReviewSummary } from "../types";
import { initLogPath, clearLog } from "../utils/logger";
import { resolveRepoIdentity } from "../utils/repo-identity";
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
// Key format: "old..new"
function parseComparisonKey(key: string): Comparison | null {
  const parts = key.split("..");
  if (parts.length !== 2) return null;

  const [oldRef, newRef] = parts;
  if (!oldRef || !newRef) return null;

  // workingTree will be auto-determined at diff time based on current branch
  return makeComparison(oldRef, newRef, false);
}

/**
 * Get the default comparison for a repo (default branch vs current branch).
 * Working tree changes are auto-included when the user is on the compare branch.
 */
async function getDefaultComparison(
  repoPath: string,
): Promise<{ key: string; comparison: Comparison; defaultBranch: string }> {
  const apiClient = getApiClient();
  const [defaultBranch, currentBranch] = await Promise.all([
    apiClient.getDefaultBranch(repoPath).catch(() => "main"),
    apiClient.getCurrentBranch(repoPath).catch(() => "HEAD"),
  ]);
  const key = `${defaultBranch}..${currentBranch}`;
  const comparison = makeComparison(defaultBranch, currentBranch, true);
  return { key, comparison, defaultBranch };
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
  handleOpenRepo: () => Promise<void>;
  handleNewWindow: () => Promise<void>;
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => void;
  handleActivateReview: (review: GlobalReviewSummary) => void;
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
  const setActiveReviewKey = useReviewStore((s) => s.setActiveReviewKey);
  const loadGlobalReviews = useReviewStore((s) => s.loadGlobalReviews);
  const ensureReviewExists = useReviewStore((s) => s.ensureReviewExists);

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

  // When a review is activated explicitly (sidebar click), skip the automatic
  // loadCurrentComparison that fires on repoPath changes.
  const skipNextComparisonLoadRef = useRef(false);

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
        initLogPath(urlRepoPath);
        clearLog();
        setRepoStatus("found");
        addRecentRepository(urlRepoPath);
        storeRepoPath(urlRepoPath);

        // Resolve owner/repo and navigate to review route
        const { routePrefix } = await resolveRepoIdentity(urlRepoPath);
        const urlComparisonKey = getComparisonKeyFromUrl();
        if (urlComparisonKey) {
          const comparison = parseComparisonKey(urlComparisonKey);
          if (comparison) {
            setActiveReviewKey({
              repoPath: urlRepoPath,
              comparisonKey: urlComparisonKey,
            });
            await ensureReviewExists(urlRepoPath, comparison);
          }
          nav(`/${routePrefix}/review/${urlComparisonKey}`, { replace: true });
        } else {
          // Default to working tree comparison
          const { key, comparison } = await getDefaultComparison(urlRepoPath);
          setActiveReviewKey({
            repoPath: urlRepoPath,
            comparisonKey: key,
          });
          await ensureReviewExists(urlRepoPath, comparison);
          nav(`/${routePrefix}/review/${key}`, { replace: true });
        }
        loadGlobalReviews();
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
        initLogPath(storedPath);
        setRepoStatus("found");
        addRecentRepository(storedPath);
        return;
      }

      // Fall back to getting current working directory from API
      const apiClient = getApiClient();
      try {
        const path = await apiClient.getCurrentRepo();
        setRepoPath(path);
        initLogPath(path);
        clearLog();
        setRepoStatus("found");
        addRecentRepository(path);
        storeRepoPath(path);

        // Resolve and navigate to review route (working tree by default)
        const { routePrefix } = await resolveRepoIdentity(path);
        const { key, comparison } = await getDefaultComparison(path);
        setActiveReviewKey({
          repoPath: path,
          comparisonKey: key,
        });
        await ensureReviewExists(path, comparison);
        nav(`/${routePrefix}/review/${key}`, { replace: true });
        loadGlobalReviews();
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
  }, [
    setRepoPath,
    addRecentRepository,
    setActiveReviewKey,
    ensureReviewExists,
    loadGlobalReviews,
  ]);

  // When repo path changes, always load a comparison
  useEffect(() => {
    if (repoPath) {
      // If comparison was explicitly set (e.g. sidebar click), skip auto-detection
      if (skipNextComparisonLoadRef.current) {
        skipNextComparisonLoadRef.current = false;
        return;
      }

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

  // Handle closing the current repo (go to welcome page)
  const handleCloseRepo = useCallback(() => {
    setRepoPath(null);
    setRepoStatus("welcome");
    setRepoError(null);
    setComparisonReady(false);
    sessionStorage.setItem(REPO_PATH_KEY, "");
    navigateRef.current("/");
  }, [setRepoPath]);

  // Shared logic: validate, activate, and navigate to a repo's working tree
  const activateRepo = useCallback(
    async (path: string) => {
      if (!(await validateGitRepo(path))) return;

      setRepoPath(path);
      initLogPath(path);
      clearLog();
      setRepoStatus("found");
      setRepoError(null);
      addRecentRepository(path);
      storeRepoPath(path);

      const { routePrefix } = await resolveRepoIdentity(path);
      const { key, comparison } = await getDefaultComparison(path);
      setActiveReviewKey({
        repoPath: path,
        comparisonKey: key,
      });
      await ensureReviewExists(path, comparison);
      navigateRef.current(`/${routePrefix}/review/${key}`);
      loadGlobalReviews();
    },
    [
      setRepoPath,
      addRecentRepository,
      setActiveReviewKey,
      ensureReviewExists,
      loadGlobalReviews,
    ],
  );

  // Handle selecting a repo (from welcome page recent list or tab rail)
  const handleSelectRepo = useCallback(
    (path: string) => activateRepo(path),
    [activateRepo],
  );

  // Open a repository in the current window (standard Cmd+O behavior)
  const handleOpenRepo = useCallback(async () => {
    const platform = getPlatformServices();
    try {
      const selected = await platform.dialogs.openDirectory({
        title: "Open Repository",
      });
      if (selected) {
        await activateRepo(selected);
      }
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, [activateRepo]);

  // Open a new window (Cmd+N behavior)
  const handleNewWindow = useCallback(async () => {
    const apiClient = getApiClient();
    try {
      await apiClient.openRepoWindow("");
    } catch (err) {
      console.error("Failed to open new window:", err);
    }
  }, []);

  // Activate a specific review from the sidebar — sets repo + comparison
  // atomically, bypassing the automatic loadCurrentComparison flow.
  const handleActivateReview = useCallback(
    (review: GlobalReviewSummary) => {
      const nav = navigateRef.current;
      const state = useReviewStore.getState();
      const meta = state.repoMetadata[review.repoPath];
      const routePrefix = meta?.routePrefix ?? `local/${review.repoName}`;

      setActiveReviewKey({
        repoPath: review.repoPath,
        comparisonKey: review.comparison.key,
      });

      // If repo is changing, skip the automatic loadCurrentComparison
      if (review.repoPath !== state.repoPath) {
        skipNextComparisonLoadRef.current = true;
        setRepoPath(review.repoPath);
      }

      // Always set comparison (clears stale data, saves, loads review state)
      setComparison(review.comparison);

      // Mark ready so useComparisonLoader fires
      setComparisonReady(true);
      setInitialLoading(true);

      nav(`/${routePrefix}/review/${review.comparison.key}`);
    },
    [setActiveReviewKey, setRepoPath, setComparison],
  );

  return {
    repoStatus,
    repoError,
    comparisonReady,
    setComparisonReady,
    initialLoading,
    setInitialLoading,
    handleOpenRepo,
    handleNewWindow,
    handleCloseRepo,
    handleSelectRepo,
    handleActivateReview,
  };
}
