import type { ApiClient } from "../../api";
import { isHunkUnclassified } from "../../types";
import type { SliceCreatorWithClient } from "../types";

/** Singleton empty set -- preserves reference equality to avoid spurious re-renders. */
export const EMPTY_CLASSIFYING_SET = new Set<string>();

export interface ClassificationSlice {
  // Classification state
  claudeAvailable: boolean | null;
  classifying: boolean;
  classificationError: string | null;
  classifyingHunkIds: Set<string>;
  // Track current classification generation for cancellation (moved into slice to avoid race conditions)
  classifyGeneration: number;
  // Track which hunk IDs were present when classification last ran
  classifiedHunkIds: string[] | null;

  // Actions
  checkClaudeAvailable: () => Promise<void>;
  classifyStaticHunks: (hunkIds?: string[]) => Promise<void>;
  classifyUnlabeledHunks: (hunkIds?: string[]) => Promise<void>;
  reclassifyHunks: (hunkIds?: string[]) => Promise<void>;
  isClassificationStale: () => boolean;
}

/** State that must be cleared when switching comparisons (excludes claudeAvailable which is global). */
export const classificationResetState = {
  classifying: false,
  classificationError: null,
  classifyingHunkIds: EMPTY_CLASSIFYING_SET,
  classifiedHunkIds: null,
} satisfies Partial<ClassificationSlice>;

export const createClassificationSlice: SliceCreatorWithClient<
  ClassificationSlice
