import type { ApiClient } from "../../api";
import {
  getComparisonRange,
  type Comparison,
  type FileDiff,
  type GlobalReviewSummary,
  type HunkState,
  type ReviewState,
  type ReviewSummary,
  type RejectionFeedback,
  type LineAnnotation,
} from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { createDebouncedFn } from "../types";
import {
  playApproveSound,
  playRejectSound,
  playBulkSound,
} from "../../utils/sounds";
import { computeReviewProgress } from "../../hooks/useReviewProgress";
import { makeReviewKey } from "./groupingSlice";
import { getAllHunksFromState } from "../selectors/hunks";

// Debounced save operation (exported so cancelPendingSaves can cancel it)
export const debouncedSave = createDebouncedFn(500);

// Track when we last saved to ignore file watcher events from our own writes
let lastSaveTimestamp = 0;
const SAVE_GRACE_PERIOD_MS = 1000; // Ignore file watcher events within 1s of our save

export function shouldIgnoreReviewStateReload(): boolean {
  return Date.now() - lastSaveTimestamp < SAVE_GRACE_PERIOD_MS;
}

// Track which local-source reviews have already had their file created on disk,
// so we don't call ensureReviewExists on every debounced save.
const ensuredLocalReviews = new Set<string>();

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

  // Auto-start guide
  setAutoStartGuide: (enabled: boolean) => void;

  // Sync total diff hunk count into review state
  syncTotalDiffHunks: () => void;

  // Flush current progress to globalReviews (for use before switching away)
  flushSidebarProgress: () => void;

  // Trust list actions
  addTrustPattern: (pattern: string) => void;
  removeTrustPattern: (pattern: string) => void;
  setTrustList: (patterns: string[]) => void;

  // Clear feedback (notes + annotations only)
  clearFeedback: () => void;

  // Reset review
  resetReview: () => Promise<void>;

  // Refresh all data (full reload)
  refresh: () => Promise<void>;

  /**
   * Handle a watcher-emitted change. For git-state changes (commits, branch
   * switches, staging) delegates to `refresh()`. For pure working-tree edits,
   * surgically refetches only the changed files' `filesByPath` entries so
   * viewers subscribed via `useFileHunks(path)` update in place.
   */
  applyWatcherEvent: (event: {
    changedPaths: string[];
    gitStateChanged: boolean;
  }) => Promise<void>;
}

/**
 * Patch the globalReviews entry for the current comparison with fresh progress data.
 * Used after saving or syncing to keep sidebar progress accurate without a full reload.
 */
function patchGlobalReviewProgress(
  get: () => {
    repoPath: string | null;
    comparison: Comparison | null;
    filesByPath: Record<string, FileDiff>;
    flatFileList: string[];
    globalReviews: GlobalReviewSummary[];
  },
  set: (partial: { globalReviews: GlobalReviewSummary[] }) => void,
  reviewState: ReviewState,
): void {
  const state = get();
  const { repoPath, comparison, globalReviews } = state;
  if (!repoPath || !comparison) return;

  const progress = computeReviewProgress(
    getAllHunksFromState(state),
    reviewState,
  );
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
  readOnlyPreview: boolean;
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
  const { reviewState, readOnlyPreview, saveReviewState } = get();
  if (readOnlyPreview) return;
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
    focusedHunkId: string | null;
    selectedFile: string | null;
    pushUndo: (entry: {
      hunkIds: string[];
      previousStatuses: Record<string, HunkState | undefined>;
      focusedHunkId: string | null;
      selectedFile: string | null;
    }) => void;
  },
  hunkId: string,
): void {
  const { reviewState, focusedHunkId, selectedFile, pushUndo } = get();
  if (!reviewState) return;
  pushUndo({
    hunkIds: [hunkId],
    previousStatuses: { [hunkId]: reviewState.hunks[hunkId] },
    focusedHunkId,
    selectedFile,
  });
}

/** Collect hunk IDs for a specific file path. */
function getFileHunkIds(
  filesByPath: Record<string, FileDiff>,
  filePath: string,
): string[] {
  return filesByPath[filePath]?.hunks.map((h) => h.id) ?? [];
}

