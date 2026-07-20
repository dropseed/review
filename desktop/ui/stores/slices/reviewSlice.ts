import type { ApiClient } from "../../api";
import {
  attributed,
  type FileDiff,
  type GlobalReviewSummary,
  type HunkRisk,
  type HunkState,
  type HunkStatusValue,
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

// Per-window counter that disambiguates IDs created in the same millisecond.
// Combined with the `t` prefix on the epoch segment, this guarantees the
// trailing token has at least one non-hex char so `parse_hunk_target`
// (Rust CLI) won't ever misclassify a comment ID as a hunk hash.
let annotationIdCounter = 0;
function newAnnotationId(
  filePath: string,
  lineNumber: number,
  side: "old" | "new" | "file",
): string {
  const epoch = Date.now();
  const c = annotationIdCounter++;
  return `${filePath}:${lineNumber}:${side}:t${epoch}-${c}`;
}

export function shouldIgnoreReviewStateReload(): boolean {
  return Date.now() - lastSaveTimestamp < SAVE_GRACE_PERIOD_MS;
}

// Track which local-source reviews have already had their file created on disk,
// so we don't call ensureReviewExists on every debounced save.
const ensuredLocalReviews = new Set<string>();

/**
 * Forget that a review's file exists on disk. Call this when a review is
 * deleted: otherwise the key lingers, the pristine-save guard in
 * `saveReviewState` is skipped, and a stray save (e.g. classification after a
 * refresh) silently re-creates the just-deleted review file.
 */
export function forgetEnsuredReview(key: string): void {
  ensuredLocalReviews.delete(key);
}

export interface ReviewSlice {
  // Review state
  reviewState: ReviewState | null;
  savedReviews: ReviewSummary[];
  savedReviewsLoading: boolean;
  // How many decisions the last load carried forward onto a drifted diff.
  // Transient — surfaced as a banner, cleared on dismiss or next clean load.
  carriedForward: number;

  // Actions
  setReviewState: (state: ReviewState) => void;
  dismissCarriedForward: () => void;

  // Persistence
  loadReviewState: () => Promise<void>;
  // Carry persisted decisions forward onto the loaded diff (call after the
  // hunks are loaded); updates carriedForward for the banner.
  reconcileReviewState: () => Promise<void>;
  saveReviewState: () => Promise<void>;
  loadSavedReviews: () => Promise<void>;
  deleteReview: (ref: string) => Promise<void>;

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

  // Risk actions
  setHunkRisk: (hunkId: string, risk: HunkRisk) => void;
  clearHunkRisk: (hunkId: string) => void;
  /** Set (or clear, when null) the risk on a set of hunks in one action. */
  setRiskForHunks: (hunkIds: string[], risk: HunkRisk | null) => void;

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
  resolveAnnotation: (annotationId: string) => void;
  unresolveAnnotation: (annotationId: string) => void;
  resolveAllAnnotations: () => void;
  deleteResolvedAnnotations: () => void;
  getAnnotationsForFile: (filePath: string) => LineAnnotation[];

  // Auto-approve staged
  setAutoApproveStaged: (enabled: boolean) => void;

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
    reviewRef: string | null;
    filesByPath: Record<string, FileDiff>;
    flatFileList: string[];
    globalReviews: GlobalReviewSummary[];
  },
  set: (partial: { globalReviews: GlobalReviewSummary[] }) => void,
  reviewState: ReviewState,
): void {
  const state = get();
  const { repoPath, reviewRef, globalReviews } = state;
  if (!repoPath || !reviewRef) return;

  const progress = computeReviewProgress(
    getAllHunksFromState(state),
    reviewState,
  );
  const patched = globalReviews.map((r) => {
    if (r.repoPath === repoPath && r.ref === reviewRef) {
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
  status: HunkStatusValue | undefined,
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
        status: attributed(status, "ui"),
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

/**
 * Merge a partial HunkState into a single hunk entry and trigger a debounced
 * save. The shared shape behind setHunkLabel / setHunkRisk / clearHunkRisk —
 * each axis of the attributed model patches one field the same way.
 */
function patchHunk(
  get: () => {
    reviewState: ReviewState | null;
    saveReviewState: () => Promise<void>;
  },
  set: (partial: { reviewState: ReviewState }) => void,
  hunkId: string,
  partial: Partial<HunkState>,
): void {
  const { reviewState } = get();
  if (!reviewState) return;
  patchReviewState(get, set, {
    hunks: {
      ...reviewState.hunks,
      [hunkId]: { ...reviewState.hunks[hunkId], ...partial },
    },
  });
}

export const createReviewSlice: SliceCreatorWithClient<ReviewSlice> =
  (client: ApiClient) => (set, get) => ({
    reviewState: null,
    savedReviews: [],
    savedReviewsLoading: false,
    carriedForward: 0,

    setReviewState: (state) => set({ reviewState: state }),
    dismissCarriedForward: () => set({ carriedForward: 0 }),

    loadReviewState: async () => {
      const { repoPath, comparison, reviewRef, reviewBaseOverride } = get();
      if (!repoPath || !comparison || !reviewRef) return;

      // Diff-currency guard: discard the load if the resolved comparison
      // changed (ref switch or base-override) while it was in flight.
      const comparisonKey = comparison.key;
      try {
        const state = await client.loadReviewState(repoPath, reviewRef);
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
        ensuredLocalReviews.add(makeReviewKey(repoPath, reviewRef));
        set({ reviewState: state });
      } catch (err) {
        if (get().comparison?.key !== comparisonKey) return;
        console.error("Failed to load review state:", err);
        set({
          carriedForward: 0,
          reviewState: {
            ref: reviewRef,
            baseOverride: reviewBaseOverride ?? undefined,
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

    reconcileReviewState: async () => {
      const { repoPath, comparison, reviewState } = get();
      if (!repoPath || !comparison || !reviewState) return;
      // Nothing to carry forward without recorded decisions or a loaded diff.
      if (Object.keys(reviewState.hunks).length === 0) return;
      const hunks = getAllHunksFromState(get());
      if (hunks.length === 0) return;

      const comparisonKey = comparison.key;
      try {
        const { state, carriedForward } = await client.reconcileReviewState(
          reviewState,
          hunks,
        );
        // Discard if the comparison changed, or the user touched the review
        // while reconciliation was in flight (avoid clobbering newer edits).
        if (get().comparison?.key !== comparisonKey) return;
        if (get().reviewState?.updatedAt !== reviewState.updatedAt) return;
        set({ reviewState: state, carriedForward });
      } catch (err) {
        console.error("Failed to reconcile review state:", err);
      }
    },

    saveReviewState: async () => {
      let {
        repoPath,
        reviewState,
        comparison,
        reviewRef,
        reviewBaseOverride,
        readOnlyPreview,
      } = get();
      if (readOnlyPreview) return;
      if (!repoPath || !reviewState || !comparison || !reviewRef) return;

      // Skip saving if the review file hasn't been created yet and the state
      // is pristine (no human actions). This avoids creating review files for
      // reviews the user merely clicked on without taking any action.
      const ensureKey = makeReviewKey(repoPath, reviewRef);
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
          await client.ensureReviewExists(
            repoPath,
            reviewRef,
            reviewBaseOverride ?? undefined,
          );
          ensuredLocalReviews.add(ensureKey);
        } catch (err) {
          console.error("Failed to create review file:", err);
        }
      }

      // Defense-in-depth: skip save if this review state belongs to a
      // different review (catches races where a stale debounced save fires
      // after switching).
      if (reviewState.ref !== reviewRef) return;

      // Computed only once we know there's something to save (skips the walk for
      // pristine reviews that returned above).
      const hunks = getAllHunksFromState(get());

      // Ensure totalDiffHunks is set from the actual diff hunk count
      if (hunks.length > 0 && reviewState.totalDiffHunks !== hunks.length) {
        reviewState = { ...reviewState, totalDiffHunks: hunks.length };
        set({ reviewState });
      }

      const saveAndUpdateVersion = async (
        state: ReviewState,
      ): Promise<void> => {
        // Only reconcile against the diff when we actually have it loaded —
        // passing an empty list would orphan every decision against zero hunks.
        const newVersion = await client.saveReviewState(
          repoPath,
          state,
          hunks.length > 0 ? hunks : undefined,
        );
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
          const { reviewRef: currentRef } = get();
          if (!currentRef) return;
          const diskState = await client.loadReviewState(repoPath, currentRef);
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
        // Guard against a stale response: if the repo changed while this
        // request was in flight, don't clobber the new repo's reviews.
        if (get().repoPath !== repoPath) return;
        set({ savedReviews: reviews, savedReviewsLoading: false });
      } catch (err) {
        console.error("Failed to load saved reviews:", err);
        if (get().repoPath !== repoPath) return;
        set({ savedReviews: [], savedReviewsLoading: false });
      }
    },

    deleteReview: async (ref) => {
      const { repoPath, loadSavedReviews } = get();
      if (!repoPath) return;

      try {
        await client.deleteReview(repoPath, ref);
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
      const labels = Array.isArray(label) ? label : [label];
      patchHunk(get, set, hunkId, { classification: attributed(labels, "ui") });
    },

    setHunkRisk: (hunkId, risk) => get().setRiskForHunks([hunkId], risk),

    clearHunkRisk: (hunkId) => get().setRiskForHunks([hunkId], null),

    setRiskForHunks: (hunkIds, risk) => {
      const { reviewState } = get();
      if (!reviewState || hunkIds.length === 0) return;
      const newHunks = { ...reviewState.hunks };
      for (const id of hunkIds) {
        if (risk === null) {
          if (!newHunks[id]) continue;
          newHunks[id] = { ...newHunks[id], risk: undefined };
        } else {
          newHunks[id] = { ...newHunks[id], risk: attributed(risk, "ui") };
        }
      }
      patchReviewState(get, set, { hunks: newHunks });
    },

    setReviewNotes: (notes) => {
      patchReviewState(get, set, { notes });
    },

    addAnnotation: (filePath, lineNumber, side, content, endLineNumber?) => {
      const { reviewState, saveReviewState, gitUser } = get();
      if (!reviewState) return "";

      const id = newAnnotationId(filePath, lineNumber, side);
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
        ...(gitUser ? { author: gitUser } : {}),
        source: "ui",
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

      const now = new Date().toISOString();
      const annotations = (reviewState.annotations ?? []).map((a) =>
        a.id === annotationId ? { ...a, content, updatedAt: now } : a,
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

    resolveAnnotation: (annotationId) => {
      const { reviewState, gitUser } = get();
      if (!reviewState) return;
      const now = new Date().toISOString();
      const annotations = (reviewState.annotations ?? []).map((a) =>
        a.id === annotationId
          ? {
              ...a,
              resolvedAt: now,
              ...(gitUser ? { resolvedBy: gitUser } : {}),
            }
          : a,
      );
      patchReviewState(get, set, { annotations });
    },

    unresolveAnnotation: (annotationId) => {
      const { reviewState } = get();
      if (!reviewState) return;
      const annotations = (reviewState.annotations ?? []).map((a) => {
        if (a.id !== annotationId) return a;
        const next = { ...a };
        delete next.resolvedAt;
        delete next.resolvedBy;
        return next;
      });
      patchReviewState(get, set, { annotations });
    },

    resolveAllAnnotations: () => {
      const { reviewState, gitUser } = get();
      if (!reviewState) return;
      const now = new Date().toISOString();
      const annotations = (reviewState.annotations ?? []).map((a) =>
        a.resolvedAt
          ? a
          : {
              ...a,
              resolvedAt: now,
              ...(gitUser ? { resolvedBy: gitUser } : {}),
            },
      );
      patchReviewState(get, set, { annotations });
    },

    deleteResolvedAnnotations: () => {
      const { reviewState } = get();
      if (!reviewState) return;
      const annotations = (reviewState.annotations ?? []).filter(
        (a) => !a.resolvedAt,
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
      const { reviewState } = get();
      // "Clear feedback" only wipes the human's own unresolved UI-authored
      // comments plus the notes. Preserve: resolved annotations (audit
      // trail), comments from other sources (agent / cli / imported PR
      // review comments), and legacy annotations with no `source` field —
      // those predate authorship tracking and must not be silently lost.
      const keep = (reviewState?.annotations ?? []).filter(
        (a) => a.resolvedAt || a.source !== "ui",
      );
      patchReviewState(get, set, { notes: "", annotations: keep });
    },

    resetReview: async () => {
      const {
        reviewState,
        repoPath,
        reviewRef,
        saveReviewState,
        refresh,
        removeGroupingEntry,
      } = get();
      if (!reviewState || !reviewRef) return;

      const now = new Date().toISOString();
      const newState: ReviewState = {
        ref: reviewState.ref,
        baseOverride: reviewState.baseOverride ?? undefined,
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
        removeGroupingEntry(makeReviewKey(repoPath, reviewRef));
      }
      await saveReviewState();
      await refresh();
    },

    exportRejectionFeedback: () => {
      const { reviewState, comparison } = get();
      const hunks = getAllHunksFromState(get());
      if (!reviewState || !comparison) return null;

      const rejections: RejectionFeedback["rejections"] = [];
      for (const [hunkId, hunkState] of Object.entries(reviewState.hunks)) {
        if (hunkState.status?.value === "rejected") {
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
        comparison,
        exportedAt: new Date().toISOString(),
        rejections,
      };
    },

    refresh: async () => {
      const {
        comparison,
        loadFiles,
        loadAllFiles,
        loadReviewState,
        reconcileReviewState,
        loadGitStatus,
        classifyStaticHunks,
        loadGlobalReviews,
        checkReviewsFreshness,
      } = get();

      if (!comparison) return;

      // Load data in parallel; pass isRefreshing=true to suppress progress
      // indicators. `loadFiles(true)` writes idempotently and preserves
      // `filesByPath[path]` reference identity for files whose hunks didn't
      // change, so FileViewer subscribers for unaffected files don't re-run.
      await Promise.all([
        loadReviewState(),
        loadFiles(true),
        loadAllFiles(true),
        loadGitStatus(),
        loadGlobalReviews(),
        checkReviewsFreshness(),
      ]);

      // Carry decisions forward onto the refreshed diff (drift is most likely
      // here, e.g. after a working-tree change).
      await reconcileReviewState();

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
