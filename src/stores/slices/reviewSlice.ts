import type { ApiClient } from "../../api";
import type {
  Comparison,
  ReviewState,
  ReviewSummary,
  RejectionFeedback,
  LineAnnotation,
} from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { createDebouncedFn } from "../types";
import {
  playApproveSound,
  playRejectSound,
  playBulkSound,
} from "../../utils/sounds";
import { computeReviewProgress } from "../../hooks/useReviewProgress";

// ========================================================================
// Review Slice
// ========================================================================
//
// This slice manages review state (approvals, rejections, trust list, etc.).
// Move pair approval is handled explicitly via approveHunkIds/rejectHunkIds
// called from the MovePairModal, which passes both hunk IDs directly.
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
  rejectAllFileHunks: (filePath: string) => void;
  approveHunkIds: (hunkIds: string[]) => void;
  unapproveHunkIds: (hunkIds: string[]) => void;
  rejectHunkIds: (hunkIds: string[]) => void;
  approveAllDirHunks: (dirPath: string) => void;
  unapproveAllDirHunks: (dirPath: string) => void;
  rejectAllDirHunks: (dirPath: string) => void;
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
    endLineNumber?: number,
  ) => string;
  updateAnnotation: (annotationId: string, content: string) => void;
  deleteAnnotation: (annotationId: string) => void;
  getAnnotationsForFile: (filePath: string) => LineAnnotation[];

  // Auto-approve staged
  setAutoApproveStaged: (enabled: boolean) => void;

  // Trust list actions
  addTrustPattern: (pattern: string) => void;
  removeTrustPattern: (pattern: string) => void;
  setTrustList: (patterns: string[]) => void;

  // Reset review
  resetReview: () => Promise<void>;

  // Refresh all data
  refresh: () => Promise<void>;
}

interface HunkStatusGetter {
  reviewState: ReviewState | null;
  saveReviewState: () => Promise<void>;
}

/**
 * Shared helper to update hunk statuses (approve/unapprove/reject/unreject).
 * Applies status changes and triggers a debounced save.
 */