/** Collect hunk IDs for all files under the given directory path. */
function getDirHunkIds(
  get: () => { filesByPath: Record<string, FileDiff> },
  dirPath: string,
): string[] {
  const prefix = dirPath + "/";
  const ids: string[] = [];
  for (const [path, fd] of Object.entries(get().filesByPath)) {
    if (!path.startsWith(prefix)) continue;
    for (const h of fd.hunks) ids.push(h.id);
  }
  return ids;
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
      if (!repoPath || !comparison) return;

      const comparisonKey = comparison.key;
      try {
        const state = await client.loadReviewState(repoPath, comparison);
        // Discard result if comparison changed while loading
        if (get().comparison?.key !== comparisonKey) return;
        // Re-read current state after await — it may have been updated
        // by user actions (e.g. setTrustList) while the load was in flight
        const latestState = get().reviewState;
        if (latestState) {
          // Skip if nothing changed
          if (state.updatedAt === latestState.updatedAt) return;
          // Skip if in-memory state is newer (unsaved changes pending)
          if (latestState.updatedAt > state.updatedAt) return;
        }
        ensuredLocalReviews.add(makeReviewKey(repoPath, comparisonKey));
        set({ reviewState: state });
      } catch (err) {
        if (get().comparison?.key !== comparisonKey) return;
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
      let { repoPath, reviewState, comparison, readOnlyPreview } = get();
      if (readOnlyPreview) return;
      if (!repoPath || !reviewState || !comparison) return;
      const hunks = getAllHunksFromState(get());

      // Skip saving if the review file hasn't been created yet and the state
      // is pristine (no human actions). This avoids creating review files for
      // comparisons the user merely clicked on without taking any action.
      const ensureKey = makeReviewKey(repoPath, comparison.key);
      if (!ensuredLocalReviews.has(ensureKey)) {
        const hasHunkActions = Object.values(reviewState.hunks).some(
          (h) => h.status != null,
        );
        const hasNotes = reviewState.notes.length > 0;
        const hasAnnotations =
          reviewState.annotations && reviewState.annotations.length > 0;
        const hasTrustChanges = reviewState.trustList.length > 0;

        if (
          !hasHunkActions &&
          !hasNotes &&
          !hasAnnotations &&
          !hasTrustChanges
        ) {
          return; // Pristine — don't create a review file
        }

        // First meaningful action — ensure review exists on disk
        try {
          await client.ensureReviewExists(repoPath, comparison);
          ensuredLocalReviews.add(ensureKey);
        } catch (err) {
          console.error("Failed to create review file:", err);
        }
      }

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
          const { comparison: currentComparison } = get();
          if (!currentComparison) return;
          const diskState = await client.loadReviewState(
            repoPath,
            currentComparison,
          );
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
      const ids = getFileHunkIds(get().filesByPath, filePath);
      updateHunkStatuses(get, set, ids, "approved");
      get().advanceToNextUnreviewedFile();
    },

    unapproveAllFileHunks: (filePath) => {
      const ids = getFileHunkIds(get().filesByPath, filePath);
      updateHunkStatuses(get, set, ids, undefined, { skipMissing: true });
    },

    rejectAllFileHunks: (filePath) => {
      const ids = getFileHunkIds(get().filesByPath, filePath);
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
      const ids = getFileHunkIds(get().filesByPath, filePath);
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

    setAutoStartGuide: (enabled) => {
      patchReviewState(get, set, {
        guide: { ...get().reviewState?.guide, autoStart: enabled },
      });
    },

    syncTotalDiffHunks: () => {
      const { reviewState, saveReviewState } = get();
      const hunks = getAllHunksFromState(get());
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

      // Persist the corrected totalDiffHunks to disk so it survives app restarts
      debouncedSave(saveReviewState);
    },

    flushSidebarProgress: () => {
      const { reviewState } = get();
      const hunks = getAllHunksFromState(get());
      if (!reviewState || hunks.length === 0) return;
      patchGlobalReviewProgress(get, set, reviewState);
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
      const {
        reviewState,
        repoPath,
        comparison,
        saveReviewState,
        refresh,
        removeGroupingEntry,
      } = get();
      if (!reviewState || !comparison) return;

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

      set({ reviewState: newState });
      if (repoPath) {
        removeGroupingEntry(makeReviewKey(repoPath, comparison.key));
      }
      await saveReviewState();
      await refresh();
    },

    exportRejectionFeedback: () => {
      const { reviewState } = get();
      const hunks = getAllHunksFromState(get());
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
        comparison,
        loadFiles,
        loadAllFiles,
        loadReviewState,
        loadGitStatus,
        refreshCommits,
        classifyStaticHunks,
        loadGlobalReviews,
        checkReviewsFreshness,
      } = get();

      if (!comparison) return;

      // Load data in parallel; pass isRefreshing=true to suppress progress
      // indicators. `loadFiles(true)` writes idempotently and preserves
      // `filesByPath[path]` reference identity for files whose hunks didn't
      // change, so FileViewer subscribers for unaffected files don't re-run.
      const range = getComparisonRange(comparison);
      await Promise.all([
        loadReviewState(),
        loadFiles(true),
        loadAllFiles(true),
        loadGitStatus(),
        loadGlobalReviews(),
        checkReviewsFreshness(),
        repoPath ? refreshCommits(repoPath, range) : Promise.resolve(),
      ]);

      // Run static (rule-based) classification on refresh
      classifyStaticHunks();
      get().restoreGuideFromState();
    },

    applyWatcherEvent: async ({ changedPaths, gitStateChanged }) => {
      const {
        repoPath,
        refresh,
        applyFileWatcherEvent,
        loadGitStatus,
        classifyStaticHunks,
      } = get();

      if (!repoPath) return;

      // Git-state changes (commits, branch switches, stage/unstage) can
      // affect anything — delegate to the full refresh. Idempotent writes
      // in `loadFiles` keep unaffected files from flashing.
      if (gitStateChanged) {
        await refresh();
        return;
      }

      // Working-tree-only edits: only refresh what working-tree edits can
      // actually change. Review state, the global reviews list, and review
      // freshness are not affected by working-tree content (they track
      // SHAs, file metadata, and review-state files in `~/.review/`),
      // so refetching them here was producing re-renders for no gain.
      // Freshness for working-tree comparisons still runs via the
      // watcher's separately-debounced `checkReviewsFreshness` trigger.
      await Promise.all([applyFileWatcherEvent(changedPaths), loadGitStatus()]);

      classifyStaticHunks();
    },
  });
