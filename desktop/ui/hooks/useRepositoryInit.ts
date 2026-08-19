import { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { GitHubPrRef, ResolvedReview, ReviewTarget } from "../types";
import type { GlobalReviewSummary } from "../types";
import { getErrorMessage } from "../utils/errors";
import { clearLog } from "../utils/logger";
import { resolveRepoIdentity, reviewUrl } from "../utils/repo-identity";
import { getApiClient } from "../api";
import { isTauriEnvironment } from "../api/client";
import { getPlatformServices } from "../platform";
import { useReviewStore } from "../stores";
import { makeReviewKey } from "../stores/slices/groupingSlice";

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

/**
 * The review ref a URL names, or null if it names none.
 *
 * `/:owner/:repo/review/:ref`, and the path may continue past the ref into a
 * file (`…/review/feature-x/file/src/main.rs`).
 *
 * Both halves of that sentence have burned this. Matching `/review/` anchored
 * to the end of the path made a link *into a file* read as no ref at all — the
 * default branch was resolved instead and the file segment dropped as not
 * belonging to it, so every shared link landed on the file list. Unanchoring it
 * then found the *first* `/review/`, which in this repo's own URLs is the repo
 * name, and answered "review".
 *
 * Extracted and exported for exactly that reason: each form was right in the
 * case anybody checks by hand and wrong in the other.
 */
export function refFromReviewPath(pathname: string): string | null {
  // Positional, not a search. `/review/` appears twice in this very repo's own
  // URLs — `/dropseed/review/review/master` — so a regex looking for the first
  // one answers "review", the repo, and a regex anchored to the end answers
  // nothing at all once the path continues into a file. The route has a fixed
  // shape; reading it by position is the only form that is right in both.
  const parts = pathname.split("/").filter(Boolean);
  if (parts[2] !== "review") return null;
  return refFromUrlSegment(parts[3] ?? null);
}

/** Decode a review ref from a URL path segment. Returns null when empty. */
export function refFromUrlSegment(segment: string | null): string | null {
  if (!segment) return null;
  try {
    return decodeURIComponent(segment) || null;
  } catch {
    return segment || null;
  }
}

/** The default review ref for a repo: its current branch (HEAD as a fallback). */
async function getDefaultRef(repoPath: string): Promise<string> {
  return getApiClient()
    .getCurrentBranch(repoPath)
    .catch(() => "HEAD");
}

/**
 * Resolve a review from a repo + optional ref, falling back to the current
 * branch when `ref` is null. When `baseOverride` is left undefined (URL/deep-
 * link init), the stored review's persisted override — if any — is honored;
 * pass an explicit value (or null to clear) to override that.
 */
async function resolveTarget(
  repoPath: string,
  ref: string | null,
  baseOverride?: string | null,
): Promise<ResolvedReview> {
  const client = getApiClient();
  const effectiveRef = ref ?? (await getDefaultRef(repoPath));
  // When no override is in hand, resolveReview honors any persisted one itself.
  const override =
    baseOverride === undefined ? undefined : (baseOverride ?? undefined);
  return client.resolveReview(repoPath, effectiveRef, override);
}

/**
 * Listed -> Fetched for a PR review, before its comparison is resolved.
 *
 * Resolution points a PR's comparison at `refs/review/pr/N`, so resolving
 * before the fetch would produce a comparison against a ref that isn't there
 * yet. Idempotent, and re-fetching also picks up commits pushed since the last
 * look, so it runs on every open. A no-op for non-PR reviews.
 */
async function fetchPrRefIfNeeded(
  repoPath: string,
  githubPr: GitHubPrRef | undefined,
): Promise<void> {
  if (!githubPr) return;
  await useReviewStore.getState().fetchPullRequestRef(repoPath, githubPr);
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
  "loading" | "found" | "not_found" | "welcome" | "error";

interface UseRepositoryInitReturn {
  repoStatus: RepoStatus;
  repoError: string | null;
  comparisonReady: number;
  initialLoading: boolean;
  setInitialLoading: (loading: boolean) => void;
  handleOpenRepo: () => Promise<void>;
  handleCloseRepo: () => void;
  handleSelectRepo: (path: string) => Promise<void>;
  handleActivateReview: (review: GlobalReviewSummary) => Promise<void>;
  handleNewReview: (path: string, target: ReviewTarget) => Promise<void>;
  handleStartReview: (path: string, target: ReviewTarget) => Promise<void>;
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

    /** Shared activation: switch to a repo+review, navigate, and mark ready. */
    async function initRepo(
      path: string,
      resolved: ResolvedReview,
      options?: { clearLogFile?: boolean; storeInSession?: boolean },
    ): Promise<void> {
      switchReview(path, resolved);
      if (options?.clearLogFile) clearLog();
      setRepoStatus("found");
      addRecentRepository(path);
      if (options?.storeInSession) storeRepoPath(path);

      setActiveReviewKey({
        repoPath: path,
        ref: resolved.ref,
      });
      await ensureReviewExists(path, resolved.ref, resolved.baseOverride);

      const { routePrefix } = await resolveRepoIdentity(path);
      // Canonicalize the *review*, not the whole location: a URL already
      // inside this review — `/…/review/master/file/src/main.rs` — is not a
      // route to clean up, it is where the link pointed. Replacing it with the
      // bare review URL is what made opening a link to a file land on the file
      // list, which the desktop app hid by restoring its own last repo instead
      // of booting from a URL. An installed PWA has nothing else to boot from.
      const canonical = reviewUrl(routePrefix, resolved.ref);
      const here = window.location.pathname;
      const destination = here.startsWith(`${canonical}/`) ? here : canonical;
      navigateRef.current(destination, { replace: true });

      setComparisonReady((c) => c + 1);
      setInitialLoading(true);
      loadGlobalReviews();
    }

    const init = async () => {
      // In browser mode, try to resolve a repo from the URL path (e.g. /owner/repo/...)
      const urlRepoPath_ = await resolveRepoFromUrl();
      if (urlRepoPath_) {
        const urlRef = refFromReviewPath(window.location.pathname);

        if (window.location.pathname.includes("/browse")) {
          await openBrowseModeRef.current(urlRepoPath_, { replace: true });
          return;
        }

        const resolved = await resolveTarget(urlRepoPath_, urlRef);
        await initRepo(urlRepoPath_, resolved, {
          clearLogFile: true,
          storeInSession: true,
        });
        return;
      }

      // Check for a pending CLI open request (cold start from `review` CLI).
      // The signal file the CLI writes is the only way a cold start knows what
      // to open.
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

          if (cliRequest.ref) {
            // review start <spec> — open the resolved review ref
            const resolved = await resolveTarget(
              cliRequest.repoPath,
              cliRequest.ref,
            );
            if (cliRequest.focusedFile) {
              useReviewStore.getState().setPendingDeepLinkFocus({
                filePath: cliRequest.focusedFile,
                hunkHash: cliRequest.focusedHunkHash,
              });
            }
            await initRepo(cliRequest.repoPath, resolved, {
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

        // Check if we were in standalone mode (non-git file/directory)
        if (window.location.pathname.startsWith("/standalone/browse")) {
          const fileMatch = window.location.pathname.match(
            /\/standalone\/browse\/file\/(.+)$/,
          );
          const rawPath = fileMatch
            ? `${storedPath}/${decodeURIComponent(fileMatch[1])}`
            : storedPath;
          await enterStandaloneMode(rawPath, { replace: true });
          return;
        }

        // Check if we were in browse mode
        if (window.location.pathname.includes("/browse")) {
          await openBrowseModeRef.current(storedPath, { replace: true });
          return;
        }

        // Try to recover the review ref from the current URL path
        const urlRef = refFromReviewPath(window.location.pathname);
        const resolved = await resolveTarget(storedPath, urlRef);
        await initRepo(storedPath, resolved);
        return;
      }

      // Fall back to getting current working directory from API
      const apiClient = getApiClient();
      try {
        const path = await apiClient.getCurrentRepo();
        const resolved = await resolveTarget(path, null);
        await initRepo(path, resolved, {
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
    // `enterStandaloneMode` is a plain function declared in the hook body, so
    // it is a new value every render — listing it here would turn a one-shot
    // init into an every-render one. Everything else in this list is a stable
    // Zustand action, which is what keeps the effect one-shot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    switchReview,
    addRecentRepository,
    setActiveReviewKey,
    ensureReviewExists,
    loadGlobalReviews,
  ]);

  // Listen for cli:open-review events from Rust (CLI opened a review,
  // navigate this window instead of opening a new tab).
  useEffect(() => {
    const platform = getPlatformServices();
    const unlisten = platform.menuEvents.on(
      "cli:open-review",
      async (payload) => {
        const data = payload as {
          repoPath?: string;
          ref?: string | null;
          focusedFile?: string | null;
          focusedHunkHash?: string | null;
        } | null;
        const repoPath = data?.repoPath;
        if (!repoPath) return;

        const ref = data?.ref ?? null;

        // Check if this is a non-git path (standalone file/directory)
        const apiClient = getApiClient();
        const isRepo = await apiClient.isGitRepo(repoPath);
        if (!isRepo) {
          await enterStandaloneMode(repoPath);
          return;
        }

        if (!ref) {
          // No ref — open in browse mode
          await openBrowseModeRef.current(repoPath, {
            focusedFile: data?.focusedFile,
          });
          return;
        }

        if (data?.focusedFile) {
          useReviewStore.getState().setPendingDeepLinkFocus({
            filePath: data.focusedFile,
            hunkHash: data.focusedHunkHash ?? null,
          });
        }

        const resolved = await resolveTarget(repoPath, ref);

        const state = useReviewStore.getState();
        const { routePrefix } = await resolveRepoIdentity(repoPath);

        setActiveReviewKey({
          repoPath,
          ref: resolved.ref,
        });
        await ensureReviewExists(repoPath, resolved.ref, resolved.baseOverride);

        if (repoPath !== state.repoPath) {
          // Cross-repo switch — atomic update
          switchReview(repoPath, resolved);
          setRepoStatus("found");
          setRepoError(null);
          addRecentRepository(repoPath);
          storeRepoPath(repoPath);
        } else {
          // Same repo — just switch review
          setComparison(resolved);
        }

        setComparisonReady((c) => c + 1);
        setInitialLoading(true);
        navigateRef.current(reviewUrl(routePrefix, resolved.ref));
        loadGlobalReviews();
      },
    );

    return unlisten;
    // Same as above: `enterStandaloneMode` is re-created each render, and this
    // effect registers a listener that must be registered once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Activate a specific review from the sidebar — resolves the review's ref
  // into a comparison, then uses switchReview for cross-repo switches,
  // setComparison for same-repo switches.
  const handleActivateReview = useCallback(
    async (review: GlobalReviewSummary) => {
      const nav = navigateRef.current;
      const state = useReviewStore.getState();
      const meta = state.repoMetadata[review.repoPath];
      const routePrefix = meta?.routePrefix ?? `local/${review.repoName}`;
      const url = reviewUrl(routePrefix, review.ref);

      // If clicking the already-active review, just navigate without resetting state
      if (
        state.activeReviewKey?.repoPath === review.repoPath &&
        state.activeReviewKey?.ref === review.ref
      ) {
        nav(url);
        return;
      }

      await fetchPrRefIfNeeded(review.repoPath, review.githubPr);

      const resolved = await getApiClient().resolveReview(
        review.repoPath,
        review.ref,
        review.baseOverride,
      );

      setActiveReviewKey({
        repoPath: review.repoPath,
        ref: review.ref,
      });

      if (review.repoPath !== state.repoPath) {
        // Different repo — atomic switch prevents phantom entries
        switchReview(review.repoPath, resolved);
      } else {
        // Same repo — just switch review
        setComparison(resolved);
      }

      useReviewStore.getState().setReadOnlyPreview(false);

      setComparisonReady((c) => c + 1);
      setInitialLoading(true);

      nav(url);
    },
    [setActiveReviewKey, switchReview, setComparison],
  );

  // Handle new review — validates, resolves the target ref, switches, and navigates.
  const handleNewReview = useCallback(
    async (path: string, target: ReviewTarget) => {
      if (!(await validateGitRepo(path))) return;

      const state = useReviewStore.getState();
      const { routePrefix } = await resolveRepoIdentity(path);

      // Order matters for PRs: fetch the head so the ref exists, then persist
      // `githubPr` onto the review, and only then resolve. Resolution reads
      // both — it points a PR's comparison at the fetched ref — so doing it
      // first would produce a comparison against a ref that isn't there yet.
      await fetchPrRefIfNeeded(path, target.githubPr);
      await ensureReviewExists(
        path,
        target.ref,
        target.baseOverride,
        target.githubPr,
      );

      const resolved = await getApiClient().resolveReview(
        path,
        target.ref,
        target.baseOverride,
      );

      setActiveReviewKey({
        repoPath: path,
        ref: resolved.ref,
      });

      if (path !== state.repoPath) {
        // Different repo — atomic switch prevents phantom entries
        switchReview(path, resolved);
        setRepoStatus("found");
        setRepoError(null);
        addRecentRepository(path);
        storeRepoPath(path);
      } else {
        // Same repo — just switch review
        setComparison(resolved);
      }

      setComparisonReady((c) => c + 1);
      setInitialLoading(true);
      navigateRef.current(reviewUrl(routePrefix, resolved.ref));
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

  // Start a review: delegates to handleNewReview and clears read-only mode.
  const handleStartReview = useCallback(
    async (path: string, target: ReviewTarget) => {
      await handleNewReview(path, target);
      useReviewStore.getState().setReadOnlyPreview(false);
    },
    [handleNewReview],
  );

  // Activate a local branch. The review's identity is the branch name; its
  // base is derived (or the stored override honored). If the branch is not the
  // current branch and has no worktree, enter read-only preview mode.
  const handleActivateLocalBranch = useCallback(
    (repoPath: string, branch: string) => {
      const nav = navigateRef.current;
      const state = useReviewStore.getState();

      // Save navigation snapshot before switching
      state.saveNavigationSnapshot();

      // Mark diff as seen so the unseen indicator clears
      const branchInfo = state.localActivity
        .find((r) => r.repoPath === repoPath)
        ?.branches.find((b) => b.name === branch);
      if (branchInfo) {
        state.markDiffSeen(repoPath, branch, branchInfo.workingTreeStats);
      }

      // Determine if this is a read-only preview:
      // not the current branch and no existing worktree (either branch-level or review-managed)
      const isCurrent = branchInfo?.isCurrent ?? false;
      const hasWorktree = !!branchInfo?.worktreePath;
      // Also check global reviews for an existing review-managed worktree
      const reviewKey = makeReviewKey(repoPath, branch);
      const existingReview = state.globalReviewsByKey[reviewKey];
      const hasReviewWorktree = !!existingReview?.worktreePath;
      const isReadOnly = !isCurrent && !hasWorktree && !hasReviewWorktree;

      void (async () => {
        const resolved = await resolveTarget(repoPath, branch);

        setActiveReviewKey({ repoPath, ref: branch });

        if (repoPath !== useReviewStore.getState().repoPath) {
          switchReview(repoPath, resolved);
        } else {
          setComparison(resolved);
        }

        // Set read-only preview and worktree path in store
        const storeActions = useReviewStore.getState();
        storeActions.setReadOnlyPreview(isReadOnly);
        storeActions.setWorktreePath(
          branchInfo?.worktreePath ?? existingReview?.worktreePath ?? null,
        );

        setComparisonReady((c) => c + 1);
        setInitialLoading(true);

        // Navigate using repo name from local activity
        const { routePrefix } = await resolveRepoIdentity(repoPath);
        nav(reviewUrl(routePrefix, branch));
      })().catch((err) => {
        // Nothing above this point has navigated, so a failure here leaves the
        // click looking like a no-op unless it's said out loud.
        console.error("Failed to open branch:", err);
        toast.error(`Couldn't open ${branch}: ${getErrorMessage(err)}`);
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
    handleCloseRepo,
    handleSelectRepo,
    handleActivateReview,
    handleNewReview,
    handleStartReview,
    handleActivateLocalBranch,
  };
}
