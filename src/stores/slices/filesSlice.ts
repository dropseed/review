import type { ApiClient } from "../../api";
import type { Comparison, FileEntry, DiffHunk, MovePair } from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { flattenFiles } from "../types";
import { makeComparison } from "../../types";

// Default comparison: main..HEAD with working tree changes
const defaultComparison: Comparison = makeComparison("main", "HEAD", true);

// ========================================================================
// Skip Patterns
// ========================================================================
//
// IMPORTANT: These patterns MUST stay in sync with the Rust implementation
// in compare/src/filters.rs. The patterns filter out build artifacts and
// other files that aren't useful to review.
//
// Note: The API client has an async `shouldSkipFile()` method that calls
// the Rust implementation. However, we use a synchronous version here
// because it's called in a tight loop during file collection. The patterns
// are identical in both implementations.
//
// ========================================================================

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
  phase: "pending" | "files" | "hunks" | "moves";
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
  setFiles: (files: FileEntry[]) => void;
  setHunks: (hunks: DiffHunk[]) => void;

  // Loading
  loadFiles: (isRefreshing?: boolean) => Promise<void>;
  loadAllFiles: () => Promise<void>;
  /** Load contents of a gitignored directory and merge into allFiles */
  loadDirectoryContents: (dirPath: string) => Promise<void>;
}

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

      get().clearAllActivities();

      // Reset all per-repo state when switching repositories.
      // Since all slices share one Zustand store, we can reset cross-slice
      // state here to prevent stale data from the previous repo.
      set({
        repoPath: path,
        // Files
        files: [],
        allFiles: [],
        hunks: [],
        movePairs: [],
        flatFileList: [],
        loadingProgress: { phase: "pending", current: 0, total: 0 },
        loadedGitIgnoredDirs: new Set<string>(),
        refreshGeneration: 0,
        // Navigation
        selectedFile: null,
        focusedHunkIndex: 0,
        topLevelView: "browse",
        secondaryFile: null,
        focusedPane: "primary",
        groupingSidebarOpen: false,
        // Search
        searchQuery: "",
        searchResults: [],
        searchLoading: false,
        searchError: null,
        scrollToLine: null,
        // Classification
        classifying: false,
        classificationError: null,
        classifyingHunkIds: new Set<string>(),
        classifyGeneration: get().classifyGeneration + 1,
        // Review
        reviewState: null,
        // Undo
        undoStack: [],
        // Git
        gitStatus: null,
        stagedFilePaths: new Set<string>(),
        // History
        commits: [],
        commitsLoaded: false,
        // Symbols
        symbolDiffs: [],
        symbolsLoading: false,
        symbolsLoaded: false,
      });
    },

    setComparison: (comparison) => {
      get().clearAllActivities();
      // Clear stale data and signal that new data is loading.
      set({
        comparison,
        files: [],
        flatFileList: [],
        hunks: [],
        movePairs: [],
        allFiles: [],
        loadingProgress: { phase: "pending", current: 0, total: 0 },
        // Navigation — reset to browse on comparison switch
        selectedFile: null,
        focusedHunkIndex: 0,
        topLevelView: "browse",
        secondaryFile: null,
        focusedPane: "primary",
        groupingSidebarOpen: false,
        // Review
        reviewState: null,
        undoStack: [],
        // Symbols — reset loading guards so new load isn't blocked
        symbolsLoading: false,
        symbolsLoaded: false,
        symbolDiffs: [],
        symbolLinkedHunks: new Map(),
        // All files — reset loading guard
        allFilesLoading: false,
        // Grouping — reset loading guard and stale data
        groupingLoading: false,
        reviewGroups: [],
        identicalHunkIds: new Map(),
        // AI state — clear cached results and progress indicators
        guideSummary: null,
        guideSummaryError: null,
        classifiedHunkIds: null,
        classificationStatus: "idle" as const,
        groupingStatus: "idle" as const,
        summaryStatus: "idle" as const,
      });
    },

    setFiles: (files) => set({ files, flatFileList: flattenFiles(files) }),
    setHunks: (hunks) => set({ hunks }),

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
        const files = await client.listFiles(repoPath, comparison);
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

        // Phase 3: Detect move pairs
        const phase3Start = performance.now();
        if (!isRefreshing) {
          set({ loadingProgress: { current: 0, total: 1, phase: "moves" } });
        }
        startActivity("detect-moves", "Detecting moves", 35);
        try {
          const result = await client.detectMovePairs(allHunks);
          if (isStale()) {
            set({ loadingProgress: null });
            return;
          }
          if (isRefreshing) {
            // Single batched update: files + hunks + movePairs together
            set({
              files,
              flatFileList,
              hunks: result.hunks,
              movePairs: result.pairs,
            });
          } else {
            set({ hunks: result.hunks, movePairs: result.pairs });
          }
        } catch (err) {
          console.error("Failed to detect move pairs:", err);
          if (isRefreshing) {
            set({ files, flatFileList, hunks: allHunks, movePairs: [] });
          } else {
            set({ hunks: allHunks, movePairs: [] });
          }
        }
        endActivity("detect-moves");
        console.log(
          `[perf] Phase 3 (move detection): ${(performance.now() - phase3Start).toFixed(0)}ms`,
        );

        // Clear progress
        if (!isRefreshing) {
          set({ loadingProgress: null });
        }

        console.log(
          `[perf] Total loadFiles: ${(performance.now() - loadStart).toFixed(0)}ms`,
        );
      } catch (err) {
        console.error("Failed to load files:", err);
        // Clean up any activities that may have been started but not ended
        endActivity("load-files");
        endActivity("load-hunks");
        endActivity("detect-moves");
        if (!isRefreshing) {
          set({ loadingProgress: null });
        }
      }
    },

    loadAllFiles: async () => {
      const { repoPath, comparison } = get();
      if (!repoPath) return;

      const comparisonKey = comparison.key;
      set({ allFilesLoading: true });
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
