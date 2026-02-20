import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { makeComparison, type Comparison, type GitHubPrRef } from "../types";
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

/** Extract bootstrap parameters from URL query string (set by Tauri on window creation). */
function getUrlParams(): {
  repoPath: string | null;
  comparisonKey: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  return {
    repoPath: params.get("repo"),
    comparisonKey: params.get("comparison"),
  };
}

// Parse comparison key back into a Comparison object
// Key format: "base..head" (base may be empty for snapshots)
export function parseComparisonKey(key: string): Comparison | null {
  const dotIdx = key.indexOf("..");
  if (dotIdx === -1) return null;

  const base = key.slice(0, dotIdx);
  const head = key.slice(dotIdx + 2);
  if (!head) return null;

  return makeComparison(base, head);
}

/**
 * Get the default comparison for a repo (default branch vs current branch).
 * Working tree changes are auto-included when the user is on the compare branch.
 */
async function getDefaultComparison(
  repoPath: string,
): Promise<{ key: string; comparison: Comparison }> {
  const apiClient = getApiClient();
  const [defaultBranch, currentBranch] = await Promise.all([
    apiClient.getDefaultBranch(repoPath).catch(() => "main"),
    apiClient.getCurrentBranch(repoPath).catch(() => "HEAD"),
  ]);
  const comparison = makeComparison(defaultBranch, currentBranch);
  return { key: comparison.key, comparison };
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
  handleNewReview: (
    path: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ) => Promise<void>;
}

/**
 * Handles repository initialization, URL parsing, and comparison setup.
 * Always loads a comparison on startup (from URL, last active, or default).
 *
 * Every code path determines the comparison BEFORE touching store state,
 * then uses switchReview() to atomically set both repoPath and comparison
 * in a single store update. This prevents phantom review entries caused by
 * the intermediate state where repoPath is set but comparison still points
 * to the old repo.
 */
