import type { ApiClient } from "../../api";
import type {
  SliceCreatorWithClient,
  Comparison,
  ReviewState,
  ReviewSummary,
  RejectionFeedback,
  LineAnnotation,
} from "../types";
import { createDebouncedFn } from "../types";

// ========================================================================
// Review Slice
// ========================================================================
//
// This slice manages review state (approvals, rejections, trust list, etc.)
// and intentionally accesses data from other slices via get():
//
// - `hunks` from FilesSlice: to find movePairId for paired move hunks
//   When approving/rejecting a hunk that's part of a move pair, both
//   hunks are updated together for consistency.
//
// This cross-slice access is the standard Zustand pattern for combined
// stores. All slices are merged into a single store, so get() returns
// the complete state including all slices.
//
// ========================================================================

// Debounced save operation
const debouncedSave = createDebouncedFn(500);

// Track when we last saved to ignore file watcher events from our own writes
let lastSaveTimestamp = 0;
const SAVE_GRACE_PERIOD_MS = 1000; // Ignore file watcher events within 1s of our save

export function shouldIgnoreReviewStateReload(): boolean {
  return Date.now() - lastSaveTimestamp < SAVE_GRACE_PERIOD_MS;
}

export interface ReviewSlice {
  // Review state
  reviewState: ReviewState | null;
  savedReviews: ReviewSummary[];
  savedReviewsLoading: boolean;
  refreshVersion: number;

  // Actions
  setReviewState: (state: ReviewState) => void;

  // Persistence
  loadReviewState: () => Promise<void>;
  saveReviewState: () => Promise<void>;
  loadSavedReviews: () => Promise<void>;
  deleteReview: (comparison: Comparison) => Promise<void>;

  // Hunk actions
  approveHunk: (hunkId: string) => void;
  unapproveHunk: (hunkId: string) => void;
  rejectHunk: (hunkId: string) => void;
  unrejectHunk: (hunkId: string) => void;
  approveAllFileHunks: (filePath: string) => void;
  unapproveAllFileHunks: (filePath: string) => void;
  approveAllDirHunks: (dirPath: string) => void;
  unapproveAllDirHunks: (dirPath: string) => void;
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
  ) => string;
  updateAnnotation: (annotationId: string, content: string) => void;
  deleteAnnotation: (annotationId: string) => void;
  getAnnotationsForFile: (filePath: string) => LineAnnotation[];

  // Trust list actions
  addTrustPattern: (pattern: string) => void;
  removeTrustPattern: (pattern: string) => void;

  // Refresh all data
  refresh: () => Promise<void>;
}

export const createReviewSlice: SliceCreatorWithClient<ReviewSlice> =
  (client: ApiClient) => (set, get) => ({
    reviewState: null,
    savedReviews: [],
    savedReviewsLoading: false,
    refreshVersion: 0,

    setReviewState: (state) => set({ reviewState: state }),

    loadReviewState: async () => {
      const { repoPath, comparison } = get();
      if (!repoPath) return;

      try {
        const state = await client.loadReviewState(repoPath, comparison);
        set({ reviewState: state });
      } catch (err) {
        console.error("Failed to load review state:", err);
        set({
          reviewState: {
            comparison,
            hunks: {},
            trustList: [],
            notes: "",
            annotations: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 0,
          },
        });
      }
    },

    saveReviewState: async () => {
      const { repoPath, reviewState } = get();
      if (!repoPath || !reviewState) return;

      try {
        await client.saveReviewState(repoPath, reviewState);
        // Record save time so file watcher can ignore our own writes
        lastSaveTimestamp = Date.now();
      } catch (err) {
        console.error("Failed to save review state:", err);
      }
    },

    loadSavedReviews: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      set({ savedReviewsLoading: true });
      try {
        const reviews = await client.listSavedReviews(repoPath);
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
        await client.deleteReview(repoPath, comparison);
        await loadSavedReviews();
      } catch (err) {
        console.error("Failed to delete review:", err);
      }
    },

    approveHunk: (hunkId) => {
      const { reviewState, hunks, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    unapproveHunk: (hunkId) => {
      const { reviewState, hunks, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    rejectHunk: (hunkId) => {
      const { reviewState, hunks, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    unrejectHunk: (hunkId) => {
      const { reviewState, hunks, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    approveAllFileHunks: (filePath) => {
      const { reviewState, hunks, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    unapproveAllFileHunks: (filePath) => {
      const { reviewState, hunks, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    approveAllDirHunks: (dirPath) => {
      const { reviewState, hunks, saveReviewState } = get();
      if (!reviewState) return;

      // Match hunks whose filePath starts with dirPath/
      const prefix = dirPath + "/";
      const dirHunks = hunks.filter((h) => h.filePath.startsWith(prefix));
      if (dirHunks.length === 0) return;

      const newHunks = { ...reviewState.hunks };
      for (const hunk of dirHunks) {
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
      debouncedSave(saveReviewState);
    },

    unapproveAllDirHunks: (dirPath) => {
      const { reviewState, hunks, saveReviewState } = get();
      if (!reviewState) return;

      const prefix = dirPath + "/";
      const dirHunks = hunks.filter((h) => h.filePath.startsWith(prefix));
      if (dirHunks.length === 0) return;

      const newHunks = { ...reviewState.hunks };
      for (const hunk of dirHunks) {
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
      debouncedSave(saveReviewState);
    },

    setHunkLabel: (hunkId, label) => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      const existingHunk = reviewState.hunks[hunkId];
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
      debouncedSave(saveReviewState);
    },

    setReviewNotes: (notes) => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      const newState = {
        ...reviewState,
        notes,
        updatedAt: new Date().toISOString(),
      };

      set({ reviewState: newState });
      debouncedSave(saveReviewState);
    },

    addAnnotation: (filePath, lineNumber, side, content) => {
      const { reviewState, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
      return id;
    },

    updateAnnotation: (annotationId, content) => {
      const { reviewState, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    deleteAnnotation: (annotationId) => {
      const { reviewState, saveReviewState } = get();
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
      debouncedSave(saveReviewState);
    },

    getAnnotationsForFile: (filePath) => {
      const { reviewState } = get();
      if (!reviewState) return [];
      return (reviewState.annotations ?? []).filter(
        (a) => a.filePath === filePath,
      );
    },

    addTrustPattern: (pattern) => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      if (reviewState.trustList.includes(pattern)) return;

      const newState = {
        ...reviewState,
        trustList: [...reviewState.trustList, pattern],
        updatedAt: new Date().toISOString(),
      };

      set({ reviewState: newState });
      debouncedSave(saveReviewState);
    },

    removeTrustPattern: (pattern) => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      const newState = {
        ...reviewState,
        trustList: reviewState.trustList.filter((p) => p !== pattern),
        updatedAt: new Date().toISOString(),
      };

      set({ reviewState: newState });
      debouncedSave(saveReviewState);
    },

    exportRejectionFeedback: () => {
      const { reviewState, hunks } = get();
      if (!reviewState) return null;

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
      // Increment refresh version to trigger CodeViewer re-fetch
      set((state) => ({ refreshVersion: state.refreshVersion + 1 }));
    },
  });
