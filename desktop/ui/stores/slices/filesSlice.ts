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
import { flattenFiles } from "../types";
import { makeComparison } from "../../types";
import type { UndoEntry } from "./undoSlice";
import { groupingResetState } from "./groupingSlice";
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

// Default comparison: main..HEAD
const defaultComparison: Comparison = makeComparison("main", "HEAD");

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
function shouldSkipFile(path: string): boolean {
  return SKIP_PATTERNS.some((pattern) => pattern.test(path));
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
  comparison: Comparison;
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
  // Incremented on each refresh() to trigger re-fetches in components
  refreshGeneration: number;

  // Actions
  setRepoPath: (path: string | null) => void;
  setComparison: (comparison: Comparison) => void;
  /** Atomically set both repoPath and comparison in one update, preventing phantom review entries. */
  switchReview: (path: string, comparison: Comparison) => void;
  setFiles: (files: FileEntry[]) => void;
  setHunks: (hunks: DiffHunk[]) => void;
  /** Replace store hunks for a single file with fresh data from getFileContent */
  syncFileHunks: (filePath: string, freshHunks: DiffHunk[]) => void;

  // Loading
  loadFiles: (isRefreshing?: boolean) => Promise<void>;
  loadAllFiles: (isRefreshing?: boolean) => Promise<void>;
  /** Load contents of a gitignored directory and merge into allFiles */
  loadDirectoryContents: (dirPath: string) => Promise<void>;
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
  selectedFile: null,
  focusedHunkIndex: 0,
  guideContentMode: null,
  secondaryFile: null,
  focusedPane: "primary" as const,
  groupingSidebarOpen: false,
  workingTreeDiffFile: null,
  // Review
  reviewState: null,
  undoStack: [] as UndoEntry[],
  // Other slices
  ...symbolsResetState,
  ...groupingResetState,
  ...classificationResetState,
};

/** Additional state reset only needed when switching repositories. */
const repoResetState = {
  loadedGitIgnoredDirs: new Set<string>(),
  refreshGeneration: 0,
  // Search
  searchQuery: "",
  searchResults: [] as SearchMatch[],
  searchLoading: false,
  searchError: null,
  scrollToLine: null,
  // Git
  gitStatus: null,
  stagedFilePaths: EMPTY_STAGED_SET,
  // History
  commits: [] as CommitEntry[],
  commitsLoaded: false,
};

export const createFilesSlice: SliceCreatorWithClient<FilesSlice> =
  (client: ApiClient) => (set, get) => ({
    repoPath: null,
    comparison: defaultComparison,
    files: [],
    allFiles: [],
    allFilesLoading: false,
    hunks: [],
    movePairs: [],
    loadingProgress: null,
    flatFileList: [],
    loadedGitIgnoredDirs: new Set<string>(),
    refreshGeneration: 0,

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
      cancelPendingSaves();
      get().clearAllActivities();
      // Clear stale data and signal that new data is loading.
      set({
        comparison,
        ...comparisonResetState,
      });
    },

    switchReview: (path, comparison) => {
      cancelPendingSaves();
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
    syncFileHunks: (filePath, freshHunks) => {
      const { hunks } = get();

      // Fast path: skip update if hunk IDs already match
      const existingIds = hunks
        .filter((h) => h.filePath === filePath)
        .map((h) => h.id);
      const freshIds = freshHunks.map((h) => h.id);
      if (
        existingIds.length === freshIds.length &&
        existingIds.every((id, i) => id === freshIds[i])
      ) {
        return;
      }

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
      if (!repoPath) return;

      // Capture comparison key so we can detect if the user switched
      // comparisons while this async operation was in-flight.
      const comparisonKey = comparison.key;
      const isStale = () => get().comparison.key !== comparisonKey;

      // Clear symbols so they reload when the Symbols tab is next opened
      clearSymbols();

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

        // Set hunks immediately so the UI becomes interactive
        if (isRefreshing) {
          set({ files, flatFileList, hunks: allHunks, movePairs: [] });
        } else {
          set({ hunks: allHunks, movePairs: [] });
        }

        // Clear progress
        if (!isRefreshing) {
          set({ loadingProgress: null });
        }

        console.log(
          `[perf] Total loadFiles: ${(performance.now() - loadStart).toFixed(0)}ms`,
        );

        // Fire-and-forget: detect move pairs in background
        const phase3Start = performance.now();
        client
          .detectMovePairs(allHunks)
          .then((result) => {
            if (!isStale()) {
              set({ hunks: result.hunks, movePairs: result.pairs });
            }
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
      if (!repoPath) return;

      const comparisonKey = comparison.key;
      if (!isRefreshing) {
        set({ allFilesLoading: true });
      }
      try {
        const allFiles = await client.listAllFiles(repoPath, comparison);
        if (get().comparison.key !== comparisonKey) {
          set({ allFilesLoading: false });
          return;
        }
        set({ allFiles, allFilesLoading: false });
      } catch (err) {
        console.error("Failed to load all files:", err);
        set({ allFilesLoading: false });
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
  });
