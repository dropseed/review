import type { ApiClient } from "../../api";
import type {
  Comparison,
  DiffHunk,
  GlobalReviewSummary,
  HunkState,
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
import { groupingResetState } from "./groupingSlice";

// Debounced save operation (exported so cancelPendingSaves can cancel it)
export const debouncedSave = createDebouncedFn(500);

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
  saveHunkForLater: (hunkId: string) => void;
  unsaveHunkForLater: (hunkId: string) => void;
  saveAllFileHunksForLater: (filePath: string) => void;
  saveHunkIdsForLater: (hunkIds: string[]) => void;
  saveAllDirHunksForLater: (dirPath: string) => void;
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

  // Sync total diff hunk count into review state
  syncTotalDiffHunks: () => void;

  // Trust list actions
  addTrustPattern: (pattern: string) => void;
  removeTrustPattern: (pattern: string) => void;
  setTrustList: (patterns: string[]) => void;

  // Clear feedback (notes + annotations only)
  clearFeedback: () => void;

  // Reset review
  resetReview: () => Promise<void>;

  // Refresh all data
  refresh: () => Promise<void>;
}

/**
 * Patch the globalReviews entry for the current comparison with fresh progress data.
 * Used after saving or syncing to keep sidebar progress accurate without a full reload.
 */
