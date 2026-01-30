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
  approveHunkIds: (hunkIds: string[]) => void;
  unapproveHunkIds: (hunkIds: string[]) => void;
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

  // Auto-approve staged
  setAutoApproveStaged: (enabled: boolean) => void;

  // Trust list actions
  addTrustPattern: (pattern: string) => void;
  removeTrustPattern: (pattern: string) => void;

  // Refresh all data
  refresh: () => Promise<void>;
}

interface HunkStatusGetter {
  reviewState: ReviewState | null;
  hunks: { id: string; movePairId?: string; filePath: string }[];
  saveReviewState: () => Promise<void>;
}

/**
 * Shared helper to update hunk statuses (approve/unapprove/reject/unreject).
 * Handles move pair propagation and debounced save.
 */
function updateHunkStatuses(
  get: () => HunkStatusGetter,
  set: (partial: { reviewState: ReviewState }) => void,
  hunkIds: string[],
  status: "approved" | "rejected" | undefined,
  options?: {
    /** Only update move pairs if they currently have this status */
    movePairOnlyIfStatus?: "approved" | "rejected";
    /** Skip hunks that don't already exist in reviewState.hunks */
    skipMissing?: boolean;
  },
): void {
  const { reviewState, hunks, saveReviewState } = get();
  if (!reviewState || hunkIds.length === 0) return;

  const newHunks = { ...reviewState.hunks };
  const idsToUpdate = new Set(hunkIds);

  // Collect move pairs
  for (const hunkId of hunkIds) {
    const hunk = hunks.find((h) => h.id === hunkId);
    if (hunk?.movePairId) {
      if (options?.movePairOnlyIfStatus) {
        if (
          reviewState.hunks[hunk.movePairId]?.status ===
          options.movePairOnlyIfStatus
        ) {
          idsToUpdate.add(hunk.movePairId);
        }
      } else {
        idsToUpdate.add(hunk.movePairId);
      }
    }
  }

  for (const id of idsToUpdate) {
    if (options?.skipMissing && !newHunks[id]) continue;
    if (status) {
      newHunks[id] = {
        ...newHunks[id],
        label: newHunks[id]?.label ?? [],
        status,
      };
    } else {
      if (newHunks[id]) {
        newHunks[id] = {
          ...newHunks[id],
          status: undefined,
        };
      }
    }
  }

  set({
    reviewState: {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    },
  });
  debouncedSave(saveReviewState);
}

export const createReviewSlice: SliceCreatorWithClient<ReviewSlice> =
  (client: ApiClient) => (set, get) => ({
    reviewState: null,
    savedReviews: [],
    savedReviewsLoading: false,

    setReviewState: (state) => set({ reviewState: state }),

    loadReviewState: async () => {
      const { repoPath, comparison, reviewState: currentState } = get();
      if (!repoPath) return;

      try {
        const state = await client.loadReviewState(repoPath, comparison);
        // Skip update if the state hasn't changed (avoids unnecessary re-renders)
        if (currentState && state.updatedAt === currentState.updatedAt) return;
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
      updateHunkStatuses(get, set, [hunkId], "approved");
    },

    unapproveHunk: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], undefined, {
        movePairOnlyIfStatus: "approved",
        skipMissing: true,
      });
    },

    rejectHunk: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], "rejected");
    },

    unrejectHunk: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], undefined, {
        movePairOnlyIfStatus: "rejected",
        skipMissing: true,
      });
    },

    approveAllFileHunks: (filePath) => {
      const { hunks } = get();
      const ids = hunks.filter((h) => h.filePath === filePath).map((h) => h.id);
      updateHunkStatuses(get, set, ids, "approved");
    },

    unapproveAllFileHunks: (filePath) => {
      const { hunks } = get();
      const ids = hunks.filter((h) => h.filePath === filePath).map((h) => h.id);
      updateHunkStatuses(get, set, ids, undefined, { skipMissing: true });
    },

    approveHunkIds: (hunkIds) => {
      updateHunkStatuses(get, set, hunkIds, "approved");
    },

    unapproveHunkIds: (hunkIds) => {
      updateHunkStatuses(get, set, hunkIds, undefined, {
        movePairOnlyIfStatus: "approved",
        skipMissing: true,
      });
    },

    approveAllDirHunks: (dirPath) => {
      const { hunks } = get();
      const prefix = dirPath + "/";
      const ids = hunks
        .filter((h) => h.filePath.startsWith(prefix))
        .map((h) => h.id);
      updateHunkStatuses(get, set, ids, "approved");
    },

    unapproveAllDirHunks: (dirPath) => {
      const { hunks } = get();
      const prefix = dirPath + "/";
      const ids = hunks
        .filter((h) => h.filePath.startsWith(prefix))
        .map((h) => h.id);
      updateHunkStatuses(get, set, ids, undefined, { skipMissing: true });
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

    setAutoApproveStaged: (enabled) => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      const newState = {
        ...reviewState,
        autoApproveStaged: enabled,
        updatedAt: new Date().toISOString(),
      };

      set({ reviewState: newState });
      debouncedSave(saveReviewState);
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
        loadReviewState,
        loadGitStatus,
        triggerAutoClassification,
      } = get();

      // Load review state FIRST to ensure labels are available before auto-classification
      await loadReviewState();
      // Then load files and git status (skip auto-classify since we'll trigger it manually after)
      // Pass isRefreshing=true to suppress loading progress indicators and batch state updates
      await Promise.all([loadFiles(true, true), loadGitStatus()]);
      // Now trigger auto-classification with the fresh review state
      triggerAutoClassification();
    },
  });
