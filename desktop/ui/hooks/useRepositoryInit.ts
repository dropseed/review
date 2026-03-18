import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { makeComparison, type Comparison, type GitHubPrRef } from "../types";
import type { GlobalReviewSummary } from "../types";
import { clearLog } from "../utils/logger";
import { resolveRepoIdentity } from "../utils/repo-identity";
import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";
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

/** Try to resolve a repo from the URL path (browser mode only).
 *  URL format: /:owner/:repo/... */
async function resolveRepoFromUrl(): Promise<string | null> {
  if (isTauriEnvironment()) return null;

  const path = window.location.pathname;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 2) return null;

  const routePrefix = `${parts[0]}/${parts[1]}`;
  const api = getApiClient();

  // Check if the API client supports repo resolution
  if (
    "resolveRepoPath" in api &&
    typeof (api as { resolveRepoPath?: unknown }).resolveRepoPath === "function"
  ) {
    try {
      return await (
        api as { resolveRepoPath: (prefix: string) => Promise<string | null> }
      ).resolveRepoPath(routePrefix);
    } catch {
      return null;
    }
  }
  return null;
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
  comparisonReady: number;
  initialLoading: boolean;
  setInitialLoading: (loading: boolean) => void;
  handleOpenRepo: () => Promise<void>;
  handleNewWindow: () => Promise<void>;
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => Promise<void>;
  handleActivateReview: (review: GlobalReviewSummary) => void;
  handleNewReview: (
    path: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ) => Promise<void>;
  handleActivateLocalBranch: (
    repoPath: string,
    branch: string,
    defaultBranch: string,
  ) => void;
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

  const [comparisonReady, setComparisonReady] = useState(0);
  const [initialLoading, setInitialLoading] = useState(false);

  // Keep a stable ref for navigate so the init effect doesn't re-run
  // when the route changes (react-router v7 can change the navigate reference)
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  // Guard to ensure init only runs once
  const hasInitializedRef = useRef(false);

  /** Open a repo in browse mode (no comparison, no review created). */
  const openBrowseModeRef = useRef(
    async (
      path: string,
      options?: {
        clearLogFile?: boolean;
        replace?: boolean;
        focusedFile?: string | null;
      },
    ): Promise<void> => {
      setRepoPath(path);
      if (options?.clearLogFile) clearLog();
      setRepoStatus("found");
      setRepoError(null);
      addRecentRepository(path);
      storeRepoPath(path);
      setActiveReviewKey(null);

      const { routePrefix } = await resolveRepoIdentity(path);
      const browsePath = options?.focusedFile
        ? `/${routePrefix}/browse/file/${options.focusedFile}`
        : `/${routePrefix}/browse`;
      navigateRef.current(browsePath, {
        replace: options?.replace,
      });
      loadGlobalReviews();
    },
  );

  /** Enter standalone mode for a non-git path (file or directory). */
  async function enterStandaloneMode(
    rawPath: string,
    options?: { clearLogFile?: boolean; replace?: boolean },
  ): Promise<void> {
    const apiClient = getApiClient();
    const isFile = await apiClient.pathIsFile(rawPath);

    let displayRoot: string;
    let route: string;

    if (isFile) {
      const lastSlash = rawPath.lastIndexOf("/");
      displayRoot = lastSlash > 0 ? rawPath.slice(0, lastSlash) : rawPath;
      const fileName = lastSlash >= 0 ? rawPath.slice(lastSlash + 1) : rawPath;
      route = `/standalone/browse/file/${fileName}`;
    } else {
      displayRoot = rawPath;
      route = `/standalone/browse`;
    }

    setRepoPath(displayRoot);
    useReviewStore.setState({ isStandaloneFile: true });
    if (options?.clearLogFile) clearLog();
    setRepoStatus("found");
    setRepoError(null);
    storeRepoPath(displayRoot);
    setActiveReviewKey(null);
    navigateRef.current(route, { replace: options?.replace });
  }

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
      if (options?.clearLogFile) clearLog();
      setRepoStatus("found");
      addRecentRepository(path);
      if (options?.storeInSession) storeRepoPath(path);

      setActiveReviewKey({
        repoPath: path,
        comparisonKey: comparison.key,
      });
      await ensureReviewExists(path, comparison);

      const { routePrefix } = await resolveRepoIdentity(path);
      navigateRef.current(`/${routePrefix}/review/${comparison.key}`, {
        replace: true,
      });

      setComparisonReady((c) => c + 1);
      setInitialLoading(true);
      loadGlobalReviews();
    }

    const init = async () => {
      // In browser mode, try to resolve a repo from the URL path (e.g. /owner/repo/...)
      const urlRepoPath_ = await resolveRepoFromUrl();
      if (urlRepoPath_) {
        // Extract comparison key from URL if present (e.g. /owner/repo/review/main..feature)
        const pathMatch = window.location.pathname.match(/\/review\/([^/]+)$/);
        const urlKey = pathMatch?.[1] ?? null;

        if (window.location.pathname.includes("/browse")) {
          await openBrowseModeRef.current(urlRepoPath_, { replace: true });
          return;
        }

        const comparison = await resolveComparison(urlRepoPath_, urlKey);
        await initRepo(urlRepoPath_, comparison, {
          clearLogFile: true,
          storeInSession: true,
        });
        return;
      }

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

      // Check for a pending CLI open request (cold start from `review` CLI).
      // On cold start the default window has no URL params, and the signal
      // file written by the CLI is the only way to know what to open.
      try {
        const apiClient = getApiClient();
        const cliRequest = await apiClient.consumeCliRequest();
        if (cliRequest) {
          // Check if the path is a git repo. If not, it may be a standalone file.
          const isRepo = await apiClient.isGitRepo(cliRequest.repoPath);

          if (!isRepo) {
            await enterStandaloneMode(cliRequest.repoPath, {
              clearLogFile: true,
              replace: true,
            });
            return;
          }

          if (cliRequest.comparisonKey) {
            // review start <spec> — open with comparison
            const comparison = await resolveComparison(
              cliRequest.repoPath,
              cliRequest.comparisonKey,
            );
            await initRepo(cliRequest.repoPath, comparison, {
              clearLogFile: true,
              storeInSession: true,
            });
          } else {
            // review <path> — open in browse mode
            await openBrowseModeRef.current(cliRequest.repoPath, {
              clearLogFile: true,
              replace: true,
              focusedFile: cliRequest.focusedFile,
            });
          }
          return;
        }
      } catch {
        // Ignore — command may not exist on older backends
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

        // Check if we were in browse mode
        if (window.location.pathname.includes("/browse")) {
          await openBrowseModeRef.current(storedPath, { replace: true });
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

  // Listen for cli:switch-comparison events from Rust (when CLI reuses an existing window for the same repo)
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
        setActiveReviewKey({
          repoPath: currentRepoPath,
          comparisonKey: key,
        });
        setComparison(comparison);
        setComparisonReady((c) => c + 1);
        setInitialLoading(true);

        // Navigate to the comparison route
        resolveRepoIdentity(currentRepoPath).then(({ routePrefix }) => {
          navigateRef.current(`/${routePrefix}/review/${key}`);
        });
      },
    );

    return unlisten;
  }, [setActiveReviewKey, setComparison]);

  // Listen for cli:open-review events from Rust (CLI opened a review,
  // navigate this window instead of opening a new tab).
  useEffect(() => {
    const platform = getPlatformServices();
    const unlisten = platform.menuEvents.on(
      "cli:open-review",
      async (payload) => {
        const data = payload as {
          repoPath?: string;
          comparisonKey?: string | null;
          focusedFile?: string | null;
        } | null;
        const repoPath = data?.repoPath;
        if (!repoPath) return;

        const comparisonKey = data?.comparisonKey ?? null;

        // Check if this is a non-git path (standalone file/directory)
        const apiClient = getApiClient();
        const isRepo = await apiClient.isGitRepo(repoPath);
        if (!isRepo) {
          await enterStandaloneMode(repoPath);
          return;
        }

        if (!comparisonKey) {
          // No comparison — open in browse mode
          await openBrowseModeRef.current(repoPath, {
            focusedFile: data?.focusedFile,
          });
          return;
        }

        const comparison = await resolveComparison(repoPath, comparisonKey);

        const state = useReviewStore.getState();
        const { routePrefix } = await resolveRepoIdentity(repoPath);

        setActiveReviewKey({
          repoPath,
          comparisonKey: comparison.key,
        });
        await ensureReviewExists(repoPath, comparison);

        if (repoPath !== state.repoPath) {
          // Cross-repo switch — atomic update
          switchReview(repoPath, comparison);
          setRepoStatus("found");
          setRepoError(null);
          addRecentRepository(repoPath);
          storeRepoPath(repoPath);
        } else {
          // Same repo — just switch comparison
          setComparison(comparison);
        }

        setComparisonReady((c) => c + 1);
        setInitialLoading(true);
        navigateRef.current(`/${routePrefix}/review/${comparison.key}`);
        loadGlobalReviews();
      },
    );

    return unlisten;
  }, [
    switchReview,
    setComparison,
    setActiveReviewKey,
    ensureReviewExists,
    addRecentRepository,
    loadGlobalReviews,
  ]);

  // Handle closing the current repo (go to welcome page)
  const handleCloseRepo = useCallback(() => {
    setRepoPath(null);
    setRepoStatus("welcome");
    setRepoError(null);
    setComparisonReady(0);
    sessionStorage.setItem(REPO_PATH_KEY, "");
    navigateRef.current("/");
  }, [setRepoPath]);

  // Handle selecting a repo (from welcome page recent list or tab rail)
  const handleSelectRepo = useCallback(async (path: string) => {
    if (!(await validateGitRepo(path))) return;
    await openBrowseModeRef.current(path);
  }, []);

  // Open a repository in browse mode (standard Cmd+O behavior)
  const handleOpenRepo = useCallback(async () => {
    const platform = getPlatformServices();
    try {
      const selected = await platform.dialogs.openDirectory({
        title: "Open Repository",
      });
      if (selected) {
        if (!(await validateGitRepo(selected))) return;
        await openBrowseModeRef.current(selected);
      }
    } catch (err) {
      console.error("Failed to open repository:", err);
    }
  }, []);

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
      setComparisonReady((c) => c + 1);
      setInitialLoading(true);

      nav(`/${routePrefix}/review/${review.comparison.key}`);
    },
    [setActiveReviewKey, switchReview, setComparison],
  );

  // Handle new review — validates, switches, and navigates.
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
        setRepoStatus("found");
        setRepoError(null);
        addRecentRepository(path);
        storeRepoPath(path);
      } else {
        // Same repo — just switch comparison
        setComparison(comparison);
      }

      setComparisonReady((c) => c + 1);
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

  // Activate a local branch (ephemeral, no review file created)
  const handleActivateLocalBranch = useCallback(
    (repoPath: string, branch: string, defaultBranch: string) => {
      const nav = navigateRef.current;
      const state = useReviewStore.getState();
      const comparison = makeComparison(defaultBranch, branch);

      // Save navigation snapshot before switching
      state.saveNavigationSnapshot();

      // Mark diff as seen so the unseen indicator clears
      const branchInfo = state.localActivity
        .find((r) => r.repoPath === repoPath)
        ?.branches.find((b) => b.name === branch);
      if (branchInfo) {
        state.markDiffSeen(repoPath, branch, branchInfo.workingTreeStats);
      }

      setActiveReviewKey({
        repoPath,
        comparisonKey: comparison.key,
      });

      if (repoPath !== state.repoPath) {
        switchReview(repoPath, comparison);
      } else {
        setComparison(comparison);
      }

      setComparisonReady((c) => c + 1);
      setInitialLoading(true);

      // Navigate using repo name from local activity
      resolveRepoIdentity(repoPath).then(({ routePrefix }) => {
        nav(`/${routePrefix}/review/${comparison.key}`);
      });
    },
    [setActiveReviewKey, switchReview, setComparison],
  );

  return {
    repoStatus,
    repoError,
    comparisonReady,
    initialLoading,
    setInitialLoading,
    handleOpenRepo,
    handleNewWindow,
    handleCloseRepo,
    handleSelectRepo,
    handleActivateReview,
    handleNewReview,
    handleActivateLocalBranch,
  };
}
