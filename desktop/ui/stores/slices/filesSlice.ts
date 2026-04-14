import type { ApiClient } from "../../api";
import type {
  Comparison,
  FileEntry,
  DiffHunk,
  FileDiff,
  MovePair,
  SearchMatch,
  CommitEntry,
} from "../../types";
import { buildFileDiff } from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { flattenFiles } from "../types";
import { getAllHunksFromState } from "../selectors/hunks";
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
 * Replace hunks with new move-pair annotations. detectMovePairs returns the
 * full set of hunks with `movePairId` set on paired entries. We regroup by
 * file path so `filesByPath` gains the annotations.
 */
function applyMovePairAnnotations(
  annotated: DiffHunk[],
  prevFilesByPath: Record<string, FileDiff>,
): Record<string, FileDiff> {
  const nextByPath: Record<string, DiffHunk[]> = {};
  for (const h of annotated) {
    (nextByPath[h.filePath] ??= []).push(h);
  }
  const next: Record<string, FileDiff> = { ...prevFilesByPath };
  for (const [path, pathHunks] of Object.entries(nextByPath)) {
    next[path] = buildFileDiff(pathHunks);
  }
  return next;
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
  comparison: Comparison | null;
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
  setComparison: (comparison: Comparison | null) => void;
  /** Atomically set both repoPath and comparison in one update, preventing phantom review entries. */
  switchReview: (path: string, comparison: Comparison) => void;
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
  /** Surgical refresh: rewrites `filesByPath` for the given paths in one set(). */
  refetchFileHunks: (paths: string[]) => Promise<void>;
  /**
   * Apply a working-tree watcher event's file-level impact. In browse mode
   * just triggers a re-fetch for any open viewer; in review mode either
   * surgically refetches those paths, or falls back to a full `loadFiles`
   * when any changed path isn't tracked yet (added/deleted files).
   */
  applyFileWatcherEvent: (changedPaths: string[]) => Promise<void>;
}

/** State reset shared between comparison and repo switches. */
const comparisonResetState = {
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

        // During refresh, defer set() to batch with hunks at the end
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

        // Fire-and-forget: detect move pairs in background. Only re-run when
        // file contents actually changed; on no-op refreshes, skip the
        // Rust IPC round trip entirely.
        if (anyFileChanged) {
          const phase3Start = performance.now();
          client
            .detectMovePairs(allHunks)
            .then((result) => {
              if (isStale()) return;
              if (!movePairsChanged(get().movePairs, result.pairs)) return;
              set({
                filesByPath: applyMovePairAnnotations(
                  result.hunks,
                  get().filesByPath,
                ),
                movePairs: result.pairs,
              });
              console.log(
                `[perf] Phase 3 (move detection, background): ${(performance.now() - phase3Start).toFixed(0)}ms`,
              );
            })
            .catch((err) => {
              console.error("Failed to detect move pairs:", err);
            });
        }
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

      // Fetch all paths in parallel, then write in one batched set().
      const results = await Promise.all(
        filtered.map(async (path) => {
          try {
            const content = await client.getFileContent(
              repoPath,
              path,
              comparison,
              githubPr,
            );
            return { path, diff: buildFileDiff(content.hunks) };
          } catch (err) {
            console.warn(`[refetchFileHunks] failed for ${path}:`, err);
            return null;
          }
        }),
      );

      if (isStale()) return;

      const prev = get();
      let anyChanged = false;
      const nextFilesByPath = { ...prev.filesByPath };
      for (const r of results) {
        if (!r) continue;
        const existing = nextFilesByPath[r.path];
        if (existing && existing.contentHash === r.diff.contentHash) continue;
        nextFilesByPath[r.path] = r.diff;
        anyChanged = true;
      }

      if (!anyChanged) return;

      set({ filesByPath: nextFilesByPath });

      // Defer the IPC so the save-induced render completes first.
      setTimeout(() => {
        if (isStale()) return;
        client
          .detectMovePairs(getAllHunksFromState(get()))
          .then((result) => {
            if (isStale()) return;
            if (!movePairsChanged(get().movePairs, result.pairs)) return;
            set({
              filesByPath: applyMovePairAnnotations(
                result.hunks,
                get().filesByPath,
              ),
              movePairs: result.pairs,
            });
          })
          .catch((err) => {
            console.error("Failed to detect move pairs:", err);
          });
      }, 0);
    },

    applyFileWatcherEvent: async (changedPaths) => {
      const {
        comparison,
        flatFileList,
        refetchFileHunks,
        loadFiles,
        loadAllFiles,
      } = get();

      // Browse mode: no diff to invalidate, so bump per-path versions in one
      // set() — raw-content viewers refetch via their fileVersion subscription.
      if (!comparison) {
        if (changedPaths.length === 0) return;
        const prev = get().fileVersions;
        const next = { ...prev };
        for (const path of changedPaths) {
          next[path] = (next[path] ?? 0) + 1;
        }
        set({ fileVersions: next });
        return;
      }

      // Review mode: `filesByPath[path]` reference change invalidates viewers
      // directly. If any changed path is new/deleted, fall back to a full
      // listFiles + hunk reload; otherwise surgically refetch.
      const known = new Set(flatFileList);
      if (changedPaths.some((p) => !known.has(p))) {
        await Promise.all([loadFiles(true), loadAllFiles(true)]);
      } else {
        await refetchFileHunks(changedPaths);
      }
    },
  });
