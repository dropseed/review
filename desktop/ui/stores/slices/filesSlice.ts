import type { ApiClient } from "../../api";
import type {
  BaseReason,
  Comparison,
  ResolvedReview,
  FileEntry,
  DiffHunk,
  FileDiff,
  MovePair,
  SearchMatch,
  HunkAttribution,
} from "../../types";
import { buildFileDiff } from "../../types";
import type { ReviewScope } from "../../types/scope";
import type { CommitRange } from "../../types/commitRange";
import { sameRange } from "../../types/commitRange";
import type { ReviewStore, SliceCreatorWithClient } from "../types";
import { createDebouncedFn, flattenFiles, isChangedStatus } from "../types";
import { mergeDeltaHunks, patchFileTree } from "../filesDelta";
import type { UndoEntry } from "./undoSlice";
import { ephemeralResetState } from "./ephemeralSlice";
import { symbolsResetState, repoSymbolsResetState } from "./symbolsSlice";
import { classificationResetState } from "./classificationSlice";
import { EMPTY_STAGED_SET } from "./gitSlice";
import { debouncedSave } from "./reviewSlice";
import { debouncedUndoSave } from "./undoSlice";

/** Cancel all pending debounced saves to prevent stale writes after switching reviews. */
export function cancelPendingSaves(): void {
  debouncedSave.cancel();
  debouncedUndoSave.cancel();
}

/**
 * Settle what the outgoing diff still owes, before the reset below throws its
 * state away: sidebar progress written, debounced saves cancelled, activities
 * cleared.
 *
 * `snapshot` records where the user was so the swap can be stepped back out of.
 * It is off for a swap that is *itself* the way back — leaving a commit peek
 * restores the file the peek interrupted, and snapshotting there would
 * overwrite that with the commit's own.
 */
export function beginDiffSwap(
  state: Pick<
    ReviewStore,
    "flushSidebarProgress" | "saveNavigationSnapshot" | "clearAllActivities"
  >,
  { snapshot }: { snapshot: boolean },
): void {
  state.flushSidebarProgress();
  cancelPendingSaves();
  if (snapshot) state.saveNavigationSnapshot();
  state.clearAllActivities();
}

// IMPORTANT: These patterns MUST stay in sync with the Rust implementation
// in compare/src/filters.rs. A synchronous version is used here (instead of
// the async ApiClient.shouldSkipFile) because it runs in a tight loop.
const SKIP_PATTERNS = [
  /^target\//, // Rust build artifacts
  /\/target\//, // Nested target directories
  /\.fingerprint\//, // Cargo fingerprints (binary)
  /^node_modules\//, // Node dependencies
  /\/node_modules\//, // Nested node_modules
  /\.git\//, // Git internals
  /__pycache__\//, // Python bytecode
  /\.pyc$/, // Python bytecode files
  /^dist\//, // Common build dir
  /^build\//, // Common build dir
  /\/\.next\//, // Next.js build cache
  /^\.next\//, // Next.js build cache
  /package-lock\.json$/, // Lock files (noisy diffs)
  /yarn\.lock$/, // Lock files
  /Cargo\.lock$/, // Lock files
  /pnpm-lock\.yaml$/, // Lock files
];

