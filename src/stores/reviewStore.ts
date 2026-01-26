import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type {
  Comparison,
  FileEntry,
  DiffHunk,
  ReviewState,
  ClassifyResponse,
  MovePair,
  RejectionFeedback,
} from "../types";
import { makeComparison } from "../types";
import {
  anyLabelMatchesAnyPattern,
  anyLabelMatchesPattern,
} from "../utils/matching";
import { getPreference, setPreference } from "../utils/preferences";

interface DetectMovePairsResponse {
  pairs: MovePair[];
  hunks: DiffHunk[];
}

interface ReviewStore {
  // Current state
  repoPath: string | null;
  comparison: Comparison;
  selectedFile: string | null;
  files: FileEntry[];
  allFiles: FileEntry[];
  allFilesLoading: boolean;
  hunks: DiffHunk[];
  movePairs: MovePair[];
  reviewState: ReviewState | null;
  focusedHunkIndex: number;

  // UI settings
  sidebarPosition: "left" | "right";
  fileToReveal: string | null; // File path to reveal in tree

  // Classification state
  claudeAvailable: boolean | null;
  classifying: boolean;
  classificationError: string | null;

  // Actions
  setRepoPath: (path: string) => void;
  setComparison: (comparison: Comparison) => void;
  setSelectedFile: (path: string | null) => void;
  setFiles: (files: FileEntry[]) => void;
  setHunks: (hunks: DiffHunk[]) => void;
  setReviewState: (state: ReviewState) => void;

  // Navigation
  nextFile: () => void;
  prevFile: () => void;
  nextHunk: () => void;
  prevHunk: () => void;

  // Persistence
  loadFiles: () => Promise<void>;
  loadAllFiles: () => Promise<void>;
  loadReviewState: () => Promise<void>;
  saveReviewState: () => Promise<void>;
  loadCurrentComparison: () => Promise<void>;
  saveCurrentComparison: () => Promise<void>;

  // Hunk actions
  approveHunk: (hunkId: string, via: "manual" | "trust") => void;
  unapproveHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string, notes?: string) => void;
  unrejectHunk: (hunkId: string) => void;
  approveAllFileHunks: (filePath: string) => void;
  unapproveAllFileHunks: (filePath: string) => void;
  setHunkNotes: (hunkId: string, notes: string) => void;
  setHunkLabel: (hunkId: string, label: string | string[]) => void;

  // Feedback export
  exportRejectionFeedback: () => RejectionFeedback | null;

  // Review notes
  setReviewNotes: (notes: string) => void;

  // Trust list actions
  addTrustPattern: (pattern: string) => void;
  removeTrustPattern: (pattern: string) => void;

  // UI settings actions
  setSidebarPosition: (position: "left" | "right") => void;
  loadPreferences: () => Promise<void>;
  revealFileInTree: (path: string) => void;
  clearFileToReveal: () => void;

  // Classification
  checkClaudeAvailable: () => Promise<void>;
  classifyUnlabeledHunks: () => Promise<void>;

  // Complete review
  completeReview: () => void;

  // Refresh all data
  refresh: () => Promise<void>;
}

// Default comparison: main..HEAD with working tree changes
const defaultComparison: Comparison = makeComparison("main", "HEAD", true);

// Debounce save operations
// Using a ref-like pattern that works with Zustand
const createDebouncedSave = () => {
  let saveTimeout: ReturnType<typeof setTimeout> | null = null;
  return (saveFn: () => Promise<void>) => {
    if (saveTimeout) {
      clearTimeout(saveTimeout);
    }
    saveTimeout = setTimeout(() => {
      saveFn().catch((err) =>
        console.error("Failed to save review state:", err),
      );
    }, 500);
  };
};
const debouncedSave = createDebouncedSave();

// Helper to get all files flattened from tree
function flattenFiles(entries: FileEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory && entry.children) {
      result.push(...flattenFiles(entry.children));
    } else if (!entry.isDirectory) {
      result.push(entry.path);
    }
  }
  return result;
}