export function useRepositoryInit(): UseRepositoryInitReturn {
  const navigate = useNavigate();
  const setRepoPath = useReviewStore((s) => s.setRepoPath);
  const setComparison = useReviewStore((s) => s.setComparison);
  const switchReview = useReviewStore((s) => s.switchReview);
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

  // Initialize repo path from URL or API, then navigate to clean route.
  // Each branch determines the comparison FIRST, then calls switchReview().
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    /** Shared activation: switch to a repo+comparison, navigate, and mark ready. */
    async function initRepo(
      path: string,
      comparison: Comparison,
      options?: { clearLogFile?: boolean; storeInSession?: boolean },
    ): Promise<void> {
      switchReview(path, comparison);
      initLogPath(path);
      if (options?.clearLogFile) clearLog();
      setRepoStatus("found");
      addRecentRepository(path);
      if (options?.storeInSession) storeRepoPath(path);

      setActiveReviewKey({ repoPath: path, comparisonKey: comparison.key });
      await ensureReviewExists(path, comparison);

      const { routePrefix } = await resolveRepoIdentity(path);
      navigateRef.current(`/${routePrefix}/review/${comparison.key}`, {
        replace: true,
      });

      setComparisonReady(true);
      setInitialLoading(true);
      loadGlobalReviews();
    }

    /** Resolve a comparison from an optional key string, falling back to the default. */
    async function resolveComparison(
      repoPath: string,
      comparisonKey: string | null,
    ): Promise<Comparison> {
      if (comparisonKey) {
        const parsed = parseComparisonKey(comparisonKey);
        if (parsed) return parsed;
      }
      const result = await getDefaultComparison(repoPath);
      return result.comparison;
    }

    const init = async () => {
      // Check URL for repo path first (Tauri bootstrap)
      const { repoPath: urlRepoPath, comparisonKey: urlComparisonKey } =
        getUrlParams();
      if (urlRepoPath) {
        const comparison = await resolveComparison(
          urlRepoPath,
          urlComparisonKey,
        );
        await initRepo(urlRepoPath, comparison, {
          clearLogFile: true,
          storeInSession: true,
        });
        return;
      }

      // Check sessionStorage (page refresh case)
      // null = key absent (first launch) -> fall through to cwd detection
      // "" = empty sentinel (user closed repo) -> stay on welcome
      // path string = page refresh mid-session -> restore the repo
      const storedPath = getStoredRepoPath();
      if (storedPath !== null) {
        if (storedPath === "") {
          setRepoStatus("welcome");
          return;
        }

        // Try to recover comparison from the current URL path
        const pathMatch = window.location.pathname.match(/\/review\/([^/]+)$/);
        const urlKey = pathMatch?.[1] ?? null;
        const comparison = await resolveComparison(storedPath, urlKey);
        await initRepo(storedPath, comparison);
        return;
      }

      // Fall back to getting current working directory from API
      const apiClient = getApiClient();
      try {
        const path = await apiClient.getCurrentRepo();
        const comparison = await resolveComparison(path, null);
        await initRepo(path, comparison, {
          clearLogFile: true,
          storeInSession: true,
        });
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
    switchReview,
    addRecentRepository,
    setActiveReviewKey,
    ensureReviewExists,
    loadGlobalReviews,
  ]);

  // Listen for cli:switch-comparison events from Rust (when CLI reuses an existing window)
  useEffect(() => {
    const platform = getPlatformServices();
    const unlisten = platform.menuEvents.on(
      "cli:switch-comparison",
      (payload) => {
        const key = typeof payload === "string" ? payload : null;
        if (!key) return;

        const comparison = parseComparisonKey(key);
        if (!comparison) return;

        const currentRepoPath = useReviewStore.getState().repoPath;
        if (!currentRepoPath) return;

        // Same-repo switch — setComparison is sufficient
        setActiveReviewKey({ repoPath: currentRepoPath, comparisonKey: key });
        setComparison(comparison);
        setComparisonReady(true);
        setInitialLoading(true);

        // Navigate to the comparison route
        resolveRepoIdentity(currentRepoPath).then(({ routePrefix }) => {
          navigateRef.current(`/${routePrefix}/review/${key}`);
        });
      },
    );

    return unlisten;
  }, [setActiveReviewKey, setComparison]);

  // Handle closing the current repo (go to welcome page)
  const handleCloseRepo = useCallback(() => {
    setRepoPath(null);
    setRepoStatus("welcome");
    setRepoError(null);
    setComparisonReady(false);
    sessionStorage.setItem(REPO_PATH_KEY, "");
    navigateRef.current("/");
  }, [setRepoPath]);

  // Shared logic: validate, activate, and navigate to a repo's working tree.
  // Determines comparison BEFORE touching state, then uses switchReview().
  const activateRepo = useCallback(
    async (path: string) => {
      if (!(await validateGitRepo(path))) return;

      // Determine comparison BEFORE touching state
      const { routePrefix } = await resolveRepoIdentity(path);
      const { key, comparison } = await getDefaultComparison(path);

      setActiveReviewKey({
        repoPath: path,
        comparisonKey: key,
      });
      await ensureReviewExists(path, comparison);

      // Atomic switch — no intermediate state
      switchReview(path, comparison);
      initLogPath(path);
      clearLog();
      setRepoStatus("found");
      setRepoError(null);
      addRecentRepository(path);
      storeRepoPath(path);

      setComparisonReady(true);
      setInitialLoading(true);
      navigateRef.current(`/${routePrefix}/review/${key}`);
      loadGlobalReviews();
    },
    [
      switchReview,
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

  // Activate a specific review from the sidebar — uses switchReview for
  // cross-repo switches, setComparison for same-repo switches.
  const handleActivateReview = useCallback(
    (review: GlobalReviewSummary) => {
      const nav = navigateRef.current;
      const state = useReviewStore.getState();
      const meta = state.repoMetadata[review.repoPath];
      const routePrefix = meta?.routePrefix ?? `local/${review.repoName}`;

      // If clicking the already-active review, just navigate without resetting state
      if (
        state.activeReviewKey?.repoPath === review.repoPath &&
        state.activeReviewKey?.comparisonKey === review.comparison.key
      ) {
        nav(`/${routePrefix}/review/${review.comparison.key}`);
        return;
      }

      setActiveReviewKey({
        repoPath: review.repoPath,
        comparisonKey: review.comparison.key,
      });

      if (review.repoPath !== state.repoPath) {
        // Different repo — atomic switch prevents phantom entries
        switchReview(review.repoPath, review.comparison);
      } else {
        // Same repo — just switch comparison
        setComparison(review.comparison);
      }

      // Mark ready so useComparisonLoader fires
      setComparisonReady(true);
      setInitialLoading(true);

      nav(`/${routePrefix}/review/${review.comparison.key}`);
    },
    [setActiveReviewKey, switchReview, setComparison],
  );

  // Handle new review from ComparisonPickerModal — validates, switches, and navigates.
  const handleNewReview = useCallback(
    async (path: string, comparison: Comparison, githubPr?: GitHubPrRef) => {
      if (!(await validateGitRepo(path))) return;

      const state = useReviewStore.getState();
      const { routePrefix } = await resolveRepoIdentity(path);

      setActiveReviewKey({
        repoPath: path,
        comparisonKey: comparison.key,
      });
      await ensureReviewExists(path, comparison, githubPr);

      if (path !== state.repoPath) {
        // Different repo — atomic switch prevents phantom entries
        switchReview(path, comparison);
        initLogPath(path);
        clearLog();
        setRepoStatus("found");
        setRepoError(null);
        addRecentRepository(path);
        storeRepoPath(path);
      } else {
        // Same repo — just switch comparison
        setComparison(comparison);
      }

      setComparisonReady(true);
      setInitialLoading(true);
      navigateRef.current(`/${routePrefix}/review/${comparison.key}`);
      loadGlobalReviews();
    },
    [
      switchReview,
      setComparison,
      setActiveReviewKey,
      ensureReviewExists,
      addRecentRepository,
      loadGlobalReviews,
    ],
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
    handleNewReview,
  };
}
