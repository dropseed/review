import type { ApiClient } from "../../api";
import type {
  Comparison,
  FileEntry,
  DiffHunk,
  MovePair,
  SearchMatch,
  CommitEntry,
} from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { flattenFiles, flattenFilesWithStatus } from "../types";
import type { UndoEntry } from "./undoSlice";
import { symbolsResetState } from "./symbolsSlice";
import { classificationResetState } from "./classificationSlice";
import { EMPTY_STAGED_SET } from "./gitSlice";
import { debouncedSave } from "./reviewSlice";
import { debouncedUndoSave } from "./undoSlice";

/** Cancel all pending debounced saves to prevent stale writes after switching reviews. */
export function cancelPendingSaves(): void {
  debouncedSave.cancel();
  debouncedUndoSave.cancel();
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

/** Build a path → hunk-ID[] index in a single pass. */
function hunkIdsByPath(hunks: DiffHunk[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const h of hunks) {
    const arr = map.get(h.filePath);
    if (arr) arr.push(h.id);
    else map.set(h.filePath, [h.id]);
  }
  return map;
}

function stringArraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Flat-compare file trees by (path, status) tuples. Order-sensitive. */
export function filesStructureEqual(a: FileEntry[], b: FileEntry[]): boolean {
  const fa = flattenFilesWithStatus(a);
  const fb = flattenFilesWithStatus(b);
  if (fa.length !== fb.length) return false;
  for (let i = 0; i < fa.length; i++) {
    if (fa[i].path !== fb[i].path || fa[i].status !== fb[i].status)
      return false;
  }
  return true;
}

/** Compare move-pair arrays by (sourceHunkId, destHunkId) tuples. Order-sensitive. */
export function movePairsEqual(a: MovePair[], b: MovePair[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (
      a[i].sourceHunkId !== b[i].sourceHunkId ||
      a[i].destHunkId !== b[i].destHunkId
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Return paths whose hunk-ID sequence differs between `oldHunks` and `newHunks`.
 * Hunk IDs embed content hashes, so differing IDs mean observable changes.
 */
export function diffChangedPaths(
  oldHunks: DiffHunk[],
  newHunks: DiffHunk[],
): string[] {
  const oldMap = hunkIdsByPath(oldHunks);
  const newMap = hunkIdsByPath(newHunks);
  const paths = new Set<string>([...oldMap.keys(), ...newMap.keys()]);
  const changed: string[] = [];
  for (const p of paths) {
    const a = oldMap.get(p) ?? [];
    const b = newMap.get(p) ?? [];
    if (!stringArraysEqual(a, b)) changed.push(p);
  }
  return changed;
}

/** True if the store's hunks for `filePath` have the same IDs in the same order as `freshHunks`. */
function hunkIdsForPathEqual(
  storeHunks: DiffHunk[],
  filePath: string,
  freshHunks: DiffHunk[],
): boolean {
  let storeIdx = 0;
  for (let i = 0; i < storeHunks.length; i++) {
    if (storeHunks[i].filePath !== filePath) continue;
    if (storeIdx >= freshHunks.length) return false;
    if (storeHunks[i].id !== freshHunks[storeIdx].id) return false;
    storeIdx++;
  }
  return storeIdx === freshHunks.length;
}

/**
 * Compute the store patch to apply after `detectMovePairs` returns. Null means
 * the result matches current state, so no write is needed (and no downstream
 * re-renders are triggered).
 */
function movePairsPatch(
  result: { hunks: DiffHunk[]; pairs: MovePair[] },
  currentHunks: DiffHunk[],
  currentPairs: MovePair[],
): { hunks?: DiffHunk[]; movePairs: MovePair[] } | null {
  if (movePairsEqual(currentPairs, result.pairs)) return null;
  const annotationsDiffer = result.hunks.some((h, i) => {
    const cur = currentHunks[i];
    return !cur || cur.id !== h.id || cur.movePairId !== h.movePairId;
  });
  return annotationsDiffer
    ? { hunks: result.hunks, movePairs: result.pairs }
    : { movePairs: result.pairs };
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
  comparison: Comparison | null;
  currentBranch: string | null;
  files: FileEntry[];
  allFiles: FileEntry[];
  allFilesLoading: boolean;
  hunks: DiffHunk[];
  movePairs: MovePair[];
  loadingProgress: LoadingProgress | null;
  // Cached flattened file paths (computed when files change)
  flatFileList: string[];
  // Tracks which gitignored directories have been loaded
  loadedGitIgnoredDirs: Set<string>;
  /**
   * Per-path version counter. Incremented whenever the store observes a real
   * change to a file's hunks/content. Components subscribe to their own path's
   * entry for fine-grained invalidation (replaces the old global
   * `refreshGeneration` counter).
   */
  fileVersions: Record<string, number>;
  // True when viewing a standalone file (not in a git repo)
  isStandaloneFile: boolean;

  // Actions
  setRepoPath: (path: string | null) => void;
  setComparison: (comparison: Comparison | null) => void;
  /** Atomically set both repoPath and comparison in one update, preventing phantom review entries. */
  switchReview: (path: string, comparison: Comparison) => void;
  setFiles: (files: FileEntry[]) => void;
  setHunks: (hunks: DiffHunk[]) => void;
  /** Replace store hunks for a single file with fresh data from getFileContent */
  syncFileHunks: (filePath: string, freshHunks: DiffHunk[]) => void;
  /** Increment `fileVersions[path]` to signal observers that the file changed. */
  bumpFileVersion: (filePath: string) => void;

  // Loading
  loadFiles: (isRefreshing?: boolean) => Promise<void>;
  loadAllFiles: (isRefreshing?: boolean) => Promise<void>;
  /** Load all tracked files (no comparison needed, for browse mode) */
  loadRepoFiles: () => Promise<void>;
  /** Load the current branch name */
  loadCurrentBranch: () => Promise<void>;
  /** Load contents of a gitignored directory and merge into allFiles */
  loadDirectoryContents: (dirPath: string) => Promise<void>;
  /** Surgical refresh: bumps `fileVersions` only for paths with real hunk changes, leaving unchanged paths untouched. */
  refetchFileHunks: (paths: string[]) => Promise<void>;
  /**
   * Apply a working-tree watcher event's file-level impact. In browse mode
   * just bumps versions for changed paths; in review mode either surgically
   * refetches those paths, or falls back to a full `loadFiles` when any
   * changed path isn't tracked yet (added/deleted files).
   */
  applyFileWatcherEvent: (changedPaths: string[]) => Promise<void>;
}

/** State reset shared between comparison and repo switches. */
const comparisonResetState = {
  // Files
  files: [] as FileEntry[],
  allFiles: [] as FileEntry[],
  allFilesLoading: false,
  hunks: [] as DiffHunk[],
  movePairs: [] as MovePair[],
  flatFileList: [] as string[],
  loadingProgress: { phase: "pending" as const, current: 0, total: 0 },
  // Navigation
  changesViewMode: "files" as const,
  selectedFile: null,
  focusedHunkId: null,
  scrollTarget: null,
  guideContentMode: null,
  secondaryFile: null,
  focusedPane: "primary" as const,
  groupingSidebarOpen: false,
  workingTreeDiffFile: null,
  // Review
  reviewState: null,
  undoStack: [] as UndoEntry[],
  // History
  commits: [] as CommitEntry[],
  commitsLoaded: false,
  // Worktree
  worktreePath: null as string | null,
  worktreeStale: false,
  readOnlyPreview: false,
  // Other slices
  ...symbolsResetState,
  ...classificationResetState,
};

/** Additional state reset only needed when switching repositories. */
const repoResetState = {
  currentBranch: null as string | null,
  loadedGitIgnoredDirs: new Set<string>(),
  fileVersions: {} as Record<string, number>,
  isStandaloneFile: false,
  // Search
  searchQuery: "",
  searchResults: [] as SearchMatch[],
  searchLoading: false,
  searchError: null,
  // Git
  gitStatus: null,
  stagedFilePaths: EMPTY_STAGED_SET,
};

export const createFilesSlice: SliceCreatorWithClient<FilesSlice> =
  (client: ApiClient) => (set, get) => ({
    repoPath: null,
    comparison: null,
    currentBranch: null,
    files: [],
    allFiles: [],
    allFilesLoading: false,
    hunks: [],
    movePairs: [],
    loadingProgress: null,
    flatFileList: [],
    loadedGitIgnoredDirs: new Set<string>(),
    fileVersions: {},
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

    setComparison: (comparison) => {
      get().flushSidebarProgress();
      cancelPendingSaves();
      get().saveNavigationSnapshot();
      get().clearAllActivities();
      // Clear stale data and signal that new data is loading.
      set({
        comparison,
        ...comparisonResetState,
      });
    },

    switchReview: (path, comparison) => {
      get().flushSidebarProgress();
      cancelPendingSaves();
      get().saveNavigationSnapshot();
      get().clearAllActivities();

      // Atomic update: sets both repoPath and comparison together with the
      // union of resets from setRepoPath and setComparison, preventing the
      // intermediate state that caused phantom review entries.
      set({
        repoPath: path,
        comparison,
        ...comparisonResetState,
        ...repoResetState,
      });
    },

    setFiles: (files) => set({ files, flatFileList: flattenFiles(files) }),
    setHunks: (hunks) => set({ hunks }),
    bumpFileVersion: (filePath) => {
      const current = get().fileVersions;
      set({
        fileVersions: {
          ...current,
          [filePath]: (current[filePath] ?? 0) + 1,
        },
      });
    },
    syncFileHunks: (filePath, freshHunks) => {
      const { hunks } = get();
      if (hunkIdsForPathEqual(hunks, filePath, freshHunks)) return;

      // Remove old hunks for this file, insert the fresh ones in their place
      const firstIdx = hunks.findIndex((h) => h.filePath === filePath);
      const filtered = hunks.filter((h) => h.filePath !== filePath);
      const insertAt =
        firstIdx >= 0 ? Math.min(firstIdx, filtered.length) : filtered.length;
      const updated = [
        ...filtered.slice(0, insertAt),
        ...freshHunks,
        ...filtered.slice(insertAt),
      ];
      set({ hunks: updated });
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
        const githubPr = get().reviewState?.githubPr;
        const files = await client.listFiles(repoPath, comparison, githubPr);
        endActivity("load-files");
        if (isStale()) {
          set({ loadingProgress: null });
          return;
        }
        const flatFileList = flattenFiles(files);
        console.log(
          `[perf] Phase 1 (list files): ${(performance.now() - phase1Start).toFixed(0)}ms, ${flatFileList.length} files`,
        );

        // During refresh, defer set() to batch with hunks/movePairs at the end
        if (!isRefreshing) {
          set({ files, flatFileList });
        }

        // Collect changed file paths (filtering out likely binary/build artifacts)
        const changedPaths: string[] = [];
        let skippedCount = 0;
        const collectChangedPaths = (entries: FileEntry[]) => {
          for (const entry of entries) {
            if (
              entry.status &&
              !entry.isDirectory &&
              ["added", "modified", "deleted", "renamed", "untracked"].includes(
                entry.status,
              )
            ) {
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
                  githubPr,
                );
                allHunks.push(...content.hunks);
              } catch {
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
                githubPr,
              );
              allHunks.push(...content.hunks);
            } catch (err) {
              failedFiles.push(filePath);
            }
          }
        }

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

        if (isStale()) {
          set({ loadingProgress: null });
          return;
        }

        // Commit results with idempotent writes:
        //   - Skip the file-tree write if structure is unchanged.
        //   - Skip the hunks write if global hunk IDs are unchanged.
        //   - Only bump `fileVersions[path]` for paths whose per-file hunk IDs
        //     actually changed — unchanged files' viewers stay put.
        //   - Don't blank movePairs; the background detectMovePairs below
        //     updates them only if they differ.
        const prev = get();
        const changedFilePaths = diffChangedPaths(prev.hunks, allHunks);
        const structureChanged = !filesStructureEqual(prev.files, files);
        const hunksChanged = changedFilePaths.length > 0;

        if (structureChanged || hunksChanged) {
          const nextVersions = hunksChanged
            ? (() => {
                const v = { ...prev.fileVersions };
                for (const p of changedFilePaths) {
                  v[p] = (v[p] ?? 0) + 1;
                }
                return v;
              })()
            : prev.fileVersions;

          set({
            ...(structureChanged ? { files, flatFileList } : {}),
            ...(hunksChanged ? { hunks: allHunks } : {}),
            ...(hunksChanged ? { fileVersions: nextVersions } : {}),
          });
        }

        // Clear progress
        if (!isRefreshing) {
          set({ loadingProgress: null });
        }

        console.log(
          `[perf] Total loadFiles: ${(performance.now() - loadStart).toFixed(0)}ms`,
        );

        // Fire-and-forget: detect move pairs in background. Only commit the
        // result if pair tuples actually changed, so the UI doesn't flash.
        const phase3Start = performance.now();
        client
          .detectMovePairs(allHunks)
          .then((result) => {
            if (isStale()) return;
            const { hunks: curHunks, movePairs: curPairs } = get();
            const patch = movePairsPatch(result, curHunks, curPairs);
            if (patch) set(patch);
            console.log(
              `[perf] Phase 3 (move detection, background): ${(performance.now() - phase3Start).toFixed(0)}ms`,
            );
          })
          .catch((err) => {
            console.error("Failed to detect move pairs:", err);
          });
      } catch (err) {
        console.error("Failed to load files:", err);
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

      const comparisonKey = comparison.key;
      if (!isRefreshing) {
        set({ allFilesLoading: true });
      }
      try {
        const allFiles = await client.listAllFiles(repoPath, comparison);
        if (get().comparison?.key !== comparisonKey) {
          set({ allFilesLoading: false });
          return;
        }
        set({ allFiles, allFilesLoading: false });
      } catch (err) {
        console.error("Failed to load all files:", err);
        set({ allFilesLoading: false });
      }
    },

    loadRepoFiles: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      set({ allFilesLoading: true });
      try {
        const allFiles = await client.listRepoFiles(repoPath);
        // Don't update if repo changed while loading
        if (get().repoPath !== repoPath) {
          set({ allFilesLoading: false });
          return;
        }
        set({ allFiles, allFilesLoading: false });
      } catch (err) {
        console.error("Failed to load repo files:", err);
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
      } catch {
        // Ignore — not critical
      }
    },

    loadDirectoryContents: async (dirPath: string) => {
      const { repoPath, allFiles, loadedGitIgnoredDirs } = get();
      if (!repoPath) return;

      // Skip if already loaded
      if (loadedGitIgnoredDirs.has(dirPath)) return;

      try {
        const contents = await client.listDirectoryContents(repoPath, dirPath);

        // Mark as loaded
        const newLoadedDirs = new Set(loadedGitIgnoredDirs);
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

        const updatedAllFiles = mergeIntoTree(allFiles, dirPath, contents);
        set({ allFiles: updatedAllFiles, loadedGitIgnoredDirs: newLoadedDirs });
      } catch (err) {
        console.error(`Failed to load directory contents for ${dirPath}:`, err);
      }
    },

    refetchFileHunks: async (paths: string[]) => {
      const { repoPath, comparison, reviewState } = get();
      if (!repoPath || !comparison || paths.length === 0) return;

      const githubPr = reviewState?.githubPr;
      const comparisonKey = comparison.key;
      const isStale = () => get().comparison?.key !== comparisonKey;

      // Filter out binary/build artifacts we never diff.
      const filtered = paths.filter((p) => !shouldSkipFile(p));
      if (filtered.length === 0) return;

      // Fetch all paths in parallel. For each, compare observed hunk IDs
      // against the store — if identical, no writes; otherwise splice via
      // syncFileHunks and bump that path's version counter.
      await Promise.all(
        filtered.map(async (path) => {
          try {
            const content = await client.getFileContent(
              repoPath,
              path,
              comparison,
              githubPr,
            );
            if (isStale()) return;

            const { hunks, syncFileHunks, bumpFileVersion } = get();
            if (hunkIdsForPathEqual(hunks, path, content.hunks)) return;

            syncFileHunks(path, content.hunks);
            bumpFileVersion(path);
          } catch (err) {
            console.warn(`[refetchFileHunks] failed for ${path}:`, err);
          }
        }),
      );

      if (isStale()) return;

      // Same background move-pair refresh as `loadFiles` — idempotent via
      // `movePairsPatch` so no-op results don't trigger re-renders.
      client
        .detectMovePairs(get().hunks)
        .then((result) => {
          if (isStale()) return;
          const { hunks: curHunks, movePairs: curPairs } = get();
          const patch = movePairsPatch(result, curHunks, curPairs);
          if (patch) set(patch);
        })
        .catch((err) => {
          console.error("Failed to detect move pairs:", err);
        });
    },

    applyFileWatcherEvent: async (changedPaths) => {
      const {
        comparison,
        flatFileList,
        refetchFileHunks,
        loadFiles,
        loadAllFiles,
        bumpFileVersion,
      } = get();

      // Browse mode (no comparison, no hunks): bump per-path versions so any
      // viewer observing one of these files refetches its raw content.
      if (!comparison) {
        for (const path of changedPaths) bumpFileVersion(path);
        return;
      }

      // If any changed path isn't in the current tree, it's a new/deleted file
      // — fall back to a full listFiles + hunk reload. The idempotent writes
      // in `loadFiles` keep unchanged rows stable.
      const known = new Set(flatFileList);
      if (changedPaths.some((p) => !known.has(p))) {
        await Promise.all([loadFiles(true), loadAllFiles(true)]);
      } else {
        await refetchFileHunks(changedPaths);
      }
    },
  });
