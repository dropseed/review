import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Comparison,
  FileEntry,
  DiffHunk,
  ReviewState,
  ReviewSummary,
  ClassifyResponse,
  MovePair,
  RejectionFeedback,
  LineAnnotation,
  GitStatusSummary,
} from "../types";
import { makeComparison } from "../types";
import {
  getPreference,
  setPreference,
  CODE_FONT_SIZE_DEFAULT,
} from "../utils/preferences";

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
  gitStatus: GitStatusSummary | null;

  // Saved reviews (for start screen)
  savedReviews: ReviewSummary[];
  savedReviewsLoading: boolean;

  // UI settings
  sidebarPosition: "left" | "right";
  codeFontSize: number;
  codeTheme: string;
  fileToReveal: string | null; // File path to reveal in tree

  // Classification state
  claudeAvailable: boolean | null;
  classifying: boolean;
  classificationError: string | null;
  classifyingHunkIds: Set<string>;
  autoClassifyEnabled: boolean;
  classifyCommand: string | null;
  classifyBatchSize: number;
  classifyMaxConcurrent: number;

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
  loadFiles: (skipAutoClassify?: boolean) => Promise<void>;
  loadAllFiles: () => Promise<void>;
  loadReviewState: () => Promise<void>;
  saveReviewState: () => Promise<void>;
  loadCurrentComparison: () => Promise<void>;
  saveCurrentComparison: () => Promise<void>;
  loadGitStatus: () => Promise<void>;
  loadSavedReviews: () => Promise<void>;
  deleteReview: (comparison: Comparison) => Promise<void>;

  // Hunk actions
  approveHunk: (hunkId: string) => void;
  unapproveHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string) => void;
  unrejectHunk: (hunkId: string) => void;
  approveAllFileHunks: (filePath: string) => void;
  unapproveAllFileHunks: (filePath: string) => void;
  setHunkLabel: (hunkId: string, label: string | string[]) => void;

  // Feedback export
  exportRejectionFeedback: () => RejectionFeedback | null;

  // Review notes
  setReviewNotes: (notes: string) => void;

  // Annotations
  addAnnotation: (
    filePath: string,
    lineNumber: number,
    side: "old" | "new" | "file",
    content: string,
  ) => string; // Returns the annotation id
  updateAnnotation: (annotationId: string, content: string) => void;
  deleteAnnotation: (annotationId: string) => void;
  getAnnotationsForFile: (filePath: string) => LineAnnotation[];

  // Trust list actions
  addTrustPattern: (pattern: string) => void;
  removeTrustPattern: (pattern: string) => void;

  // UI settings actions
  setSidebarPosition: (position: "left" | "right") => void;
  setCodeFontSize: (size: number) => void;
  setCodeTheme: (theme: string) => void;
  loadPreferences: () => Promise<void>;
  revealFileInTree: (path: string) => void;
  clearFileToReveal: () => void;

  // Classification
  checkClaudeAvailable: () => Promise<void>;
  classifyUnlabeledHunks: (hunkIds?: string[]) => Promise<void>;
  triggerAutoClassification: () => void;
  setAutoClassifyEnabled: (enabled: boolean) => void;
  setClassifyCommand: (command: string | null) => void;
  setClassifyBatchSize: (size: number) => void;
  setClassifyMaxConcurrent: (count: number) => void;

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

// Debounced auto-classification with generation counter for cancellation
const createDebouncedAutoClassify = () => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let generation = 0;

  return (classifyFn: (gen: number) => Promise<void>) => {
    if (timeout) {
      clearTimeout(timeout);
    }
    generation++;
    const currentGen = generation;
    timeout = setTimeout(async () => {
      await classifyFn(currentGen);
    }, 1500);
  };
};
const debouncedAutoClassify = createDebouncedAutoClassify();