function updateHunkStatuses(
  get: () => HunkStatusGetter,
  set: (partial: { reviewState: ReviewState }) => void,
  hunkIds: string[],
  status: "approved" | "rejected" | undefined,
  options?: {
    /** Skip hunks that don't already exist in reviewState.hunks */
    skipMissing?: boolean;
  },
): void {
  const { reviewState, saveReviewState } = get();
  if (!reviewState || hunkIds.length === 0) return;

  const newHunks = { ...reviewState.hunks };

  for (const id of hunkIds) {
    if (options?.skipMissing && !newHunks[id]) continue;
    if (status) {
      newHunks[id] = {
        ...newHunks[id],
        label: newHunks[id]?.label ?? [],
        status,
      };
    } else if (newHunks[id]) {
      newHunks[id] = {
        ...newHunks[id],
        status: undefined,
      };
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

  // Sound feedback
  if (status === "approved" && hunkIds.length > 1) {
    playBulkSound();
  } else if (status === "approved") {
    playApproveSound();
  } else if (status === "rejected") {
    playRejectSound();
  }
}

/** Collect hunk IDs for all files under the given directory path. */
function getDirHunkIds(
  get: () => HunkStatusGetter & { hunks: { id: string; filePath: string }[] },
  dirPath: string,
): string[] {
  const prefix = dirPath + "/";
  return get()
    .hunks.filter((h) => h.filePath.startsWith(prefix))
    .map((h) => h.id);
}

export const createReviewSlice: SliceCreatorWithClient<ReviewSlice> =
  (client: ApiClient) => (set, get) => ({
    reviewState: null,
    savedReviews: [],
    savedReviewsLoading: false,

    setReviewState: (state) => set({ reviewState: state }),

    loadReviewState: async () => {
      const { repoPath, comparison } = get();
      if (!repoPath) return;

      const comparisonKey = comparison.key;
      try {
        const state = await client.loadReviewState(repoPath, comparison);
        // Discard result if comparison changed while loading
        if (get().comparison.key !== comparisonKey) return;
        // Re-read current state after await — it may have been updated
        // by user actions (e.g. setTrustList) while the load was in flight
        const latestState = get().reviewState;
        if (latestState) {
          // Skip if nothing changed
          if (state.updatedAt === latestState.updatedAt) return;
          // Skip if in-memory state is newer (unsaved changes pending)
          if (latestState.updatedAt > state.updatedAt) return;
        }
        set({ reviewState: state });
      } catch (err) {
        if (get().comparison.key !== comparisonKey) return;
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
      const { repoPath, reviewState, hunks, comparison, globalReviews } = get();
      if (!repoPath || !reviewState) return;

      try {
        const newVersion = await client.saveReviewState(repoPath, reviewState);
        // Record save time so file watcher can ignore our own writes
        lastSaveTimestamp = Date.now();
        // Keep in-memory version in sync so the next save doesn't conflict
        set({ reviewState: { ...get().reviewState!, version: newVersion } });

        // Patch the specific review entry in globalReviews instead of
        // doing a full loadGlobalReviews() IPC round-trip.
        const progress = computeReviewProgress(hunks, reviewState);
        const updatedReviews = globalReviews.map((r) => {
          if (r.repoPath === repoPath && r.comparison.key === comparison.key) {
            return {
              ...r,
              totalHunks: progress.totalHunks,
              trustedHunks: progress.trustedHunks,
              approvedHunks: progress.approvedHunks,
              rejectedHunks: progress.rejectedHunks,
              reviewedHunks: progress.reviewedHunks,
              state: progress.state,
              updatedAt: reviewState.updatedAt,
            };
          }
          return r;
        });
        set({ globalReviews: updatedReviews });
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
      const { reviewState, focusedHunkIndex, selectedFile, pushUndo } = get();
      if (reviewState) {
        const previousStatuses: Record<
          string,
          (typeof reviewState.hunks)[string] | undefined
        > = {};
        previousStatuses[hunkId] = reviewState.hunks[hunkId];
        pushUndo({
          hunkIds: [hunkId],
          previousStatuses,
          focusedHunkIndex,
          selectedFile,
        });
      }
      updateHunkStatuses(get, set, [hunkId], "approved");
      get().advanceToNextUnreviewedFile();
    },

    unapproveHunk: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], undefined, {
        skipMissing: true,
      });
    },

    rejectHunk: (hunkId) => {
      const { reviewState, focusedHunkIndex, selectedFile, pushUndo } = get();
      if (reviewState) {
        const previousStatuses: Record<
          string,
          (typeof reviewState.hunks)[string] | undefined
        > = {};
        previousStatuses[hunkId] = reviewState.hunks[hunkId];
        pushUndo({
          hunkIds: [hunkId],
          previousStatuses,
          focusedHunkIndex,
          selectedFile,
        });
      }
      updateHunkStatuses(get, set, [hunkId], "rejected");
      get().advanceToNextUnreviewedFile();
    },

    unrejectHunk: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], undefined, {
        skipMissing: true,
      });
    },

    approveAllFileHunks: (filePath) => {
      const { hunks } = get();
      const ids = hunks.filter((h) => h.filePath === filePath).map((h) => h.id);
      updateHunkStatuses(get, set, ids, "approved");
      get().advanceToNextUnreviewedFile();
    },

    unapproveAllFileHunks: (filePath) => {
      const { hunks } = get();
      const ids = hunks.filter((h) => h.filePath === filePath).map((h) => h.id);
      updateHunkStatuses(get, set, ids, undefined, { skipMissing: true });
    },

    rejectAllFileHunks: (filePath) => {
      const { hunks } = get();
      const ids = hunks.filter((h) => h.filePath === filePath).map((h) => h.id);
      updateHunkStatuses(get, set, ids, "rejected");
      get().advanceToNextUnreviewedFile();
    },

    approveHunkIds: (hunkIds) => {
      updateHunkStatuses(get, set, hunkIds, "approved");
    },

    unapproveHunkIds: (hunkIds) => {
      updateHunkStatuses(get, set, hunkIds, undefined, {
        skipMissing: true,
      });
    },

    rejectHunkIds: (hunkIds) => {
      updateHunkStatuses(get, set, hunkIds, "rejected");
    },

    approveAllDirHunks: (dirPath) => {
      const ids = getDirHunkIds(get, dirPath);
      updateHunkStatuses(get, set, ids, "approved");
    },

    unapproveAllDirHunks: (dirPath) => {
      const ids = getDirHunkIds(get, dirPath);
      updateHunkStatuses(get, set, ids, undefined, { skipMissing: true });
    },

    rejectAllDirHunks: (dirPath) => {
      const ids = getDirHunkIds(get, dirPath);
      updateHunkStatuses(get, set, ids, "rejected");
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

    addAnnotation: (filePath, lineNumber, side, content, endLineNumber?) => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return "";

      const id = `${filePath}:${lineNumber}:${side}:${Date.now()}`;
      const newAnnotation: LineAnnotation = {
        id,
        filePath,
        lineNumber,
        ...(endLineNumber != null && endLineNumber !== lineNumber
          ? { endLineNumber }
          : {}),
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

    setTrustList: (patterns) => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      const newState = {
        ...reviewState,
        trustList: patterns,
        updatedAt: new Date().toISOString(),
      };

      set({ reviewState: newState });
      debouncedSave(saveReviewState);
    },

    resetReview: async () => {
      const { reviewState, saveReviewState, refresh } = get();
      if (!reviewState) return;

      const now = new Date().toISOString();
      const newState: ReviewState = {
        comparison: reviewState.comparison,
        hunks: {},
        trustList: reviewState.trustList,
        notes: "",
        annotations: [],
        createdAt: now,
        updatedAt: now,
        version: 0,
      };

      set({ reviewState: newState });
      await saveReviewState();
      await refresh();
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
        repoPath,
        loadFiles,
        loadAllFiles,
        loadReviewState,
        loadGitStatus,
        refreshCommits,
        classifyStaticHunks,
      } = get();

      // Increment refresh generation to trigger re-fetches in components like FileViewer
      set({ refreshGeneration: get().refreshGeneration + 1 });

      // Load review state FIRST to ensure labels are available before classification
      await loadReviewState();
      // Then load files, git status, and commits
      // Pass isRefreshing=true to suppress loading progress indicators and batch state updates
      await Promise.all([
        loadFiles(true),
        loadAllFiles(),
        loadGitStatus(),
        repoPath ? refreshCommits(repoPath) : Promise.resolve(),
      ]);
      // Run static (rule-based) classification on refresh
      classifyStaticHunks();
      // Reset guide progress indicators so stale badges can take over
      set({
        classificationStatus: "idle" as const,
        groupingStatus: "idle" as const,
        summaryStatus: "idle" as const,
      });
    },
  });