/** Check if a file path should be skipped (likely binary/build artifact). */
export function shouldSkipFile(path: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Group a flat list of hunks into per-file FileDiff entries. Preserves the
 * order hunks appear in the input list for each file.
 */
function groupHunksByPath(hunks: DiffHunk[]): Record<string, FileDiff> {
  const byPath: Record<string, DiffHunk[]> = {};
  for (const h of hunks) {
    (byPath[h.filePath] ??= []).push(h);
  }
  const out: Record<string, FileDiff> = {};
  for (const [path, pathHunks] of Object.entries(byPath)) {
    out[path] = buildFileDiff(pathHunks);
  }
  return out;
}

/**
 * Stamp `movePairId` onto the hunks named by a set of move pairs.
 *
 * The annotation is applied to whatever hunks the store currently holds rather
 * than to a snapshot sent to the backend and handed back: detection runs
 * deferred, so by the time it answers the diff may have moved on, and folding a
 * stale copy of a file back in would undo an edit the user can see. Ids the
 * store no longer knows are simply skipped — that file will be re-annotated by
 * the pass the edit itself schedules.
 */
function applyMovePairAnnotations(
  pairs: MovePair[],
  prevFilesByPath: Record<string, FileDiff>,
): Record<string, FileDiff> {
  const partnerById = new Map<string, string>();
  for (const pair of pairs) {
    partnerById.set(pair.sourceHunkId, pair.destHunkId);
    partnerById.set(pair.destHunkId, pair.sourceHunkId);
  }

  const next: Record<string, FileDiff> = { ...prevFilesByPath };
  let anyChanged = false;
  for (const [path, diff] of Object.entries(prevFilesByPath)) {
    let fileChanged = false;
    const hunks = diff.hunks.map((hunk) => {
      const movePairId = partnerById.get(hunk.id);
      if (hunk.movePairId === movePairId) return hunk;
      fileChanged = true;
      return { ...hunk, movePairId };
    });
    if (fileChanged) {
      next[path] = buildFileDiff(hunks);
      anyChanged = true;
    }
  }
  // Same object back when nothing moved, so the caller can skip the write.
  return anyChanged ? next : prevFilesByPath;
}

/** Order-sensitive equality on (sourceHunkId, destHunkId) tuples. */
function movePairsChanged(prev: MovePair[], next: MovePair[]): boolean {
  if (prev.length !== next.length) return true;
  for (let i = 0; i < prev.length; i++) {
    if (
      prev[i].sourceHunkId !== next[i].sourceHunkId ||
      prev[i].destHunkId !== next[i].destHunkId
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Tracks file/hunk loading progress. `null` means no load is in progress
 * (either before any repo is opened, or after loading completes).
 * The "pending" phase signals that a new load is about to begin.
 */
export interface LoadingProgress {
  current: number;
  total: number;
  phase: "pending" | "files" | "hunks";
}

export interface FilesSlice {
  // Core state
  repoPath: string | null;
  // The resolved base..head pair the data endpoints diff (plumbing). Derived
  // from the review identity via `resolveReview`; changes when the base
  // override changes without changing the review's identity.
  comparison: Comparison | null;
  // The review's own base..head, unaffected by commit-range narrowing. Kept
  // alongside `comparison` because a range replaces `comparison` wholesale:
  // this is what "All commits" restores, and what commit attribution (the
  // branch's full commit list) is always loaded from.
  reviewComparison: Comparison | null;
  // The commit sub-range `comparison` is currently narrowed to, if any.
  commitRange: CommitRange | null;
  // The active review's identity: the ref being reviewed. Store keys and
  // keyed records (grouping, navigation snapshots, activeReviewKey) derive from
  // this, so they survive a base-override change.
  reviewRef: string | null;
  // The active review's explicit base override, if any (for the header control).
  reviewBaseOverride: string | null;
  // Why the base was chosen — drives the breadcrumb's comparison label.
  baseReason: BaseReason | null;
  currentBranch: string | null;
  files: FileEntry[];
  allFiles: FileEntry[];
  allFilesLoading: boolean;
  /**
   * Primary hunk state: per-file diff bundles keyed by repo-relative path.
   * Writes target individual entries so viewers subscribing to one path
   * don't invalidate on unrelated-file edits. Aggregate consumers use the
   * `useAllHunks()` selector (memoized on `filesByPath` + `flatFileList`).
   */
  filesByPath: Record<string, FileDiff>;
  /**
   * Per-path version counter, bumped by the file watcher in browse mode.
   * Viewers reading raw file content (no FileDiff to subscribe to) watch
   * their own path's entry to know when to refetch.
   */
  fileVersions: Record<string, number>;
  movePairs: MovePair[];
  loadingProgress: LoadingProgress | null;
  // Cached flattened file paths (computed when files change)
  flatFileList: string[];
  // Tracks which gitignored directories have been loaded
  loadedGitIgnoredDirs: Set<string>;
  // True when viewing a standalone file (not in a git repo)
  isStandaloneFile: boolean;

  // Actions
  setRepoPath: (path: string | null) => void;
  /** Set the active review (comparison + identity) within the current repo. */
  setComparison: (resolved: ResolvedReview | null) => void;
  /**
   * Narrow the review to a commit sub-range, or restore the full review
   * comparison with `null`. Re-diffs (the range *is* the comparison), so it
   * clears loaded files/hunks — but keeps the review's identity and its commit
   * attribution, which describe the branch rather than the current range.
   */
  setCommitRange: (range: CommitRange | null) => void;
  /** Atomically set repoPath and the active review in one update, preventing phantom review entries. */
  switchReview: (path: string, resolved: ResolvedReview) => void;
  setFiles: (files: FileEntry[]) => void;
  /** Replace a single file's FileDiff in one set(). Skips if contentHash is unchanged. */
  syncFileHunks: (filePath: string, freshHunks: DiffHunk[]) => void;

  // Loading
  loadFiles: (isRefreshing?: boolean) => Promise<void>;
  loadAllFiles: (isRefreshing?: boolean) => Promise<void>;
  /** Load all tracked files (no comparison needed, for browse mode) */
  loadRepoFiles: () => Promise<void>;
  /** Load the current branch name */
  loadCurrentBranch: () => Promise<void>;
  /** Load contents of a gitignored directory and merge into allFiles */
  loadDirectoryContents: (dirPath: string) => Promise<void>;
  /**
   * Recompute the named paths and patch them into the loaded diff, leaving
   * every other file's state — and object identity — alone.
   */
  applyFilesDelta: (paths: string[]) => Promise<WatcherPatch>;
  /**
   * Re-detect move pairs for the whole comparison, after a quiet moment.
   *
   * Deferred because it is display enrichment, not the diff: a hunk without
   * its move annotation still renders correctly, so this must never sit
   * between an edit and the updated diff appearing.
   */
  scheduleMovePairRefresh: () => void;
  /**
   * Apply a working-tree watcher event's file-level impact. In browse mode
   * just triggers a re-fetch for any open viewer; in review mode patches the
   * changed paths in, falling back to a full reload for an implausibly large
   * batch or a failed delta.
   */
  applyFileWatcherEvent: (changedPaths: string[]) => Promise<WatcherPatch>;
}

/**
 * What a watcher event actually did, for the caller that has to decide what
 * else to recompute.
 *
 * The distinction that matters is `scope`: after an incremental patch only
 * `addedHunkIds` can need classifying and only `paths` can need reconciling,
 * while a full reload leaves nothing scoped and has to be treated as new.
 */
export interface WatcherPatch {
  scope: "incremental" | "full";
  /** Whether any hunks actually changed — nothing downstream is due if not. */
  hunksChanged: boolean;
  /** Hunk ids new to the diff. Meaningful only for an incremental patch. */
  addedHunkIds: string[];
  /** The paths the patch covered. */
  paths: string[];
}

const NO_PATCH: WatcherPatch = {
  scope: "incremental",
  hunksChanged: false,
  addedHunkIds: [],
  paths: [],
};

/**
 * Above this many paths in one debounce window, patching file by file stops
 * being the cheaper answer — and the event has stopped looking like someone
 * editing code. A branch switch or a `git stash` lands here, where a full
 * reload is both faster and the only thing that can be right.
 */
const MAX_INCREMENTAL_PATHS = 20;

/** How long the diff has to sit still before move detection re-runs. */
const MOVE_PAIR_DEBOUNCE_MS = 1000;
const movePairRefresh = createDebouncedFn(MOVE_PAIR_DEBOUNCE_MS);

/**
 * Everything derived from one `base..head` diff. Cleared whenever the diff
 * being shown changes — including a commit-range narrowing, which re-diffs.
 */
export const diffDataResetState = {
  // Files
  files: [] as FileEntry[],
  allFiles: [] as FileEntry[],
  allFilesLoading: false,
  filesByPath: {} as Record<string, FileDiff>,
  fileVersions: {} as Record<string, number>,
  movePairs: [] as MovePair[],
  flatFileList: [] as string[],
  loadingProgress: { phase: "pending" as const, current: 0, total: 0 },
  // Navigation
  selectedFile: null,
  focusedHunkId: null,
  scrollTarget: null,
  guideContentMode: null,
  secondaryFile: null,
  focusedPane: "primary" as const,
  groupingSidebarOpen: false,
  workingTreeDiffFile: null,
  scope: null as ReviewScope | null,
  guideMode: false,
  activeGroupIndex: 0,
  // Mouse back/forward file history is per-comparison — don't let it carry
  // stale files across a switch.
  fileNavHistory: [] as string[],
  fileNavIndex: -1,
  // Review
  carriedForward: 0,
  undoStack: [] as UndoEntry[],
  readOnlyPreview: false,
  // Other slices
  ...symbolsResetState,
  ...classificationResetState,
};

/**
 * What identifies *which review* is open, plus the branch-scoped data hanging
 * off it (persisted decisions, the commit list, the worktree). Survives a
 * commit-range narrowing — the range changes the diff, not the review — so
 * only the review/repo switches below clear it.
 */
const reviewIdentityResetState = {
  reviewRef: null as string | null,
  reviewBaseOverride: null as string | null,
  baseReason: null as BaseReason | null,
  reviewComparison: null as Comparison | null,
  commitRange: null as CommitRange | null,
  reviewState: null,
  ...ephemeralResetState,
  // History
  attribution: null as HunkAttribution | null,
  attributionLoading: false,
  attributionLoaded: false,
  // Worktree
  worktreePath: null as string | null,
  worktreeStale: false,
};

/** State reset shared between comparison and repo switches. */
const comparisonResetState = {
  ...diffDataResetState,
  ...reviewIdentityResetState,
};

/** Additional state reset only needed when switching repositories. */
const repoResetState = {
  currentBranch: null as string | null,
  loadedGitIgnoredDirs: new Set<string>(),
  isStandaloneFile: false,
  // Search
  searchQuery: "",
  searchResults: [] as SearchMatch[],
  searchLoading: false,
  searchError: null,
  searchVerifiedOnly: false,
  // Git
  gitStatus: null,
  stagedFilePaths: EMPTY_STAGED_SET,
  // Other slices
  ...repoSymbolsResetState,
};

export const createFilesSlice: SliceCreatorWithClient<FilesSlice> =
  (client: ApiClient) => (set, get) => ({
    repoPath: null,
    comparison: null,
    reviewComparison: null,
    commitRange: null,
    reviewRef: null,
    reviewBaseOverride: null,
    baseReason: null,
    currentBranch: null,
    files: [],
    allFiles: [],
    allFilesLoading: false,
    filesByPath: {},
    fileVersions: {},
    movePairs: [],
    loadingProgress: null,
    flatFileList: [],
    loadedGitIgnoredDirs: new Set<string>(),
    isStandaloneFile: false,
    worktreePath: null,
    worktreeStale: false,

    setRepoPath: (path) => {
      const currentPath = get().repoPath;
      if (path === currentPath) return;

      cancelPendingSaves();
      get().clearAllActivities();

      // Reset all per-repo state when switching repositories.
      // Since all slices share one Zustand store, we can reset cross-slice
      // state here to prevent stale data from the previous repo.
      set({
        repoPath: path,
        ...comparisonResetState,
        ...repoResetState,
      });
    },

    setComparison: (resolved) => {
      beginDiffSwap(get(), { snapshot: true });
      // Clear stale data and signal that new data is loading. Identity fields
      // are set after the reset spread so they win.
      set({
        ...comparisonResetState,
        comparison: resolved?.comparison ?? null,
        reviewComparison: resolved?.comparison ?? null,
        reviewRef: resolved?.ref ?? null,
        reviewBaseOverride: resolved?.baseOverride ?? null,
        baseReason: resolved?.baseReason ?? null,
      });
    },

    setCommitRange: (range) => {
      const { reviewComparison, commitRange } = get();
      if (!reviewComparison) return;
      if (sameRange(range, commitRange)) return;

      beginDiffSwap(get(), { snapshot: true });

      // Only the diff data resets. The review's identity — and with it the
      // branch's commit list, which is what the picker offers ranges from —
      // is untouched by construction, not carried forward field by field.
      set({
        ...diffDataResetState,
        comparison: range ? range.comparison : reviewComparison,
        commitRange: range,
      });
    },

    switchReview: (path, resolved) => {
      beginDiffSwap(get(), { snapshot: true });

      // Atomic update: sets repoPath and the active review together with the
      // union of resets from setRepoPath and setComparison, preventing the
      // intermediate state that caused phantom review entries.
      set({
        ...comparisonResetState,
        ...repoResetState,
        repoPath: path,
        comparison: resolved.comparison,
        reviewComparison: resolved.comparison,
        reviewRef: resolved.ref,
        reviewBaseOverride: resolved.baseOverride ?? null,
        baseReason: resolved.baseReason ?? null,
      });
    },

    setFiles: (files) => set({ files, flatFileList: flattenFiles(files) }),

    syncFileHunks: (filePath, freshHunks) => {
      const { filesByPath } = get();
      const freshDiff = buildFileDiff(freshHunks);
      const existing = filesByPath[filePath];
      if (existing && existing.contentHash === freshDiff.contentHash) return;

      set({
        filesByPath: { ...filesByPath, [filePath]: freshDiff },
      });
    },

    loadFiles: async (isRefreshing = false) => {
      const {
        repoPath,
        comparison,
        clearSymbols,
        startActivity,
        updateActivity,
        endActivity,
      } = get();
      if (!repoPath || !comparison) return;

      // Capture comparison key so we can detect if the user switched
      // comparisons while this async operation was in-flight.
      const comparisonKey = comparison.key;
      const isStale = () => get().comparison?.key !== comparisonKey;

      // Clear symbols so they reload when the Symbols tab is next opened.
      // Skip during refresh to avoid a visual flash — symbols will update
      // naturally when the FileViewer re-fetches with new data.
      if (!isRefreshing) {
        clearSymbols();
      }

      const loadStart = performance.now();

      try {
        // Phase 1: Get file list
        if (!isRefreshing) {
          set({ loadingProgress: { current: 0, total: 1, phase: "files" } });
        }
        startActivity("load-files", "Loading files", 20);
        const phase1Start = performance.now();
        const files = await client.listFiles(repoPath, comparison);
        // Bail before touching any shared state: a newer comparison's own
        // load may already own loadingProgress/the "load-files" activity.
        if (isStale()) return;
        endActivity("load-files");
        const flatFileList = flattenFiles(files);
        console.log(
          `[perf] Phase 1 (list files): ${(performance.now() - phase1Start).toFixed(0)}ms, ${flatFileList.length} files`,
        );

        // During refresh, defer set() to batch with hunks at the end
        if (!isRefreshing) {
          set({ files, flatFileList });
        }

        // Collect changed file paths (filtering out likely binary/build artifacts)
        const changedPaths: string[] = [];
        let skippedCount = 0;
        const collectChangedPaths = (entries: FileEntry[]) => {
          for (const entry of entries) {
            if (!entry.isDirectory && isChangedStatus(entry.status)) {
              if (shouldSkipFile(entry.path)) {
                skippedCount++;
              } else {
                changedPaths.push(entry.path);
              }
            }
            if (entry.children) {
              collectChangedPaths(entry.children);
            }
          }
        };
        collectChangedPaths(files);

        if (skippedCount > 0) {
          console.log(
            `Skipped ${skippedCount} files (build artifacts/binary files)`,
          );
        }

        // Phase 2: Load hunks for changed files
        const phase2Start = performance.now();
        const allHunks: DiffHunk[] = [];
        const failedFiles: string[] = [];
        const total = changedPaths.length;

        startActivity("load-hunks", "Loading hunks", 30);
        if (changedPaths.length > 0 && client.getAllHunks) {
          // Batch mode: single IPC call for all hunks
          if (!isRefreshing) {
            set({
              loadingProgress: { current: 0, total: 1, phase: "hunks" },
            });
          }
          try {
            const batchHunks = await client.getAllHunks(
              repoPath,
              comparison,
              changedPaths,
            );
            allHunks.push(...batchHunks);
          } catch (err) {
            console.warn(
              "[perf] Batch hunk loading failed, falling back to per-file:",
              err,
            );
            // Fall back to per-file loading
            for (let i = 0; i < changedPaths.length; i++) {
              const filePath = changedPaths[i];
              if (!isRefreshing) {
                set({
                  loadingProgress: {
                    current: i + 1,
                    total,
                    phase: "hunks",
                  },
                });
              }
              updateActivity("load-hunks", { current: i + 1, total });
              if (i % 5 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
              }
              try {
                const content = await client.getFileContent(
                  repoPath,
                  filePath,
                  comparison,
                );
                allHunks.push(...content.hunks);
              } catch (err) {
                console.warn(`Failed to load hunks for ${filePath}:`, err);
                failedFiles.push(filePath);
              }
            }
          }
        } else {
          // Per-file mode (fallback for clients without getAllHunks)
          for (let i = 0; i < changedPaths.length; i++) {
            const filePath = changedPaths[i];
            if (!isRefreshing) {
              set({
                loadingProgress: { current: i + 1, total, phase: "hunks" },
              });
            }
            updateActivity("load-hunks", { current: i + 1, total });

            // Yield to event loop periodically to allow UI to update
            if (i % 5 === 0) {
              await new Promise((resolve) => setTimeout(resolve, 0));
            }

            try {
              const content = await client.getFileContent(
                repoPath,
                filePath,
                comparison,
              );
              allHunks.push(...content.hunks);
            } catch (err) {
              console.warn(`Failed to load hunks for ${filePath}:`, err);
              failedFiles.push(filePath);
            }
          }
        }

        // Bail before touching any shared state: a newer comparison's own
        // load may already own loadingProgress/the "load-hunks" activity.
        if (isStale()) return;
        endActivity("load-hunks");
        console.log(
          `[perf] Phase 2 (load hunks): ${(performance.now() - phase2Start).toFixed(0)}ms, ${allHunks.length} hunks from ${changedPaths.length} files`,
        );

        if (failedFiles.length > 0) {
          console.warn(
            `Failed to load hunks for ${failedFiles.length} files:`,
            failedFiles.length <= 5
              ? failedFiles
              : [
                  ...failedFiles.slice(0, 5),
                  `... and ${failedFiles.length - 5} more`,
                ],
          );
        }

        // Commit results. We do per-path equality-by-contentHash so that file
        // entries whose hunks didn't change keep their previous object
        // reference. Viewers subscribing via `useFileHunks(path)` only
        // re-render for paths that actually changed.
        const prev = get();
        const freshFilesByPath = groupHunksByPath(allHunks);
        let anyFileChanged = false;
        let anyReferenceChanged = false;
        const nextFilesByPath: Record<string, FileDiff> = {};
        // Include fresh entries (preserve old reference when contentHash matches)
        for (const [path, fd] of Object.entries(freshFilesByPath)) {
          const old = prev.filesByPath[path];
          if (old && old.contentHash === fd.contentHash) {
            nextFilesByPath[path] = old;
          } else {
            nextFilesByPath[path] = fd;
            anyFileChanged = true;
            anyReferenceChanged = true;
          }
        }
        // Detect removed files (present before, absent now)
        for (const path of Object.keys(prev.filesByPath)) {
          if (!(path in freshFilesByPath)) {
            anyFileChanged = true;
            anyReferenceChanged = true;
          }
        }

        const structureChanged =
          prev.flatFileList.length !== flatFileList.length ||
          prev.flatFileList.some((p, i) => p !== flatFileList[i]);

        if (anyReferenceChanged || structureChanged) {
          set({
            ...(structureChanged ? { files, flatFileList } : {}),
            filesByPath: nextFilesByPath,
          });
        }

        // Clear progress
        if (!isRefreshing) {
          set({ loadingProgress: null });
        }

        console.log(
          `[perf] Total loadFiles: ${(performance.now() - loadStart).toFixed(0)}ms`,
        );

        // Detect move pairs in the background. Only re-run when file contents
        // actually changed; on no-op refreshes, skip the round trip entirely.
        if (anyFileChanged) {
          get().scheduleMovePairRefresh();
        }
      } catch (err) {
        console.error("Failed to load files:", err);
        if (isStale()) return;
        // Clean up any activities that may have been started but not ended
        endActivity("load-files");
        endActivity("load-hunks");
        if (!isRefreshing) {
          set({ loadingProgress: null });
        }
      }
    },

    loadAllFiles: async (isRefreshing = false) => {
      const { repoPath, comparison } = get();
      if (!repoPath || !comparison) return;

      // Discard a stale response: if the comparison changed while this
      // request was in flight, don't clobber the new comparison's loading
      // state (same race guarded against in loadSymbols/loadRepoSymbols).
      const comparisonKey = comparison.key;
      const isStale = () => get().comparison?.key !== comparisonKey;
      if (!isRefreshing) {
        set({ allFilesLoading: true });
      }
      try {
        const allFiles = await client.listAllFiles(repoPath, comparison);
        if (isStale()) {
          set({ allFilesLoading: false });
          return;
        }
        set({ allFiles, allFilesLoading: false });
      } catch (err) {
        console.error("Failed to load all files:", err);
        if (isStale()) return;
        set({ allFilesLoading: false });
      }
    },

    loadRepoFiles: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      // Discard a stale response: if the repo changed while this request
      // was in flight, don't clobber the new repo's loading state (same
      // race guarded against in loadSymbols/loadRepoSymbols).
      const isStale = () => get().repoPath !== repoPath;
      set({ allFilesLoading: true });
      try {
        const allFiles = await client.listRepoFiles(repoPath);
        if (isStale()) {
          set({ allFilesLoading: false });
          return;
        }
        set({ allFiles, allFilesLoading: false });
      } catch (err) {
        console.error("Failed to load repo files:", err);
        if (isStale()) return;
        set({ allFilesLoading: false });
      }
    },

    loadCurrentBranch: async () => {
      const { repoPath } = get();
      if (!repoPath) return;
      try {
        const branch = await client.getCurrentBranch(repoPath);
        if (get().repoPath === repoPath) {
          set({ currentBranch: branch });
        }
      } catch (err) {
        console.error("Failed to load current branch:", err);
      }
    },

    loadDirectoryContents: async (dirPath: string) => {
      const { repoPath, loadedGitIgnoredDirs } = get();
      if (!repoPath) return;

      // Skip if already loaded
      if (loadedGitIgnoredDirs.has(dirPath)) return;

      try {
        const contents = await client.listDirectoryContents(repoPath, dirPath);

        // Don't update if repo changed while loading
        if (get().repoPath !== repoPath) return;

        // Mark as loaded
        const newLoadedDirs = new Set(get().loadedGitIgnoredDirs);
        newLoadedDirs.add(dirPath);

        // Merge contents into allFiles tree by finding the target directory
        // and replacing its children with the newly loaded contents
        function mergeIntoTree(
          entries: FileEntry[],
          targetPath: string,
          newChildren: FileEntry[],
        ): FileEntry[] {
          return entries.map((entry) => {
            if (entry.path === targetPath) {
              return { ...entry, children: newChildren };
            }
            if (entry.children && targetPath.startsWith(entry.path + "/")) {
              return {
                ...entry,
                children: mergeIntoTree(
                  entry.children,
                  targetPath,
                  newChildren,
                ),
              };
            }
            return entry;
          });
        }

        const updatedAllFiles = mergeIntoTree(
          get().allFiles,
          dirPath,
          contents,
        );
        set({ allFiles: updatedAllFiles, loadedGitIgnoredDirs: newLoadedDirs });
      } catch (err) {
        console.error(`Failed to load directory contents for ${dirPath}:`, err);
      }
    },

    applyFilesDelta: async (paths: string[]) => {
      const { repoPath, comparison } = get();
      if (!repoPath || !comparison || paths.length === 0) return NO_PATCH;

      const comparisonKey = comparison.key;
      const isStale = () => get().comparison?.key !== comparisonKey;
      const t0 = performance.now();

      let delta;
      try {
        delta = await client.getFilesDelta(repoPath, comparison, paths);
      } catch (err) {
        // Incremental is an optimization, never a different answer — anything
        // unexpected goes back to the pipeline that can't be wrong.
        console.warn(
          "[watcher] delta failed, falling back to full reload:",
          err,
        );
        await Promise.all([get().loadFiles(true), get().loadAllFiles(true)]);
        return { scope: "full", hunksChanged: true, addedHunkIds: [], paths };
      }
      if (isStale()) return NO_PATCH;

      const prev = get();
      const merged = mergeDeltaHunks(prev.filesByPath, delta);
      const tree = patchFileTree(prev.files, delta.files);
      // The file finder's whole-repo listing has the same shape and the same
      // three things can happen to it, but it is loaded separately — patching
      // an empty one would invent a tree out of the handful of changed paths.
      const allTree =
        prev.allFiles.length > 0
          ? patchFileTree(prev.allFiles, delta.files)
          : { entries: prev.allFiles, changed: false };

      if (merged.changed || tree.changed || allTree.changed) {
        set({
          ...(merged.changed ? { filesByPath: merged.filesByPath } : {}),
          ...(tree.changed
            ? { files: tree.entries, flatFileList: flattenFiles(tree.entries) }
            : {}),
          ...(allTree.changed ? { allFiles: allTree.entries } : {}),
        });
      }

      console.log(
        `[perf] files delta: ${paths.length} paths, ${delta.hunks.length} hunks in ${(
          performance.now() - t0
        ).toFixed(0)}ms (hunks ${merged.changed ? "changed" : "unchanged"}, ${
          merged.addedHunkIds.length
        } new)`,
      );

      if (merged.changed) get().scheduleMovePairRefresh();

      return {
        scope: "incremental",
        hunksChanged: merged.changed,
        addedHunkIds: merged.addedHunkIds,
        paths,
      };
    },

    scheduleMovePairRefresh: () => {
      const comparisonKey = get().comparison?.key;
      if (!comparisonKey) return;

      movePairRefresh(async () => {
        const { repoPath, comparison } = get();
        if (!repoPath || comparison?.key !== comparisonKey) return;

        const t0 = performance.now();
        try {
          const pairs = await client.getComparisonMovePairs(
            repoPath,
            comparison,
          );
          if (get().comparison?.key !== comparisonKey) return;

          const filesByPath = applyMovePairAnnotations(
            pairs,
            get().filesByPath,
          );
          if (
            filesByPath === get().filesByPath &&
            !movePairsChanged(get().movePairs, pairs)
          ) {
            return;
          }
          set({ filesByPath, movePairs: pairs });
          console.log(
            `[perf] move detection (deferred): ${(performance.now() - t0).toFixed(0)}ms, ${pairs.length} pairs`,
          );
        } catch (err) {
          console.error("Failed to detect move pairs:", err);
        }
      });
    },

    applyFileWatcherEvent: async (changedPaths) => {
      const { comparison, applyFilesDelta, loadFiles, loadAllFiles } = get();

      // Browse mode: no diff to invalidate, so bump per-path versions in one
      // set() — raw-content viewers refetch via their fileVersion subscription.
      if (!comparison) {
        if (changedPaths.length === 0) return NO_PATCH;
        const prev = get().fileVersions;
        const next = { ...prev };
        for (const path of changedPaths) {
          next[path] = (next[path] ?? 0) + 1;
        }
        set({ fileVersions: next });
        return NO_PATCH;
      }

      // Filter out binary/build artifacts we never diff.
      const paths = changedPaths.filter((p) => !shouldSkipFile(p));
      if (paths.length === 0) return NO_PATCH;

      if (paths.length > MAX_INCREMENTAL_PATHS) {
        await Promise.all([loadFiles(true), loadAllFiles(true)]);
        return { scope: "full", hunksChanged: true, addedHunkIds: [], paths };
      }

      return applyFilesDelta(paths);
    },
  });