// Track current classification generation for cancellation
let classifyGeneration = 0;

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
  gitStatus: null,
  savedReviews: [],
  savedReviewsLoading: false,
  sidebarPosition: "left",
  codeFontSize: CODE_FONT_SIZE_DEFAULT,
  codeTheme: "github-dark",
  fileToReveal: null,
  claudeAvailable: null,
  classifying: false,
  classificationError: null,
  classifyingHunkIds: new Set<string>(),
  autoClassifyEnabled: true,
  classifyCommand: null,
  classifyBatchSize: 5,
  classifyMaxConcurrent: 2,

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

  loadFiles: async (skipAutoClassify = false) => {
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

      // Trigger auto-classification after files are loaded (unless skipped)
      if (!skipAutoClassify) {
        get().triggerAutoClassification();
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
          annotations: [],
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

  loadGitStatus: async () => {
    const { repoPath } = get();
    if (!repoPath) return;

    try {
      const status = await invoke<GitStatusSummary>("get_git_status", {
        repoPath,
      });
      set({ gitStatus: status });
    } catch (err) {
      console.error("Failed to load git status:", err);
      set({ gitStatus: null });
    }
  },

  loadSavedReviews: async () => {
    const { repoPath } = get();
    if (!repoPath) return;

    set({ savedReviewsLoading: true });
    try {
      const reviews = await invoke<ReviewSummary[]>("list_saved_reviews", {
        repoPath,
      });
      set({ savedReviews: reviews, savedReviewsLoading: false });
    } catch (err) {
      console.error("Failed to load saved reviews:", err);
      set({ savedReviews: [], savedReviewsLoading: false });
    }
  },

  deleteReview: async (comparison) => {
    const { repoPath, loadSavedReviews } = get();
    if (!repoPath) return;

    try {
      await invoke("delete_review", {
        repoPath,
        comparison,
      });
      // Reload the saved reviews list
      await loadSavedReviews();
    } catch (err) {
      console.error("Failed to delete review:", err);
    }
  },

  approveHunk: (hunkId) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...reviewState.hunks[hunkId],
        label: reviewState.hunks[hunkId]?.label ?? [],
        status: "approved" as const,
      },
    };

    // If this hunk has a move pair, approve it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (
      hunk?.movePairId &&
      reviewState.hunks[hunk.movePairId]?.status !== "approved"
    ) {
      newHunks[hunk.movePairId] = {
        ...reviewState.hunks[hunk.movePairId],
        label: reviewState.hunks[hunk.movePairId]?.label ?? [],
        status: "approved" as const,
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
        status: undefined,
      },
    };

    // If this hunk has a move pair, unapprove it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (
      hunk?.movePairId &&
      reviewState.hunks[hunk.movePairId]?.status === "approved"
    ) {
      const pairedHunk = reviewState.hunks[hunk.movePairId];
      if (pairedHunk) {
        newHunks[hunk.movePairId] = {
          ...pairedHunk,
          status: undefined,
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

  rejectHunk: (hunkId) => {
    const { reviewState, hunks } = get();
    if (!reviewState) return;

    const existingHunk = reviewState.hunks[hunkId];
    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...existingHunk,
        label: existingHunk?.label ?? [],
        status: "rejected" as const,
      },
    };

    // If this hunk has a move pair, reject it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (hunk?.movePairId) {
      const pairedHunkState = reviewState.hunks[hunk.movePairId];
      newHunks[hunk.movePairId] = {
        ...pairedHunkState,
        label: pairedHunkState?.label ?? [],
        status: "rejected" as const,
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
        status: undefined,
      },
    };

    // If this hunk has a move pair, unreject it too
    const hunk = hunks.find((h) => h.id === hunkId);
    if (
      hunk?.movePairId &&
      reviewState.hunks[hunk.movePairId]?.status === "rejected"
    ) {
      const pairedHunk = reviewState.hunks[hunk.movePairId];
      if (pairedHunk) {
        newHunks[hunk.movePairId] = {
          ...pairedHunk,
          status: undefined,
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
        label: newHunks[hunk.id]?.label ?? [],
        status: "approved" as const,
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
          status: undefined,
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

  setHunkLabel: (hunkId, label) => {
    const { reviewState } = get();
    if (!reviewState) return;

    const existingHunk = reviewState.hunks[hunkId];
    // Convert single label to array
    const labels = Array.isArray(label) ? label : [label];

    const newHunks = {
      ...reviewState.hunks,
      [hunkId]: {
        ...existingHunk,
        label: labels,
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

  addAnnotation: (filePath, lineNumber, side, content) => {
    const { reviewState } = get();
    if (!reviewState) return "";

    const id = `${filePath}:${lineNumber}:${side}:${Date.now()}`;
    const newAnnotation: LineAnnotation = {
      id,
      filePath,
      lineNumber,
      side,
      content,
      createdAt: new Date().toISOString(),
    };

    const newState = {
      ...reviewState,
      annotations: [...(reviewState.annotations ?? []), newAnnotation],
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
    return id;
  },

  updateAnnotation: (annotationId, content) => {
    const { reviewState } = get();
    if (!reviewState) return;

    const annotations = (reviewState.annotations ?? []).map((a) =>
      a.id === annotationId ? { ...a, content } : a,
    );

    const newState = {
      ...reviewState,
      annotations,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  deleteAnnotation: (annotationId) => {
    const { reviewState } = get();
    if (!reviewState) return;

    const annotations = (reviewState.annotations ?? []).filter(
      (a) => a.id !== annotationId,
    );

    const newState = {
      ...reviewState,
      annotations,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  getAnnotationsForFile: (filePath) => {
    const { reviewState } = get();
    if (!reviewState) return [];
    return (reviewState.annotations ?? []).filter(
      (a) => a.filePath === filePath,
    );
  },

  addTrustPattern: (pattern) => {
    const { reviewState } = get();
    if (!reviewState) return;

    if (reviewState.trustList.includes(pattern)) return;

    const newState = {
      ...reviewState,
      trustList: [...reviewState.trustList, pattern],
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    debouncedSave(get().saveReviewState);
  },

  removeTrustPattern: (pattern) => {
    const { reviewState } = get();
    if (!reviewState) return;

    const newState = {
      ...reviewState,
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

  setCodeFontSize: (size) => {
    set({ codeFontSize: size });
    setPreference("codeFontSize", size);
    // Update CSS variables for global font size and UI scale
    document.documentElement.style.setProperty("--code-font-size", `${size}px`);
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(size / CODE_FONT_SIZE_DEFAULT),
    );
  },

  setCodeTheme: (theme) => {
    set({ codeTheme: theme });
    setPreference("codeTheme", theme);
  },

  loadPreferences: async () => {
    const position = await getPreference("sidebarPosition");
    const fontSize = await getPreference("codeFontSize");
    const theme = await getPreference("codeTheme");
    const autoClassify = await getPreference("autoClassifyEnabled");
    const classifyCmd = await getPreference("classifyCommand");
    const batchSize = await getPreference("classifyBatchSize");
    const maxConcurrent = await getPreference("classifyMaxConcurrent");
    set({
      sidebarPosition: position,
      codeFontSize: fontSize,
      codeTheme: theme,
      autoClassifyEnabled: autoClassify,
      classifyCommand: classifyCmd,
      classifyBatchSize: batchSize,
      classifyMaxConcurrent: maxConcurrent,
    });
    // Apply font size CSS variables
    document.documentElement.style.setProperty(
      "--code-font-size",
      `${fontSize}px`,
    );
    document.documentElement.style.setProperty(
      "--ui-scale",
      String(fontSize / CODE_FONT_SIZE_DEFAULT),
    );
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

  classifyUnlabeledHunks: async (hunkIds) => {
    const {
      repoPath,
      hunks,
      reviewState,
      classifyCommand,
      classifyBatchSize,
      classifyMaxConcurrent,
    } = get();
    if (!repoPath || !reviewState) return;

    // Increment generation for cancellation
    classifyGeneration++;
    const currentGeneration = classifyGeneration;

    // Find hunks to classify - filter to specified ids if provided, then always filter out already-labeled
    let candidateHunks = hunkIds
      ? hunks.filter((h) => hunkIds.includes(h.id))
      : hunks;

    // Always filter out hunks that have already been classified
    // A hunk is considered classified if it has a label OR reasoning (reasoning without label means "needs manual review")
    let hunksToClassify = candidateHunks.filter((hunk) => {
      const state = reviewState.hunks[hunk.id];
      const hasLabel = state?.label && state.label.length > 0;
      const hasReasoning = !!state?.reasoning;
      return !hasLabel && !hasReasoning;
    });

    // Log what we're doing for debugging
    const alreadyClassifiedCount =
      candidateHunks.length - hunksToClassify.length;
    if (alreadyClassifiedCount > 0) {
      console.log(
        `[classifyUnlabeledHunks] Skipping ${alreadyClassifiedCount} already-classified hunks`,
      );
    }

    if (hunksToClassify.length === 0) {
      console.log("[classifyUnlabeledHunks] No unclassified hunks to classify");
      if (!hunkIds) {
        set({ classificationError: "All hunks already classified" });
      }
      return;
    }

    console.log(
      `[classifyUnlabeledHunks] Classifying ${hunksToClassify.length} hunks: ${hunksToClassify.map((h) => h.id).join(", ")}`,
    );

    // Track which hunks are being classified
    const classifyingIds = new Set(hunksToClassify.map((h) => h.id));
    set({
      classifying: true,
      classificationError: null,
      classifyingHunkIds: classifyingIds,
    });

    // Set up listener for batch completion events to update progress
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<string[]>("classify:batch-complete", (event) => {
        const completedIds = event.payload;
        console.log(
          `[classifyUnlabeledHunks] Batch complete: ${completedIds.length} hunks`,
        );
        // Remove completed IDs from the classifying set
        set((state) => {
          const newSet = new Set(state.classifyingHunkIds);
          for (const id of completedIds) {
            newSet.delete(id);
          }
          return { classifyingHunkIds: newSet };
        });
      });
    } catch (err) {
      console.warn(
        "[classifyUnlabeledHunks] Failed to set up progress listener:",
        err,
      );
    }

    try {
      // Prepare hunk inputs for classification
      const hunkInputs = hunksToClassify.map((hunk) => ({
        id: hunk.id,
        filePath: hunk.filePath,
        content: hunk.content,
      }));

      console.log(
        `[classifyUnlabeledHunks] Calling classify_hunks_with_claude (gen=${currentGeneration}, batchSize=${classifyBatchSize}, maxConcurrent=${classifyMaxConcurrent})`,
      );

      const response = await invoke<ClassifyResponse>(
        "classify_hunks_with_claude",
        {
          repoPath,
          hunks: hunkInputs,
          command: classifyCommand || undefined,
          batchSize: classifyBatchSize,
          maxConcurrent: classifyMaxConcurrent,
        },
      );

      // Clean up listener
      if (unlisten) unlisten();

      console.log(
        `[classifyUnlabeledHunks] Got response with ${Object.keys(response.classifications).length} classifications (gen=${currentGeneration}, current=${classifyGeneration})`,
      );

      // Check if this classification was cancelled
      if (currentGeneration !== classifyGeneration) {
        console.log("[classifyUnlabeledHunks] Cancelled - stale generation");
        set({ classifying: false, classifyingHunkIds: new Set<string>() });
        return;
      }

      // Get fresh review state (may have changed during classification)
      const freshState = get().reviewState;
      if (!freshState) return;

      // Apply classifications to review state
      const newHunks = { ...freshState.hunks };
      const classifiedIds: string[] = [];
      for (const [hunkId, classification] of Object.entries(
        response.classifications,
      )) {
        const existingHunk = newHunks[hunkId];
        newHunks[hunkId] = {
          ...existingHunk,
          label: classification.label,
          reasoning: classification.reasoning,
        };
        classifiedIds.push(hunkId);
      }

      console.log(
        `[classifyUnlabeledHunks] Applied labels to ${classifiedIds.length} hunks`,
      );

      const newState = {
        ...freshState,
        hunks: newHunks,
        updatedAt: new Date().toISOString(),
      };

      set({
        reviewState: newState,
        classifying: false,
        classifyingHunkIds: new Set<string>(),
      });
      // Save immediately after classification
      await get().saveReviewState();
      console.log("[classifyUnlabeledHunks] Review state saved");
    } catch (err) {
      // Clean up listener
      if (unlisten) unlisten();

      // Check if this classification was cancelled
      if (currentGeneration !== classifyGeneration) {
        console.log(
          "[classifyUnlabeledHunks] Error handler: stale generation, ignoring",
        );
        set({ classifying: false, classifyingHunkIds: new Set<string>() });
        return;
      }
      console.error("[classifyUnlabeledHunks] Classification failed:", err);
      set({
        classifying: false,
        classifyingHunkIds: new Set<string>(),
        classificationError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  triggerAutoClassification: () => {
    const {
      claudeAvailable,
      autoClassifyEnabled,
      hunks,
      reviewState,
      classifying,
    } = get();

    // Don't trigger if already classifying
    if (classifying) {
      console.log("[triggerAutoClassification] Already classifying, skipping");
      return;
    }

    if (!claudeAvailable || !autoClassifyEnabled || !reviewState) {
      console.log(
        `[triggerAutoClassification] Skipped - claude: ${claudeAvailable}, autoClassify: ${autoClassifyEnabled}, hasState: ${!!reviewState}`,
      );
      return;
    }

    // Find unclassified hunks (just for logging - actual filtering happens in classifyUnlabeledHunks)
    // A hunk is considered classified if it has a label OR reasoning
    const unclassifiedHunks = hunks.filter((hunk) => {
      const state = reviewState.hunks[hunk.id];
      const hasLabel = state?.label && state.label.length > 0;
      const hasReasoning = !!state?.reasoning;
      return !hasLabel && !hasReasoning;
    });

    if (unclassifiedHunks.length === 0) {
      console.log(
        "[triggerAutoClassification] No unclassified hunks, skipping",
      );
      return;
    }

    console.log(
      `[triggerAutoClassification] Scheduling classification for ${unclassifiedHunks.length} unclassified hunks`,
    );

    // Use debounced classification
    debouncedAutoClassify(async () => {
      await get().classifyUnlabeledHunks();
    });
  },

  setAutoClassifyEnabled: (enabled) => {
    set({ autoClassifyEnabled: enabled });
    setPreference("autoClassifyEnabled", enabled);
  },

  setClassifyCommand: (command) => {
    set({ classifyCommand: command });
    setPreference("classifyCommand", command);
  },

  setClassifyBatchSize: (size) => {
    set({ classifyBatchSize: size });
    setPreference("classifyBatchSize", size);
  },

  setClassifyMaxConcurrent: (count) => {
    set({ classifyMaxConcurrent: count });
    setPreference("classifyMaxConcurrent", count);
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
      if (hunkState.status === "rejected") {
        const hunk = hunks.find((h) => h.id === hunkId);
        if (hunk) {
          rejections.push({
            hunkId,
            filePath: hunk.filePath,
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
    const {
      loadFiles,
      loadAllFiles,
      loadReviewState,
      loadGitStatus,
      triggerAutoClassification,
    } = get();
    // Load review state FIRST to ensure labels are available before auto-classification
    await loadReviewState();
    // Then load files and git status (skip auto-classify since we'll trigger it manually after)
    await Promise.all([loadFiles(true), loadAllFiles(), loadGitStatus()]);
    // Now trigger auto-classification with the fresh review state
    triggerAutoClassification();
  },
}));
