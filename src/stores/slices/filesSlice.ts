import { invoke } from "@tauri-apps/api/core";
import type {
  SliceCreator,
  Comparison,
  FileEntry,
  DiffHunk,
  MovePair,
} from "../types";
import { makeComparison } from "../../types";

interface DetectMovePairsResponse {
  pairs: MovePair[];
  hunks: DiffHunk[];
}

// Default comparison: main..HEAD with working tree changes
const defaultComparison: Comparison = makeComparison("main", "HEAD", true);

export interface FilesSlice {
  // Core state
  repoPath: string | null;
  comparison: Comparison;
  files: FileEntry[];
  allFiles: FileEntry[];
  allFilesLoading: boolean;
  hunks: DiffHunk[];
  movePairs: MovePair[];

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

export const createFilesSlice: SliceCreator<FilesSlice> = (set, get) => ({
  repoPath: null,
  comparison: defaultComparison,
  files: [],
  allFiles: [],
  allFilesLoading: false,
  hunks: [],
  movePairs: [],

  setRepoPath: (path) => set({ repoPath: path }),

  setComparison: (comparison) => {
    set({ comparison });
    get().saveCurrentComparison();
    get().loadReviewState();
  },

  setFiles: (files) => set({ files }),
  setHunks: (hunks) => set({ hunks }),

  loadFiles: async (skipAutoClassify = false) => {
    const { repoPath, comparison, triggerAutoClassification } = get();
    if (!repoPath) return;

    try {
      const files = await invoke<FileEntry[]>("list_files", {
        repoPath,
        comparison,
      });
      set({ files });

      // Collect changed file paths
      const changedPaths: string[] = [];
      const collectChangedPaths = (entries: FileEntry[]) => {
        for (const entry of entries) {
          if (
            entry.status &&
            !entry.isDirectory &&
            ["added", "modified", "deleted", "renamed", "untracked"].includes(
              entry.status,
            )
          ) {
            changedPaths.push(entry.path);
          }
          if (entry.children) {
            collectChangedPaths(entry.children);
          }
        }
      };
      collectChangedPaths(files);

      // Load hunks for each changed file
      const allHunks: DiffHunk[] = [];
      for (const filePath of changedPaths) {
        try {
          const content = await invoke<{ hunks: DiffHunk[] }>(
            "get_file_content",
            {
              repoPath,
              filePath,
              comparison,
            },
          );
          allHunks.push(...content.hunks);
        } catch (err) {
          console.error(`Failed to load hunks for ${filePath}:`, err);
        }
      }

      // Detect move pairs
      try {
        const result = await invoke<DetectMovePairsResponse>(
          "detect_hunks_move_pairs",
          { hunks: allHunks },
        );
        set({ hunks: result.hunks, movePairs: result.pairs });
      } catch (err) {
        console.error("Failed to detect move pairs:", err);
        set({ hunks: allHunks, movePairs: [] });
      }

      // Trigger auto-classification after files are loaded
      if (!skipAutoClassify) {
        triggerAutoClassification();
      }
    } catch (err) {
      console.error("Failed to load files:", err);
    }
  },

  loadAllFiles: async () => {
    const { repoPath, comparison } = get();
    if (!repoPath) return;

    set({ allFilesLoading: true });
    try {
      const allFiles = await invoke<FileEntry[]>("list_all_files", {
        repoPath,
        comparison,
      });
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
      const savedComparison = await invoke<Comparison | null>(
        "get_current_comparison",
        { repoPath },
      );
      if (savedComparison) {
        set({ comparison: savedComparison });
      } else {
        try {
          const [defaultBranch, currentBranch] = await Promise.all([
            invoke<string>("get_default_branch", { repoPath }),
            invoke<string>("get_current_branch", { repoPath }),
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
      await invoke("set_current_comparison", { repoPath, comparison });
    } catch (err) {
      console.error("Failed to save current comparison:", err);
    }
  },
});