function patchGlobalReviewProgress(
  get: () => {
    repoPath: string | null;
    comparison: Comparison;
    hunks: DiffHunk[];
    globalReviews: GlobalReviewSummary[];
  },
  set: (partial: { globalReviews: GlobalReviewSummary[] }) => void,
  reviewState: ReviewState,
): void {
  const { repoPath, comparison, hunks, globalReviews } = get();
  if (!repoPath) return;

  const progress = computeReviewProgress(hunks, reviewState);
  const patched = globalReviews.map((r) => {
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
  set({ globalReviews: patched });
}

interface HunkStatusGetter {
  reviewState: ReviewState | null;
  saveReviewState: () => Promise<void>;
}

/**
 * Shared helper to update hunk statuses (approve/unapprove/reject/unreject).
 * Applies status changes and triggers a debounced save.
 * Sidebar progress is derived live from store state in TabRailList.
 */
function updateHunkStatuses(
  get: () => HunkStatusGetter,
  set: (partial: { reviewState: ReviewState }) => void,
  hunkIds: string[],
  status: "approved" | "rejected" | "saved_for_later" | undefined,
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

  const newState = {
    ...reviewState,
    hunks: newHunks,
    updatedAt: new Date().toISOString(),
  };
  set({ reviewState: newState });

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

/** Push an undo entry for a single hunk action. */
function pushHunkUndo(
  get: () => {
    reviewState: ReviewState | null;
    focusedHunkIndex: number;
    selectedFile: string | null;
    pushUndo: (entry: {
      hunkIds: string[];
      previousStatuses: Record<string, HunkState | undefined>;
      focusedHunkIndex: number;
      selectedFile: string | null;
    }) => void;
  },
  hunkId: string,
): void {
  const { reviewState, focusedHunkIndex, selectedFile, pushUndo } = get();
  if (!reviewState) return;
  pushUndo({
    hunkIds: [hunkId],
    previousStatuses: { [hunkId]: reviewState.hunks[hunkId] },
    focusedHunkIndex,
    selectedFile,
  });
}

/** Collect hunk IDs for a specific file path. */
function getFileHunkIds(
  hunks: { id: string; filePath: string }[],
  filePath: string,
): string[] {
  const ids: string[] = [];
  for (const h of hunks) {
    if (h.filePath === filePath) ids.push(h.id);
  }
  return ids;
}

/** Collect hunk IDs for all files under the given directory path. */
function getDirHunkIds(
  get: () => { hunks: { id: string; filePath: string }[] },
  dirPath: string,
): string[] {
  const prefix = dirPath + "/";
  return get()
    .hunks.filter((h) => h.filePath.startsWith(prefix))
    .map((h) => h.id);
}

/**
 * Merge partial fields into the current reviewState, set updatedAt, and trigger a debounced save.
 * Returns false if reviewState is null (no update performed).
 */
function patchReviewState(
  get: () => {
    reviewState: ReviewState | null;
    saveReviewState: () => Promise<void>;
  },
  set: (partial: { reviewState: ReviewState }) => void,
  patch: Partial<ReviewState>,
): boolean {
  const { reviewState, saveReviewState } = get();
  if (!reviewState) return false;

  set({
    reviewState: {
      ...reviewState,
      ...patch,
      updatedAt: new Date().toISOString(),
    },
  });
  debouncedSave(saveReviewState);
  return true;
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
            totalDiffHunks: 0,
          },
        });
      }
    },

    saveReviewState: async () => {
      let { repoPath, reviewState, hunks, comparison } = get();
      if (!repoPath || !reviewState) return;

      // Defense-in-depth: skip save if review state belongs to a different comparison
      // (catches races where a stale debounced save fires after switching)
      if (reviewState.comparison.key !== comparison.key) return;

      // Ensure totalDiffHunks is set from the actual diff hunk count
      if (hunks.length > 0 && reviewState.totalDiffHunks !== hunks.length) {
        reviewState = { ...reviewState, totalDiffHunks: hunks.length };
        set({ reviewState });
      }

      const saveAndUpdateVersion = async (
        state: ReviewState,
      ): Promise<void> => {
        const newVersion = await client.saveReviewState(repoPath, state);
        lastSaveTimestamp = Date.now();
        set({ reviewState: { ...get().reviewState!, version: newVersion } });
      };

      try {
        await saveAndUpdateVersion(reviewState);
      } catch (err) {
        if (!String(err).includes("Version conflict")) {
          console.error("Failed to save review state:", err);
          return;
        }

        // Version conflict: reload disk state for its version and retry
        try {
          const { comparison } = get();
          const diskState = await client.loadReviewState(repoPath, comparison);
          const currentState = get().reviewState!;
          await saveAndUpdateVersion({
            ...currentState,
            version: diskState.version,
          });
        } catch (retryErr) {
          console.error("Failed to save after version conflict:", retryErr);
          return;
        }
      }

      // Patch the specific review entry in globalReviews instead of
      // doing a full loadGlobalReviews() IPC round-trip.
      patchGlobalReviewProgress(get, set, get().reviewState!);
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
      pushHunkUndo(get, hunkId);
      updateHunkStatuses(get, set, [hunkId], "approved");
      get().advanceToNextUnreviewedFile();
    },

    unapproveHunk: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], undefined, {
        skipMissing: true,
      });
    },

    rejectHunk: (hunkId) => {
      pushHunkUndo(get, hunkId);
      updateHunkStatuses(get, set, [hunkId], "rejected");
      // Don't advance — stay on the file so the comment box opens
    },

    unrejectHunk: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], undefined, {
        skipMissing: true,
      });
    },

    approveAllFileHunks: (filePath) => {
      const ids = getFileHunkIds(get().hunks, filePath);
      updateHunkStatuses(get, set, ids, "approved");
      get().advanceToNextUnreviewedFile();
    },

    unapproveAllFileHunks: (filePath) => {
      const ids = getFileHunkIds(get().hunks, filePath);
      updateHunkStatuses(get, set, ids, undefined, { skipMissing: true });
    },

    rejectAllFileHunks: (filePath) => {
      const ids = getFileHunkIds(get().hunks, filePath);
      updateHunkStatuses(get, set, ids, "rejected");
      // Don't advance — stay on the file so the comment box opens
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

    saveHunkForLater: (hunkId) => {
      pushHunkUndo(get, hunkId);
      updateHunkStatuses(get, set, [hunkId], "saved_for_later");
      get().nextHunkInFile();
    },

    unsaveHunkForLater: (hunkId) => {
      updateHunkStatuses(get, set, [hunkId], undefined, {
        skipMissing: true,
      });
    },

    saveAllFileHunksForLater: (filePath) => {
      const ids = getFileHunkIds(get().hunks, filePath);
      updateHunkStatuses(get, set, ids, "saved_for_later");
    },

    saveHunkIdsForLater: (hunkIds) => {
      updateHunkStatuses(get, set, hunkIds, "saved_for_later");
    },

    saveAllDirHunksForLater: (dirPath) => {
      const ids = getDirHunkIds(get, dirPath);
      updateHunkStatuses(get, set, ids, "saved_for_later");
    },

    setHunkLabel: (hunkId, label) => {
      const { reviewState } = get();
      if (!reviewState) return;

      const labels = Array.isArray(label) ? label : [label];
      patchReviewState(get, set, {
        hunks: {
          ...reviewState.hunks,
          [hunkId]: { ...reviewState.hunks[hunkId], label: labels },
        },
      });
    },

    setReviewNotes: (notes) => {
      patchReviewState(get, set, { notes });
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
      const { reviewState } = get();
      if (!reviewState) return;

      const annotations = (reviewState.annotations ?? []).map((a) =>
        a.id === annotationId ? { ...a, content } : a,
      );
      patchReviewState(get, set, { annotations });
    },

    deleteAnnotation: (annotationId) => {
      const { reviewState } = get();
      if (!reviewState) return;

      const annotations = (reviewState.annotations ?? []).filter(
        (a) => a.id !== annotationId,
      );
      patchReviewState(get, set, { annotations });
    },

    getAnnotationsForFile: (filePath) => {
      const { reviewState } = get();
      if (!reviewState) return [];
      return (reviewState.annotations ?? []).filter(
        (a) => a.filePath === filePath,
      );
    },

    setAutoApproveStaged: (enabled) => {
      patchReviewState(get, set, { autoApproveStaged: enabled });
    },

    syncTotalDiffHunks: () => {
      const { reviewState, hunks } = get();
      if (
        !reviewState ||
        hunks.length === 0 ||
        reviewState.totalDiffHunks === hunks.length
      ) {
        return;
      }

      const updated = { ...reviewState, totalDiffHunks: hunks.length };
      set({ reviewState: updated });

      // Immediately patch globalReviews so the sidebar shows correct progress
      // (otherwise it stays inflated until the next saveReviewState call)
      patchGlobalReviewProgress(get, set, updated);
    },

    addTrustPattern: (pattern) => {
      const { reviewState } = get();
      if (!reviewState || reviewState.trustList.includes(pattern)) return;

      patchReviewState(get, set, {
        trustList: [...reviewState.trustList, pattern],
      });
    },

    removeTrustPattern: (pattern) => {
      const { reviewState } = get();
      if (!reviewState) return;

      patchReviewState(get, set, {
        trustList: reviewState.trustList.filter((p) => p !== pattern),
      });
    },

    setTrustList: (patterns) => {
      patchReviewState(get, set, { trustList: patterns });
    },

    clearFeedback: () => {
      patchReviewState(get, set, { notes: "", annotations: [] });
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
        totalDiffHunks: 0,
      };

      set({
        reviewState: newState,
        reviewGroups: [],
        identicalHunkIds: groupingResetState.identicalHunkIds,
      });
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

      // Load data in parallel; pass isRefreshing=true to suppress progress indicators
      await Promise.all([
        loadReviewState(),
        loadFiles(true),
        loadAllFiles(true),
        loadGitStatus(),
        repoPath ? refreshCommits(repoPath) : Promise.resolve(),
      ]);
      // Run static (rule-based) classification on refresh
      classifyStaticHunks();
      get().restoreGuideFromState();
      set({
        classificationStatus: "idle",
        groupingStatus: "idle",
      });
    },
  });
