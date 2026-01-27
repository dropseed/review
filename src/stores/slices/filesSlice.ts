import type { ApiClient } from "../../api";
import type {
  SliceCreatorWithClient,
  Comparison,
  FileEntry,
  DiffHunk,
  MovePair,
} from "../types";
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

export interface LoadingProgress {
  current: number;
  total: number;
  phase: "files" | "hunks" | "moves";
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

  // Actions
  setRepoPath: (path: string) => void;
  setComparison: (comparison: Comparison) => void;
  setFiles: (files: FileEntry[]) => void;
  setHunks: (hunks: DiffHunk[]) => void;

  // Loading
  loadFiles: (skipAutoClassify?: boolean) => Promise<void>;
  loadAllFiles: () => Promise<void>;
  loadCurrentComparison: () => Promise<void>;
  saveCurrentComparison: () => Promise<void>;
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

    setRepoPath: (path) => set({ repoPath: path }),

    setComparison: (comparison) => {
      set({ comparison });
      get().saveCurrentComparison();
      get().loadReviewState();
    },

    setFiles: (files) => set({ files, flatFileList: flattenFiles(files) }),
    setHunks: (hunks) => set({ hunks }),

    loadFiles: async (skipAutoClassify = false) => {
      const { repoPath, comparison, triggerAutoClassification } = get();
      if (!repoPath) return;

      try {
        // Phase 1: Get file list
        set({ loadingProgress: { current: 0, total: 1, phase: "files" } });
        const files = await client.listFiles(repoPath, comparison);
        set({ files, flatFileList: flattenFiles(files) });

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

        // Phase 2: Load hunks for each changed file
        const allHunks: DiffHunk[] = [];
        const failedFiles: string[] = [];
        const total = changedPaths.length;
        for (let i = 0; i < changedPaths.length; i++) {
          const filePath = changedPaths[i];
          set({ loadingProgress: { current: i + 1, total, phase: "hunks" } });

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

        // Phase 3: Detect move pairs
        set({ loadingProgress: { current: 0, total: 1, phase: "moves" } });
        try {
          const result = await client.detectMovePairs(allHunks);
          set({ hunks: result.hunks, movePairs: result.pairs });
        } catch (err) {
          console.error("Failed to detect move pairs:", err);
          set({ hunks: allHunks, movePairs: [] });
        }

        // Clear progress
        set({ loadingProgress: null });

        // Trigger auto-classification after files are loaded
        if (!skipAutoClassify) {
          triggerAutoClassification();
        }
      } catch (err) {
        console.error("Failed to load files:", err);
        set({ loadingProgress: null });
      }
    },

    loadAllFiles: async () => {
      const { repoPath, comparison } = get();
      if (!repoPath) return;

      set({ allFilesLoading: true });
      try {
        const allFiles = await client.listAllFiles(repoPath, comparison);
        set({ allFiles, allFilesLoading: false });
      } catch (err) {
        console.error("Failed to load all files:", err);
        set({ allFilesLoading: false });
      }
    },

    loadCurrentComparison: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      try {
        const savedComparison = await client.getCurrentComparison(repoPath);
        if (savedComparison) {
          set({ comparison: savedComparison });
        } else {
          try {
            const [defaultBranch, currentBranch] = await Promise.all([
              client.getDefaultBranch(repoPath),
              client.getCurrentBranch(repoPath),
            ]);
            // Use resolved branch name instead of "HEAD" so each branch gets its own review state
            const newComparison = makeComparison(
              defaultBranch,
              currentBranch,
              true,
            );
            set({ comparison: newComparison });
          } catch {
            set({ comparison: defaultComparison });
          }
        }
      } catch (err) {
        console.error("Failed to load current comparison:", err);
      }
    },

    saveCurrentComparison: async () => {
      const { repoPath, comparison } = get();
      if (!repoPath) return;

      try {
        await client.setCurrentComparison(repoPath, comparison);
      } catch (err) {
        console.error("Failed to save current comparison:", err);
      }
    },
  });
