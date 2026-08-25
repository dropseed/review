import { useEffect, useRef } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import {
  fingerprintsMatch,
  probeDiff,
  statusFingerprint,
  type RestoredComparison,
} from "../stores/comparisonCache";
import { ephemeralView } from "../stores/selectors/viewpoint";
import { flattenFiles } from "../stores/types";

/**
 * Has git moved under the snapshot that was just painted?
 *
 * Three cheap reads against the two the snapshot recorded on its way out. The
 * two SHAs settle a comparison of commits outright; `--shortstat` is what
 * catches an edit to a checked-out head, where the diff includes the working
 * tree and no ref moves; and git status catches a file appearing, vanishing, or
 * being staged. Anything git declines to answer reads as drift, because the
 * only safe direction to be wrong in is the expensive one.
 */
export async function hasDrifted(
  restored: RestoredComparison,
): Promise<boolean> {
  const { repoPath, comparison, loadGitStatus } = useReviewStore.getState();
  if (!repoPath || !comparison) return true;

  const [before, after] = await Promise.all([
    restored.fingerprint,
    probeDiff(repoPath, comparison),
    loadGitStatus(),
  ]);
  if (!fingerprintsMatch(before, after)) return true;
  return (
    statusFingerprint(useReviewStore.getState().gitStatus) !== restored.status
  );
}

/**
 * Coordinates loading of files and review state when comparison is ready.
 *
 * Data loaded lazily by their respective UI components:
 * - Symbols: FilesPanel triggers loadSymbols when flat mode is entered
 * - The whole-repo tree: Browse and the ⌘P file list call `ensureAllFiles`
 */
export function useComparisonLoader(
  comparisonReady: number,
  setInitialLoading: (loading: boolean) => void,
): void {
  const repoPath = useReviewStore((s) => s.repoPath);
  const comparisonKey = useReviewStore((s) => s.comparison?.key);
  const isStandaloneFile = useReviewStore((s) => s.isStandaloneFile);

  // Tracks the repo the cached gitUser belongs to, so a branch/comparison
  // switch within the same repo doesn't needlessly clear it.
  const gitUserRepoRef = useRef<string | null>(null);

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
          // Also populate flatFileList so useFileRouteSync can resolve a
          // deep-linked standalone file (e.g. /standalone/browse/file/<name>).
          useReviewStore.setState({
            allFiles: files,
            allFilesLoading: false,
            flatFileList: flattenFiles(files),
          });
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
      reconcileReviewState,
      loadFiles,
      loadGitStatus,
      loadRemoteInfo,
      loadGitUser,
      syncTotalDiffHunks,
      classifyStaticHunks,
      restoreGuideFromState,
      restoreNavigationSnapshot,
    } = useReviewStore.getState();

    // Clear stale search results from previous comparison
    clearSearch();

    let cancelled = false;

    // Clear stale gitUser only when the repo actually changed — a branch or
    // comparison switch within the same repo keeps the same identity, so
    // clearing it there would just cause a needless null flicker.
    if (gitUserRepoRef.current !== repoPath) {
      gitUserRepoRef.current = repoPath;
      useReviewStore.setState({ gitUser: null });
    }

    async function loadData(): Promise<void> {
      try {
        // A commit being peeked at: load the diff and stop. Everything below
        // this either reads or writes review state, and a peek has none by
        // construction (`setViewpoint` clears it, `loadReviewState`
        // refuses to refill it) — so running any of it would at best do
        // nothing and at worst reconcile the review's decisions against a
        // comparison the review isn't of.
        if (ephemeralView(useReviewStore.getState())) {
          await Promise.all([loadFiles(), loadGitStatus()]);
          return;
        }

        // A comparison restored from the snapshot cache is already on screen.
        // What is owed is proof that it is still the right answer.
        const restored = useReviewStore.getState().restoredComparison;
        if (restored && restored.key === comparisonKey) {
          useReviewStore.setState({ restoredComparison: null });
          setInitialLoading(false);

          // The probe's git subprocesses and the review-state file read have
          // nothing to say to each other, so they run together. The review
          // reload is unconditional either way: a decision an agent or the
          // CLI made while this workspace was off screen moves nothing the
          // probe can see.
          const drifted = hasDrifted(restored);
          await loadReviewState();
          if (cancelled) return;

          if (await drifted) {
            if (cancelled) return;
            // Cached is an optimization, never a different answer. The full
            // pipeline runs in refresh mode — its own reconcile included —
            // so the snapshot on screen is corrected in place rather than
            // replaced by a skeleton.
            await useReviewStore.getState().refresh();
          } else {
            await reconcileReviewState();
            if (cancelled) return;
            syncTotalDiffHunks();
            classifyStaticHunks();
            restoreGuideFromState();
          }
          if (cancelled) return;

          loadRemoteInfo();
          loadGitUser();
          restoreNavigationSnapshot();
          return;
        }

        // Load review state and files in parallel
        // (review state is only needed by classifyStaticHunks, which runs after both complete)
        startActivity("load-state", "Loading review state", 10);
        await Promise.all([
          loadReviewState().then(() => endActivity("load-state")),
          loadFiles(),
          loadGitStatus(),
          // Resolved early so the first annotation in this session is
          // attributed correctly even if the user is fast.
          loadGitUser(),
        ]);
        if (cancelled) return;

        // Both the persisted decisions and the live diff are now loaded —
        // carry decisions forward onto the current hunks (no extra git diff).
        await reconcileReviewState();
        if (cancelled) return;

        // Sync worktreePath from loaded review state into the store,
        // validating that the directory still exists on disk.
        const currentRepoPath = repoPath!; // guaranteed non-null by guard above
        const {
          reviewState: loadedReviewState,
          worktreePath: currentWorktreePath,
          comparison,
        } = useReviewStore.getState();
        if (loadedReviewState?.worktreePath && !currentWorktreePath) {
          const client = getApiClient();
          const wtPath = loadedReviewState.worktreePath;

          // Validate worktree exists + check freshness in parallel
          try {
            const [worktreeSha, branchTipSha] = await Promise.all([
              client.resolveRef(wtPath, "HEAD"),
              comparison
                ? client.resolveRef(currentRepoPath, comparison.head)
                : Promise.resolve(""),
            ]);
            if (cancelled) return;
            const { setWorktreePath, setWorktreeStale } =
              useReviewStore.getState();
            setWorktreePath(wtPath);
            setWorktreeStale(!!branchTipSha && worktreeSha !== branchTipSha);
          } catch {
            // resolveRef failed — worktree directory is missing
            console.warn(`Worktree directory missing: ${wtPath}`);
            useReviewStore.getState().setWorktreePath(null);
            if (comparison) {
              client
                .saveReviewState(currentRepoPath, {
                  ...loadedReviewState,
                  worktreePath: undefined,
                  updatedAt: new Date().toISOString(),
                })
                .catch(() => {}); // Non-fatal
            }
          }
        }

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