export const useReviewStore = create<ReviewStore>((set, get) => ({
  repoPath: null,
  comparison: defaultComparison,
  selectedFile: null,
  files: [],
  allFiles: [],
  allFilesLoading: false,
  hunks: [],
  movePairs: [],
  reviewState: null,
  focusedHunkIndex: 0,
  sidebarPosition: "left",
  fileToReveal: null,
  claudeAvailable: null,
  classifying: false,
  classificationError: null,

  setRepoPath: (path) => set({ repoPath: path }),

  setComparison: (comparison) => {
    set({ comparison });
    // Persist the current comparison
    get().saveCurrentComparison();
    // Load review state for new comparison
    get().loadReviewState();
  },

  setSelectedFile: (path) => set({ selectedFile: path, focusedHunkIndex: 0 }),
  setFiles: (files) => set({ files }),
  setHunks: (hunks) => set({ hunks }),
  setReviewState: (state) => set({ reviewState: state }),

  nextFile: () => {
    const { files, selectedFile } = get();
    const flatFiles = flattenFiles(files);
    if (flatFiles.length === 0) return;

    if (!selectedFile) {
      set({ selectedFile: flatFiles[0], focusedHunkIndex: 0 });
      return;
    }

    const currentIndex = flatFiles.indexOf(selectedFile);
    const nextIndex = (currentIndex + 1) % flatFiles.length;
    set({ selectedFile: flatFiles[nextIndex], focusedHunkIndex: 0 });
  },

  prevFile: () => {
    const { files, selectedFile } = get();
    const flatFiles = flattenFiles(files);
    if (flatFiles.length === 0) return;

    if (!selectedFile) {
      set({
        selectedFile: flatFiles[flatFiles.length - 1],
        focusedHunkIndex: 0,
      });
      return;
    }

    const currentIndex = flatFiles.indexOf(selectedFile);
    const prevIndex =
      currentIndex <= 0 ? flatFiles.length - 1 : currentIndex - 1;
    set({ selectedFile: flatFiles[prevIndex], focusedHunkIndex: 0 });
  },

  nextHunk: () => {
    const { hunks, focusedHunkIndex } = get();
    if (hunks.length === 0) return;
    const nextIndex = Math.min(focusedHunkIndex + 1, hunks.length - 1);
    set({ focusedHunkIndex: nextIndex });
  },

  prevHunk: () => {
    const { focusedHunkIndex } = get();
    const prevIndex = Math.max(focusedHunkIndex - 1, 0);
    set({ focusedHunkIndex: prevIndex });
  },

  loadFiles: async () => {
    const { repoPath, comparison } = get();
    if (!repoPath) return;

    try {
      const files = await invoke<FileEntry[]>("list_files", {
        repoPath,
        comparison,
      });
      set({ files });

      // Load hunks for all changed files
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

      // Detect move pairs across all hunks
      try {
        const result = await invoke<DetectMovePairsResponse>(
          "detect_hunks_move_pairs",
          {
            hunks: allHunks,
          },
        );
        set({ hunks: result.hunks, movePairs: result.pairs });
      } catch (err) {
        console.error("Failed to detect move pairs:", err);
        set({ hunks: allHunks, movePairs: [] });
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

  loadReviewState: async () => {
    const { repoPath, comparison } = get();
    if (!repoPath) return;

    try {
      const state = await invoke<ReviewState>("load_review_state", {
        repoPath,
        comparison,
      });
      set({ reviewState: state });
    } catch (err) {
      console.error("Failed to load review state:", err);
      // Create a new empty state
      set({
        reviewState: {
          comparison,
          hunks: {},
          trustList: [],
          notes: "",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    }
  },

  saveReviewState: async () => {
    const { repoPath, reviewState } = get();
    if (!repoPath || !reviewState) return;

    try {
      await invoke("save_review_state", {
        repoPath,
        state: reviewState,
      });
    } catch (err) {
      console.error("Failed to save review state:", err);
    }
  },

  loadCurrentComparison: async () => {
    const { repoPath } = get();
    if (!repoPath) return;

    try {
      const savedComparison = await invoke<Comparison | null>(
        "get_current_comparison",
        {
          repoPath,
        },
      );
      if (savedComparison) {
        set({ comparison: savedComparison });
      } else {
        // No saved comparison - try to get the default branch
        try {
          const defaultBranch = await invoke<string>("get_default_branch", {
            repoPath,
          });
          const newComparison = makeComparison(defaultBranch, "HEAD", true);
          set({ comparison: newComparison });
        } catch {
          // Fall back to default
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
      await invoke("set_current_comparison", {
        repoPath,
        comparison,
      });
    } catch (err) {
      console.error("Failed to save current comparison:", err);
    }
  },

  approveHunk: (hunkId, via) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...reviewState.hunks[hunkId],
        approvedVia: via,
        rejected: undefined, // Clear rejection when approving
      },
    };

    // If this hunk has a move pair, approve it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (hunk?.movePairId && !reviewState.hunks[hunk.movePairId]?.approvedVia) {
      newHunks[hunk.movePairId] = {
        ...reviewState.hunks[hunk.movePairId],
        approvedVia: via,
        rejected: undefined,
      };
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  unapproveHunk: (hunkId) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const existingHunk = reviewState.hunks[hunkId];
    if (!existingHunk) return;

    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...existingHunk,
        approvedVia: undefined,
      },
    };

    // If this hunk has a move pair, unapprove it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (hunk?.movePairId && reviewState.hunks[hunk.movePairId]?.approvedVia) {
      const pairedHunk = reviewState.hunks[hunk.movePairId];
      if (pairedHunk) {
        newHunks[hunk.movePairId] = {
          ...pairedHunk,
          approvedVia: undefined,
        };
      }
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  rejectHunk: (hunkId, notes) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const existingHunk = reviewState.hunks[hunkId] || {};
    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...existingHunk,
        rejected: true,
        approvedVia: undefined, // Clear approval when rejecting
        ...(notes !== undefined ? { notes } : {}),
      },
    };

    // If this hunk has a move pair, reject it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (hunk?.movePairId) {
      const pairedHunkState = reviewState.hunks[hunk.movePairId] || {};
      newHunks[hunk.movePairId] = {
        ...pairedHunkState,
        rejected: true,
        approvedVia: undefined,
        ...(notes !== undefined ? { notes } : {}),
      };
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  unrejectHunk: (hunkId) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const existingHunk = reviewState.hunks[hunkId];
    if (!existingHunk) return;

    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...existingHunk,
        rejected: undefined,
      },
    };

    // If this hunk has a move pair, unreject it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (hunk?.movePairId && reviewState.hunks[hunk.movePairId]?.rejected) {
      const pairedHunk = reviewState.hunks[hunk.movePairId];
      if (pairedHunk) {
        newHunks[hunk.movePairId] = {
          ...pairedHunk,
          rejected: undefined,
        };
      }
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  approveAllFileHunks: (filePath) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const fileHunks = hunks.filter((h) => h.filePath === filePath);
    if (fileHunks.length === 0) return;

    const newHunks = { ...reviewState.hunks };
    for (const hunk of fileHunks) {
      newHunks[hunk.id] = {
        ...newHunks[hunk.id],
        approvedVia: "manual",
      };
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  unapproveAllFileHunks: (filePath) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const fileHunks = hunks.filter((h) => h.filePath === filePath);
    if (fileHunks.length === 0) return;

    const newHunks = { ...reviewState.hunks };
    for (const hunk of fileHunks) {
      if (newHunks[hunk.id]) {
        newHunks[hunk.id] = {
          ...newHunks[hunk.id],
          approvedVia: undefined,
        };
      }
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  setHunkNotes: (hunkId, notes) => {
    const { reviewState } = get();
    if (!reviewState) return;

    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...reviewState.hunks[hunkId],
        notes,
      },
    };

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  setHunkLabel: (hunkId, label) => {
    const { reviewState } = get();
    if (!reviewState) return;

    const existingHunk = reviewState.hunks[hunkId] || {};
    // Convert single label to array for backwards compatibility
    const labels = Array.isArray(label) ? label : [label];
    // Auto-approve if any label matches a trusted pattern (supports glob patterns like imports:*)
    const shouldAutoApprove =
      !existingHunk.approvedVia &&
      anyLabelMatchesAnyPattern(labels, reviewState.trustList);

    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...existingHunk,
        label: labels,
        ...(shouldAutoApprove ? { approvedVia: "trust" as const } : {}),
      },
    };

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  setReviewNotes: (notes) => {
    const { reviewState } = get();
    if (!reviewState) return;

    const newState = {
      ...reviewState,
      notes,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  addTrustPattern: (pattern) => {
    const { reviewState } = get();
    if (!reviewState) return;

    if (reviewState.trustList.includes(pattern)) return;

    // Auto-approve all hunks that have labels matching this pattern (supports glob patterns like imports:*)
    const newHunks = { ...reviewState.hunks };
    for (const [hunkId, hunkState] of Object.entries(newHunks)) {
      const labels = hunkState.label || [];
      if (
        labels.length > 0 &&
        anyLabelMatchesPattern(labels, pattern) &&
        !hunkState.approvedVia
      ) {
        newHunks[hunkId] = {
          ...hunkState,
          approvedVia: "trust",
        };
      }
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      trustList: [...reviewState.trustList, pattern],
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  removeTrustPattern: (pattern) => {
    const { reviewState } = get();
    if (!reviewState) return;

    // Revoke trust approval for hunks that matched this pattern (supports glob patterns like imports:*)
    const newHunks = { ...reviewState.hunks };
    for (const [hunkId, hunkState] of Object.entries(newHunks)) {
      const labels = hunkState.label || [];
      if (
        labels.length > 0 &&
        anyLabelMatchesPattern(labels, pattern) &&
        hunkState.approvedVia === "trust"
      ) {
        newHunks[hunkId] = {
          ...hunkState,
          approvedVia: undefined,
        };
      }
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      trustList: reviewState.trustList.filter((p) => p !== pattern),
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  setSidebarPosition: (position) => {
    set({ sidebarPosition: position });
    setPreference("sidebarPosition", position);
  },

  loadPreferences: async () => {
    const position = await getPreference("sidebarPosition");
    set({ sidebarPosition: position });
  },

  revealFileInTree: (path) => {
    set({ fileToReveal: path, selectedFile: path });
  },

  clearFileToReveal: () => {
    set({ fileToReveal: null });
  },

  checkClaudeAvailable: async () => {
    try {
      const available = await invoke<boolean>("check_claude_available");
      set({ claudeAvailable: available });
    } catch (err) {
      console.error("Failed to check Claude availability:", err);
      set({ claudeAvailable: false });
    }
  },

  classifyUnlabeledHunks: async () => {
    const { repoPath, hunks, reviewState } = get();
    if (!repoPath || !reviewState) return;

    // Find hunks without labels
    const unlabeledHunks = hunks.filter((hunk) => {
      const state = reviewState.hunks[hunk.id];
      return !state?.label || state.label.length === 0;
    });

    if (unlabeledHunks.length === 0) {
      set({ classificationError: "All hunks already have labels" });
      return;
    }

    set({ classifying: true, classificationError: null });

    try {
      // Prepare hunk inputs for classification
      const hunkInputs = unlabeledHunks.map((hunk) => ({
        id: hunk.id,
        filePath: hunk.filePath,
        content: hunk.content,
      }));

      const response = await invoke<ClassifyResponse>(
        "classify_hunks_with_claude",
        {
          repoPath,
          hunks: hunkInputs,
        },
      );

      // Apply classifications to review state
      const newHunks = { ...reviewState.hunks };
      for (const [hunkId, classification] of Object.entries(
        response.classifications,
      )) {
        const labels = classification.label;
        const existingHunk = newHunks[hunkId] || {};

        // Check if any label matches trust list for auto-approval
        const shouldAutoApprove =
          !existingHunk.approvedVia &&
          anyLabelMatchesAnyPattern(labels, reviewState.trustList);

        newHunks[hunkId] = {
          ...existingHunk,
          label: labels,
          reasoning: classification.reasoning,
          ...(shouldAutoApprove ? { approvedVia: "trust" as const } : {}),
        };
      }

      const newState = {
        ...reviewState,
        hunks: newHunks,
        updatedAt: new Date().toISOString(),
      };

      set({ reviewState: newState, classifying: false });
      // Save immediately after classification
      get().saveReviewState();
    } catch (err) {
      console.error("Classification failed:", err);
      set({
        classifying: false,
        classificationError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  completeReview: () => {
    const { reviewState, saveReviewState } = get();
    if (!reviewState) return;

    const newState = {
      ...reviewState,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    // Save immediately, not debounced
    saveReviewState();
  },

  exportRejectionFeedback: () => {
    const { reviewState, hunks } = get();
    if (!reviewState) return null;

    // Find all rejected hunks
    const rejections: RejectionFeedback["rejections"] = [];
    for (const [hunkId, hunkState] of Object.entries(reviewState.hunks)) {
      if (hunkState.rejected) {
        const hunk = hunks.find((h) => h.id === hunkId);
        if (hunk) {
          rejections.push({
            hunkId,
            filePath: hunk.filePath,
            notes: hunkState.notes,
            content: hunk.content,
          });
        }
      }
    }

    if (rejections.length === 0) return null;

    return {
      comparison: reviewState.comparison,
      exportedAt: new Date().toISOString(),
      rejections,
    };
  },

  refresh: async () => {
    const { loadFiles, loadAllFiles, loadReviewState } = get();
    await Promise.all([loadFiles(), loadAllFiles(), loadReviewState()]);
  },
}));
