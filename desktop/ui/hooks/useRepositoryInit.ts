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
import { useSpurStore } from "../stores";
import type { SpurStore } from "../stores/types";
import { makeReviewKey } from "../stores/slices/groupingSlice";
import { openFolderInFocusedWorkspace } from "../components/Stage/repo-choices";
import { landWorkspace } from "../commands/workspaceCommands";

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
  // URLs — `/dropseed/spur/review/master` — so a regex looking for the first
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

/**
 * Is the code half already showing exactly this comparison?
 *
 * `focusWorkspace` keeps a click on the card you are already in from reaching
 * here at all, but the routes that name a comparison outright still do: the
 * repo tab that is already active, a ⌘K row for the branch already open, a
 * card whose repo another card had on screen. Answered there, each of those
 * re-resolved the target, cleared the loaded diff through `setComparison`,
 * and sent `useComparisonLoader` through a whole pass — git status, the
 * review file, reconcile, classify, and a full `refresh()` on any drift — to
 * arrive at the bytes already on screen.
 *
 * A commit peek is deliberately *not* "already showing this": the key still
 * names the branch while the screen renders a comparison the review isn't of,
 * and clicking the branch is how you come back from one.
 */
export function showingComparison(
  state: Pick<
    SpurStore,
    "repoPath" | "activeReviewKey" | "comparison" | "viewpoint"
  >,
  repoPath: string,
  ref: string,
): boolean {
  const key = state.activeReviewKey;
  return (
    state.repoPath === repoPath &&
    key?.repoPath === repoPath &&
    key.ref === ref &&
    state.comparison !== null &&
    state.viewpoint.kind !== "commit"
  );
}

/**
 * Is the location already inside this review's own route?
 *
 * What a re-entry navigates on, because the store's comparison and the URL can
 * be apart: focusing a workspace whose branch is gone lands on `/` and leaves
 * the last comparison loaded, so a click that resolves to it still has to put
 * the URL back. Inside it — a file, the guide — nothing is navigated at all:
 * that is where the person was, and the review root would close the file they
 * were reading to show them the list they opened it from.
 */
export function insideReview(pathname: string, ref: string): boolean {
  return refFromReviewPath(pathname) === ref;
}

/**
 * The same question where the route is known outright rather than by its ref:
 * is `here` that route, or a location inside it?
 */