> = (client: ApiClient) => (set, get) => ({
  claudeAvailable: null,
  ...classificationResetState,
  classifyGeneration: 0,

  checkClaudeAvailable: async () => {
    try {
      const available = await client.checkClaudeAvailable();
      set({ claudeAvailable: available });
    } catch (err) {
      console.error("Failed to check Claude availability:", err);
      set({ claudeAvailable: false });
    }
  },

  classifyStaticHunks: async (hunkIds) => {
    const { hunks, reviewState, saveReviewState, startActivity, endActivity } =
      get();
    if (!reviewState) return;

    // Find unlabeled hunks
    const hunkIdSet = hunkIds ? new Set(hunkIds) : null;
    const candidateHunks = hunkIdSet
      ? hunks.filter((h) => hunkIdSet.has(h.id))
      : hunks;

    const hunksToClassify = candidateHunks.filter((hunk) =>
      isHunkUnclassified(reviewState.hunks[hunk.id]),
    );

    if (hunksToClassify.length === 0) return;

    startActivity("classify-static", "Classifying hunks", 50);
    try {
      const staticResponse = await client.classifyHunksStatic(hunksToClassify);
      const staticCount = Object.keys(staticResponse.classifications).length;

      if (staticCount > 0) {
        console.log(
          `[classifyStaticHunks] Static classifier matched ${staticCount} hunks`,
        );

        const currentState = get().reviewState;
        if (currentState) {
          const updatedHunks = { ...currentState.hunks };
          for (const [hunkId, classification] of Object.entries(
            staticResponse.classifications,
          )) {
            updatedHunks[hunkId] = {
              ...updatedHunks[hunkId],
              label: classification.label,
              reasoning: classification.reasoning,
              classifiedVia: "static",
            };
          }

          const updatedState = {
            ...currentState,
            hunks: updatedHunks,
            updatedAt: new Date().toISOString(),
          };

          set({ reviewState: updatedState });
          await saveReviewState();
        }
      }
    } catch (err) {
      console.warn("[classifyStaticHunks] Static classification failed:", err);
    } finally {
      endActivity("classify-static");
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
      saveReviewState,
      classifyGeneration,
      startActivity,
      updateActivity,
      endActivity,
    } = get();
    if (!repoPath || !reviewState) return;

    // Increment generation for cancellation
    const newGeneration = classifyGeneration + 1;
    set({ classifyGeneration: newGeneration });
    const currentGeneration = newGeneration;

    const { classifyingHunkIds } = get();

    // Find hunks to classify - filter to specified ids if provided, then filter out already-labeled
    const hunkIdSet = hunkIds ? new Set(hunkIds) : null;
    const candidateHunks = hunkIdSet
      ? hunks.filter((h) => hunkIdSet.has(h.id))
      : hunks;

    // Filter out hunks that have already been classified (have labels or were processed)
    let hunksToClassify = candidateHunks.filter((hunk) =>
      isHunkUnclassified(reviewState.hunks[hunk.id]),
    );

    const alreadyClassifiedCount =
      candidateHunks.length - hunksToClassify.length;
    if (alreadyClassifiedCount > 0) {
      console.log(
        `[classifyUnlabeledHunks] Skipping ${alreadyClassifiedCount} already-classified hunks`,
      );
    }

    // Filter out hunks that are currently being classified
    const inFlightCount = hunksToClassify.filter((h) =>
      classifyingHunkIds.has(h.id),
    ).length;
    if (inFlightCount > 0) {
      console.log(
        `[classifyUnlabeledHunks] Skipping ${inFlightCount} hunks already being classified`,
      );
      hunksToClassify = hunksToClassify.filter(
        (h) => !classifyingHunkIds.has(h.id),
      );
    }

    if (hunksToClassify.length === 0) {
      console.log("[classifyUnlabeledHunks] No unclassified hunks to classify");
      if (!hunkIds) {
        set({ classificationError: "All hunks already classified" });
      }
      return;
    }

    // --- Static classification pre-pass ---
    startActivity("classify-static", "Classifying hunks", 50);
    try {
      const staticResponse = await client.classifyHunksStatic(hunksToClassify);
      const staticIds = new Set(Object.keys(staticResponse.classifications));
      const skippedIds = new Set(staticResponse.skippedHunkIds ?? []);

      if (staticIds.size > 0) {
        console.log(
          `[classifyUnlabeledHunks] Static classifier matched ${staticIds.size} hunks`,
        );
      }
      if (skippedIds.size > 0) {
        console.log(
          `[classifyUnlabeledHunks] Skipping ${skippedIds.size} hunks (unlikely to match AI labels)`,
        );
      }

      // Apply static classifications and mark skipped hunks in review state
      const handledIds = new Set([...staticIds, ...skippedIds]);
      if (handledIds.size > 0) {
        const currentState = get().reviewState;
        if (currentState) {
          const updatedHunks = { ...currentState.hunks };

          for (const hunkId of handledIds) {
            const classification = staticResponse.classifications[hunkId];
            const existing = updatedHunks[hunkId];
            updatedHunks[hunkId] = {
              ...existing,
              label: classification?.label ?? existing?.label ?? [],
              reasoning: classification?.reasoning,
              classifiedVia: "static",
            };
          }

          set({
            reviewState: {
              ...currentState,
              hunks: updatedHunks,
              updatedAt: new Date().toISOString(),
            },
          });
          await saveReviewState();
        }

        // Remove classified and skipped hunks from AI candidates
        hunksToClassify = hunksToClassify.filter((h) => !handledIds.has(h.id));

        if (hunksToClassify.length === 0) {
          console.log(
            "[classifyUnlabeledHunks] All hunks classified by static rules or skipped",
          );
          return;
        }
      }
    } catch (err) {
      console.warn(
        "[classifyUnlabeledHunks] Static classification failed, falling through to AI:",
        err,
      );
    } finally {
      endActivity("classify-static");
    }

    console.log(
      `[classifyUnlabeledHunks] Classifying ${hunksToClassify.length} hunks with AI`,
    );

    const newClassifyingIds = hunksToClassify.map((h) => h.id);
    set((state) => ({
      classifying: true,
      classificationError: null,
      classifyingHunkIds: new Set([
        ...state.classifyingHunkIds,
        ...newClassifyingIds,
      ]),
    }));

    const aiTotal = hunksToClassify.length;
    let aiCompleted = 0;
    startActivity("classify-ai", "Classifying hunks", 60);
    updateActivity("classify-ai", { current: 0, total: aiTotal });

    // Set up listener for batch completion events
    const unlisten = client.onClassifyProgress((completedIds) => {
      console.log(
        `[classifyUnlabeledHunks] Batch complete: ${completedIds.length} hunks`,
      );
      aiCompleted += completedIds.length;
      updateActivity("classify-ai", { current: aiCompleted, total: aiTotal });
      set((state) => {
        const newSet = new Set(state.classifyingHunkIds);
        for (const id of completedIds) {
          newSet.delete(id);
        }
        return { classifyingHunkIds: newSet };
      });
    });

    try {
      const hunkInputs = hunksToClassify.map((hunk) => ({
        id: hunk.id,
        filePath: hunk.filePath,
        content: hunk.content,
      }));

      console.log(
        `[classifyUnlabeledHunks] Calling classifyHunks (gen=${currentGeneration})`,
      );

      const response = await client.classifyHunks(repoPath, hunkInputs, {
        command: classifyCommand || undefined,
        batchSize: classifyBatchSize,
        maxConcurrent: classifyMaxConcurrent,
      });

      console.log(
        `[classifyUnlabeledHunks] Got ${Object.keys(response.classifications).length} classifications`,
      );

      // Check if this classification was cancelled
      if (currentGeneration !== get().classifyGeneration) {
        console.log("[classifyUnlabeledHunks] Cancelled - stale generation");
        // Remove only our hunks from the tracking set
        set((state) => {
          const remaining = new Set(state.classifyingHunkIds);
          for (const id of newClassifyingIds) {
            remaining.delete(id);
          }
          return {
            classifying: remaining.size > 0,
            classifyingHunkIds: remaining,
          };
        });
        return;
      }

      // Get fresh review state
      const freshState = get().reviewState;
      if (!freshState) return;

      // Apply classifications — mark ALL hunks that were sent to AI,
      // not just those with results, so they won't be retried.
      const newHunks = { ...freshState.hunks };
      for (const id of newClassifyingIds) {
        const classification = response.classifications[id];
        const existing = newHunks[id];
        newHunks[id] = {
          ...existing,
          label: classification?.label ?? existing?.label ?? [],
          reasoning: classification?.reasoning,
          classifiedVia: "ai",
        };
      }

      const newState = {
        ...freshState,
        hunks: newHunks,
        updatedAt: new Date().toISOString(),
      };

      // Remove only our hunks from the tracking set
      set((state) => {
        const remaining = new Set(state.classifyingHunkIds);
        for (const id of newClassifyingIds) {
          remaining.delete(id);
        }
        return {
          reviewState: newState,
          classifying: remaining.size > 0,
          classifyingHunkIds: remaining,
        };
      });

      await saveReviewState();
      set({
        classifiedHunkIds: get()
          .hunks.map((h) => h.id)
          .sort(),
      });
      console.log("[classifyUnlabeledHunks] Review state saved");
    } catch (err) {
      // Remove only our hunks from the tracking set
      set((state) => {
        const remaining = new Set(state.classifyingHunkIds);
        for (const id of newClassifyingIds) {
          remaining.delete(id);
        }

        if (currentGeneration !== get().classifyGeneration) {
          return {
            classifying: remaining.size > 0,
            classifyingHunkIds: remaining,
          };
        }

        console.error("[classifyUnlabeledHunks] Classification failed:", err);
        return {
          classifying: remaining.size > 0,
          classifyingHunkIds: remaining,
          classificationError: err instanceof Error ? err.message : String(err),
        };
      });
    } finally {
      unlisten();
      endActivity("classify-ai");
    }
  },

  reclassifyHunks: async (hunkIds) => {
    const { repoPath, hunks, reviewState, saveReviewState } = get();
    if (!repoPath || !reviewState) return;

    // Determine which hunks to reclassify
    const hunkIdSet = hunkIds ? new Set(hunkIds) : null;
    const targetHunks = hunkIdSet
      ? hunks.filter((h) => hunkIdSet.has(h.id))
      : hunks;

    if (targetHunks.length === 0) return;

    console.log(
      `[reclassifyHunks] Clearing labels for ${targetHunks.length} hunks`,
    );

    // Clear existing labels/reasoning for these hunks
    const newHunks = { ...reviewState.hunks };
    for (const hunk of targetHunks) {
      if (newHunks[hunk.id]) {
        newHunks[hunk.id] = {
          ...newHunks[hunk.id],
          label: [],
          reasoning: undefined,
          classifiedVia: undefined,
        };
      }
    }

    const newState = {
      ...reviewState,
      hunks: newHunks,
      updatedAt: new Date().toISOString(),
    };

    set({ reviewState: newState });
    await saveReviewState();

    // Now classify them (they're now "unlabeled")
    const { classifyUnlabeledHunks } = get();
    await classifyUnlabeledHunks(targetHunks.map((h) => h.id));
  },

  isClassificationStale: () => {
    const { classifiedHunkIds, hunks } = get();
    if (!classifiedHunkIds) return false;

    const currentIds = hunks.map((h) => h.id).sort();
    if (classifiedHunkIds.length !== currentIds.length) return true;
    for (let i = 0; i < classifiedHunkIds.length; i++) {
      if (classifiedHunkIds[i] !== currentIds[i]) return true;
    }
    return false;
  },
});