export function insideRoute(here: string, base: string): boolean {
  return here === base || here.startsWith(`${base}/`);
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
  await useSpurStore.getState().fetchPullRequestRef(repoPath, githubPr);
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

interface InitRepoOptions {
  clearLogFile?: boolean;
  /** Default true; the page-refresh path already has the record it read. */
  storeInSession?: boolean;
  /**
   * Whether this is the app coming up (default) or a landing into an app that
   * is already running. It decides history: a boot replaces the entry it is
   * booting into and keeps a location already inside the review; a warm landing
   * pushes a new one at the review root.
   */
  boot?: boolean;
}

interface UseRepositoryInitReturn {
  repoStatus: RepoStatus;
  repoError: string | null;
  comparisonReady: number;
  initialLoading: boolean;
  setInitialLoading: (loading: boolean) => void;
  handleOpenRepo: () => Promise<void>;
  openPath: (path: string) => Promise<void>;
  handleCloseRepo: () => void;
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
  const setRepoPath = useSpurStore((s) => s.setRepoPath);
  const setComparison = useSpurStore((s) => s.setComparison);
  const switchReview = useSpurStore((s) => s.switchReview);
  const addRecentRepository = useSpurStore((s) => s.addRecentRepository);
  const setActiveReviewKey = useSpurStore((s) => s.setActiveReviewKey);
  const loadGlobalReviews = useSpurStore((s) => s.loadGlobalReviews);
  const ensureReviewExists = useSpurStore((s) => s.ensureReviewExists);
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
      // Explicitly, because `setRepoPath` resets it only when the path
      // *changes*: `git init` in a folder already open as a plain directory
      // reopens the same path as a repo, and is the one way in here that would
      // otherwise keep drawing the standalone reader over a real checkout.
      useSpurStore.setState({ isStandaloneFile: false });
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

  /**
   * Where the standalone reader lands for a raw path: the directory it shows,
   * and the route that shows it.
   *
   * Split out because two callers need the *root* before the screen opens —
   * a landing routes the workspace by it, and the attachment is the directory
   * even when the path names a file inside it. One `pathIsFile` per landing.
   */
  async function standaloneTarget(
    rawPath: string,
  ): Promise<{ displayRoot: string; route: string }> {
    if (!(await getApiClient().pathIsFile(rawPath))) {
      return { displayRoot: rawPath, route: "/standalone/browse" };
    }
    const lastSlash = rawPath.lastIndexOf("/");
    const fileName = lastSlash >= 0 ? rawPath.slice(lastSlash + 1) : rawPath;
    return {
      displayRoot: lastSlash > 0 ? rawPath.slice(0, lastSlash) : rawPath,
      route: `/standalone/browse/file/${fileName}`,
    };
  }

  /** Show a non-git path in the standalone reader. See [`standaloneTarget`]. */
  function enterStandaloneMode(
    { displayRoot, route }: { displayRoot: string; route: string },
    options?: { clearLogFile?: boolean; replace?: boolean },
  ): void {
    setRepoPath(displayRoot);
    useSpurStore.setState({ isStandaloneFile: true });
    if (options?.clearLogFile) clearLog();
    setRepoStatus("found");
    setRepoError(null);
    storeRepoPath(displayRoot);
    setActiveReviewKey(null);
    navigateRef.current(route, { replace: options?.replace });
  }

  /**
   * Switch to a repo+review, navigate, and mark the comparison ready.
   *
   * Cross-repo goes through `switchReview`, which resets every per-repo slice
   * atomically; a comparison change *within* the repo is `setComparison`, so
   * walking to another branch of the repo you are in doesn't throw away its
   * search results, git status and symbols. A cold start is always the first
   * case, `repoPath` being null.
   */
  async function initRepo(
    path: string,
    resolved: ResolvedReview,
    options?: InitRepoOptions,
  ): Promise<void> {
    const crossRepo = path !== useSpurStore.getState().repoPath;
    if (crossRepo) {
      switchReview(path, resolved);
      addRecentRepository(path);
      if (options?.storeInSession !== false) storeRepoPath(path);
    } else {
      setComparison(resolved);
    }
    if (options?.clearLogFile) clearLog();
    setRepoStatus("found");
    setRepoError(null);

    setActiveReviewKey({ repoPath: path, ref: resolved.ref });
    await ensureReviewExists(path, resolved.ref, resolved.baseOverride);

    const { routePrefix } = await resolveRepoIdentity(path);
    const canonical = reviewUrl(routePrefix, resolved.ref);
    // A boot canonicalizes the *review*, not the whole location: a URL already
    // inside this review — `/…/review/master/file/src/main.rs` — is not a route
    // to clean up, it is where the link pointed. Replacing it with the bare
    // review URL is what made opening a link to a file land on the file list,
    // which the desktop app hid by restoring its own last repo instead of
    // booting from a URL. An installed PWA has nothing else to boot from. And
    // it *replaces*, because the entry being booted into is this one.
    //
    // A warm landing is a navigation instead: it pushes, so Back returns to
    // wherever the person was, and it goes to the review root rather than
    // keeping the previous location's file segment — it carries its own focused
    // file through `setPendingDeepLinkFocus`, and the two would disagree.
    const boot = options?.boot !== false;
    const here = window.location.pathname;
    const inside = boot && here.startsWith(`${canonical}/`);
    navigateRef.current(inside ? here : canonical, { replace: boot });

    setComparisonReady((c) => c + 1);
    setInitialLoading(true);
    loadGlobalReviews();
  }

  // The three landings, and the only way in for anything arriving from outside
  // the app: the `spur` CLI (cold and warm, which the `spur://` deep link
  // and Finder's "Open with" share), the URL deep link, the launch directory,
  // and a page refresh. Each routes the workspace and *then* opens the screen.
  //
  // Both halves of that are load-bearing. **Route**, because these used to
  // write only the legacy repo state, so the code half swapped while the repo
  // tab strip went on showing another workspace's tabs — or none. **First**,
  // because the launch claims the stage the moment `repoPath` is set, and a
  // focus still in flight then lets `useWorkspaceRestore` read a claimed stage
  // that derivation cannot place and take the focus to `lastWorkspaceId`,
  // drawing its tabs over this landing's diff for a round trip; it is also what
  // puts the attachment in place before `setActiveReviewKey` checks for it.
  //
  // The screen stays the caller's rather than `focusWorkspace`'s: these carry
  // `ensureReviewExists`, the session record and the deep-link focus ordering,
  // and on a cold start `activateReviewKey` finds no sidebar row (that load
  // hasn't run) and falls through to the local-branch handler, which reads
  // read-only preview off an empty `localActivity` — every CLI landing would
  // open read-only.
  //
  // A tab click reaches `openBrowseMode`/`enterStandaloneMode` through
  // `openPath` instead, with no routing: it is already in a workspace, and
  // routing there would move the focus.

  /** Land a comparison. */
  async function landReview(
    path: string,
    resolved: ResolvedReview,
    options?: InitRepoOptions,
  ): Promise<void> {
    await landWorkspace(path, resolved.ref);
    await initRepo(path, resolved, options);
  }

  /** Land a repo with no comparison: its files at whatever is checked out. */
  async function landBrowse(
    path: string,
    options?: {
      clearLogFile?: boolean;
      replace?: boolean;
      focusedFile?: string | null;
    },
  ): Promise<void> {
    await landWorkspace(path, null);
    await openBrowseModeRef.current(path, options);
  }

  /** Land a non-git path. The workspace attaches the *directory*, not a file. */
  async function landStandalone(
    rawPath: string,
    options?: { clearLogFile?: boolean; replace?: boolean },
  ): Promise<void> {
    const target = await standaloneTarget(rawPath);
    await landWorkspace(target.displayRoot, null);
    enterStandaloneMode(target, options);
  }

  // Initialize repo path from URL or API, then navigate to clean route.
  // Each branch determines the comparison FIRST, then calls switchReview().
  useEffect(() => {
    if (hasInitializedRef.current) return;
    hasInitializedRef.current = true;

    const init = async () => {
      // In browser mode, try to resolve a repo from the URL path (e.g. /owner/repo/...)
      const urlRepoPath_ = await resolveRepoFromUrl();
      if (urlRepoPath_) {
        const urlRef = refFromReviewPath(window.location.pathname);

        if (window.location.pathname.includes("/browse")) {
          await landBrowse(urlRepoPath_, { replace: true });
          return;
        }

        const resolved = await resolveTarget(urlRepoPath_, urlRef);
        await landReview(urlRepoPath_, resolved, { clearLogFile: true });
        return;
      }

      // Check for a pending CLI open request (cold start from `spur` CLI).
      // The signal file the CLI writes is the only way a cold start knows what
      // to open.
      try {
        const apiClient = getApiClient();
        const cliRequest = await apiClient.consumeCliRequest();
        if (cliRequest) {
          // Check if the path is a git repo. If not, it may be a standalone file.
          const isRepo = await apiClient.isGitRepo(cliRequest.repoPath);

          if (!isRepo) {
            await landStandalone(cliRequest.repoPath, {
              clearLogFile: true,
              replace: true,
            });
            return;
          }

          if (cliRequest.ref) {
            // spur start <spec> — open the resolved review ref
            const resolved = await resolveTarget(
              cliRequest.repoPath,
              cliRequest.ref,
            );
            if (cliRequest.focusedFile) {
              useSpurStore.getState().setPendingDeepLinkFocus({
                filePath: cliRequest.focusedFile,
                hunkHash: cliRequest.focusedHunkHash,
              });
            }
            // `resolved.ref`, not the spec as typed: that is what the tab ends
            // up pointed at, so the attachment's hint and the comparison on
            // screen say the same thing.
            await landReview(cliRequest.repoPath, resolved, {
              clearLogFile: true,
            });
          } else {
            // review <path> — open in browse mode
            await landBrowse(cliRequest.repoPath, {
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

        // A refresh lands like anything else. It looks like it shouldn't have
        // to — the workspace was made when this repo was first opened — but a
        // router-made one is `autoCreated`, so `workspace::cleanup` reaps it a
        // minute later if no terminal was started in it, and the reload after
        // that finds the repo belonging to nobody. Routing is idempotent when
        // one does still hold it.

        // Check if we were in standalone mode (non-git file/directory)
        if (window.location.pathname.startsWith("/standalone/browse")) {
          const fileMatch = window.location.pathname.match(
            /\/standalone\/browse\/file\/(.+)$/,
          );
          const rawPath = fileMatch
            ? `${storedPath}/${decodeURIComponent(fileMatch[1])}`
            : storedPath;
          // The stored root, not `rawPath`: a deep-linked file is inside the
          // directory, and the attachment is the directory.
          await landStandalone(rawPath, { replace: true });
          return;
        }

        // Check if we were in browse mode
        if (window.location.pathname.includes("/browse")) {
          await landBrowse(storedPath, { replace: true });
          return;
        }

        // Try to recover the review ref from the current URL path
        const urlRef = refFromReviewPath(window.location.pathname);
        const resolved = await resolveTarget(storedPath, urlRef);
        await landReview(storedPath, resolved, { storeInSession: false });
        return;
      }

      // Fall back to getting current working directory from API
      const apiClient = getApiClient();
      try {
        const path = await apiClient.getCurrentRepo();
        const resolved = await resolveTarget(path, null);
        // The directory the app was launched from is a landing like any other.
        await landReview(path, resolved, { clearLogFile: true });
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
    // The three landings are plain functions declared in the hook body, so each
    // is a new value every render — listing them here would turn a one-shot
    // init into an every-render one. Everything in this list is a stable
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
          await landStandalone(repoPath);
          return;
        }

        if (!ref) {
          // No ref — open in browse mode
          await landBrowse(repoPath, { focusedFile: data?.focusedFile });
          return;
        }

        if (data?.focusedFile) {
          useSpurStore.getState().setPendingDeepLinkFocus({
            filePath: data.focusedFile,
            hunkHash: data.focusedHunkHash ?? null,
          });
        }

        await landReview(repoPath, await resolveTarget(repoPath, ref), {
          boot: false,
        });
      },
    );

    return unlisten;
    // Same as above: the landings are re-created each render, and this effect
    // registers a listener that must be registered once.
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

  /**
   * Show a path with no comparison — the code half's answer to "open this
   * folder", whatever the folder turns out to be.
   *
   * git decides, not the caller: a repo browses its files at the checkout, and
   * anything else degrades to the standalone reader. Neither leaves the
   * workspace — both set `repoPath` to the same path the attachment names,
   * which is what `repoOnScreen` derives the focus from.
   */
  async function openPath(path: string): Promise<void> {
    // The same "already open" question the two review handlers ask, in the
    // terms this side has: a path, with no comparison over it, drawn by the
    // half — repo or reader — that the click is asking for. A folder that has
    // just become a repo is deliberately not a match: it is on screen as the
    // standalone reader, and the flag is what says so.
    const showing = (root: string, standalone: boolean): boolean => {
      const state = useSpurStore.getState();
      return (
        repoStatus === "found" &&
        state.repoPath === root &&
        state.isStandaloneFile === standalone &&
        state.comparison === null
      );
    };

    if (await getApiClient().isGitRepo(path)) {
      // Re-entering would re-resolve the repo's identity, re-list every
      // review, and navigate to the browse root — closing whatever file was
      // open — to arrive at the screen already drawn.
      if (showing(path, false) && window.location.pathname.includes("/browse"))
        return;
      await openBrowseModeRef.current(path);
      return;
    }
    const target = await standaloneTarget(path);
    if (
      showing(target.displayRoot, true) &&
      insideRoute(window.location.pathname, target.route)
    )
      return;
    enterStandaloneMode(target);
  }

  // ⌘O: pick a folder and open it in the focused workspace.
  //
  // It used to validate the pick as a git repository and land in browse mode
  // outside the workspace model, which made the app's oldest shortcut the one
  // gesture that produced a screen no card in the queue stood for. It is the
  // repo picker's "Open folder…" now, reached by keystroke — same dialog, same
  // attach, same landing — and it no longer refuses a plain directory, because
  // the code half can show one.
  const handleOpenRepo = useCallback(async () => {
    try {
      await openFolderInFocusedWorkspace();
    } catch (err) {
      console.error("Failed to open folder:", err);
    }
  }, []);

  // Activate a specific review from the sidebar — resolves the review's ref
  // into a comparison, then uses switchReview for cross-repo switches,
  // setComparison for same-repo switches.
  const handleActivateReview = useCallback(
    async (review: GlobalReviewSummary) => {
      const nav = navigateRef.current;
      const state = useSpurStore.getState();
      const meta = state.repoMetadata[review.repoPath];
      const routePrefix = meta?.routePrefix ?? `local/${review.repoName}`;
      const url = reviewUrl(routePrefix, review.ref);

      // Clicking the review that is already open: nothing below would produce
      // a different screen, and all of it is paid for. See
      // [`showingComparison`] — and [`insideReview`] for why the file stays
      // open rather than being dropped for the review root.
      if (showingComparison(state, review.repoPath, review.ref)) {
        // Re-affirmed rather than skipped: `setActiveReviewKey` is the one
        // choke point that records which tab a workspace was left on, and two
        // cards may attach the same repo — so the workspace this click lands
        // in can be a different one from the workspace that opened it. It
        // keeps the key by identity when nothing moved.
        setActiveReviewKey({ repoPath: review.repoPath, ref: review.ref });
        if (!insideReview(window.location.pathname, review.ref)) nav(url);
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

      useSpurStore.getState().setReadOnlyPreview(false);

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

      const state = useSpurStore.getState();
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
      useSpurStore.getState().setReadOnlyPreview(false);
    },
    [handleNewReview],
  );

  // Activate a local branch. The review's identity is the branch name; its
  // base is derived (or the stored override honored). If the branch is not the
  // current branch and has no worktree, enter read-only preview mode.
  const handleActivateLocalBranch = useCallback(
    (repoPath: string, branch: string) => {
      const nav = navigateRef.current;
      const state = useSpurStore.getState();

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
      const worktreePath =
        branchInfo?.worktreePath ?? existingReview?.worktreePath ?? null;

      // Clicking the branch that is already open. Looking at it is still
      // looking at it, so the mark above stands, and so does the pair below —
      // a worktree checked out since this branch was opened is a fact about
      // the same comparison, not a reason to rebuild it. Everything past this
      // point is: a resolve, a teardown of the loaded diff, and a whole pass
      // of the loader to redraw what is on screen. The review handler above
      // has always stopped here; a branch with no review record of its own —
      // the sidebar's ordinary row — did not. See [`showingComparison`].
      if (showingComparison(state, repoPath, branch)) {
        // See the same call in `handleActivateReview`: the tab memory is
        // recorded here, and the workspace this lands in may not be the one
        // that opened the comparison.
        setActiveReviewKey({ repoPath, ref: branch });
        if (state.readOnlyPreview !== isReadOnly)
          state.setReadOnlyPreview(isReadOnly);
        if (state.worktreePath !== worktreePath)
          state.setWorktreePath(worktreePath);
        // Only a URL that has wandered off this review is worth resolving the
        // repo's identity to rebuild.
        if (!insideReview(window.location.pathname, branch)) {
          void (async () => {
            const { routePrefix } = await resolveRepoIdentity(repoPath);
            nav(reviewUrl(routePrefix, branch));
          })();
        }
        return;
      }

      // Save navigation snapshot before switching
      state.saveNavigationSnapshot();

      void (async () => {
        const resolved = await resolveTarget(repoPath, branch);

        setActiveReviewKey({ repoPath, ref: branch });

        if (repoPath !== useSpurStore.getState().repoPath) {
          switchReview(repoPath, resolved);
        } else {
          setComparison(resolved);
        }

        // Set read-only preview and worktree path in store
        const storeActions = useSpurStore.getState();
        storeActions.setReadOnlyPreview(isReadOnly);
        storeActions.setWorktreePath(worktreePath);

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
    openPath,
    handleCloseRepo,
    handleActivateReview,
    handleNewReview,
    handleStartReview,
    handleActivateLocalBranch,
  };
}
