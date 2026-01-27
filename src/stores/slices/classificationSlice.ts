import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { SliceCreator } from "../types";
import type { ClassifyResponse } from "../../types";

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
    }, 3000);
  };
};

const debouncedAutoClassify = createDebouncedAutoClassify();

// Track current classification generation for cancellation
let classifyGeneration = 0;

export interface ClassificationSlice {
  // Classification state
  claudeAvailable: boolean | null;
  classifying: boolean;
  classificationError: string | null;
  classifyingHunkIds: Set<string>;

  // Actions
  checkClaudeAvailable: () => Promise<void>;
  classifyUnlabeledHunks: (hunkIds?: string[]) => Promise<void>;
  reclassifyHunks: (hunkIds?: string[]) => Promise<void>;
  triggerAutoClassification: () => void;
}

export const createClassificationSlice: SliceCreator<ClassificationSlice> = (
  set,
  get,
) => ({
  claudeAvailable: null,
  classifying: false,
  classificationError: null,
  classifyingHunkIds: new Set<string>(),

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
      saveReviewState,
    } = get();
    if (!repoPath || !reviewState) return;

    // Increment generation for cancellation
    classifyGeneration++;
    const currentGeneration = classifyGeneration;

    const { classifyingHunkIds } = get();

    // Find hunks to classify - filter to specified ids if provided, then filter out already-labeled
    let candidateHunks = hunkIds
      ? hunks.filter((h) => hunkIds.includes(h.id))
      : hunks;

    // Filter out hunks that have already been classified
    let hunksToClassify = candidateHunks.filter((hunk) => {
      const state = reviewState.hunks[hunk.id];
      const hasLabel = state?.label && state.label.length > 0;
      const hasReasoning = !!state?.reasoning;
      return !hasLabel && !hasReasoning;
    });

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

    console.log(
      `[classifyUnlabeledHunks] Classifying ${hunksToClassify.length} hunks`,
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

    // Set up listener for batch completion events
    let unlisten: UnlistenFn | null = null;
    try {
      unlisten = await listen<string[]>("classify:batch-complete", (event) => {
        const completedIds = event.payload;
        console.log(
          `[classifyUnlabeledHunks] Batch complete: ${completedIds.length} hunks`,
        );
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
      const hunkInputs = hunksToClassify.map((hunk) => ({
        id: hunk.id,
        filePath: hunk.filePath,
        content: hunk.content,
      }));

      console.log(
        `[classifyUnlabeledHunks] Calling classify_hunks_with_claude (gen=${currentGeneration})`,
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

      if (unlisten) unlisten();

      console.log(
        `[classifyUnlabeledHunks] Got ${Object.keys(response.classifications).length} classifications`,
      );

      // Check if this classification was cancelled
      if (currentGeneration !== classifyGeneration) {
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

      // Apply classifications
      const newHunks = { ...freshState.hunks };
      for (const [hunkId, classification] of Object.entries(
        response.classifications,
      )) {
        const existingHunk = newHunks[hunkId];
        newHunks[hunkId] = {
          ...existingHunk,
          label: classification.label,
          reasoning: classification.reasoning,
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
      console.log("[classifyUnlabeledHunks] Review state saved");
    } catch (err) {
      if (unlisten) unlisten();

      // Remove only our hunks from the tracking set
      set((state) => {
        const remaining = new Set(state.classifyingHunkIds);
        for (const id of newClassifyingIds) {
          remaining.delete(id);
        }

        if (currentGeneration !== classifyGeneration) {
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
    }
  },

  reclassifyHunks: async (hunkIds) => {
    const { repoPath, hunks, reviewState, saveReviewState } = get();
    if (!repoPath || !reviewState) return;

    // Determine which hunks to reclassify
    const targetHunks = hunkIds
      ? hunks.filter((h) => hunkIds.includes(h.id))
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

  triggerAutoClassification: () => {
    const {
      claudeAvailable,
      autoClassifyEnabled,
      hunks,
      reviewState,
      classifying,
      classifyUnlabeledHunks,
    } = get();

    if (classifying) {
      console.log(
        "[triggerAutoClassification] Already classifying, will reschedule after completion",
      );
      // Don't return - let the debounce handle rescheduling
      // The debounce will wait 3s after this call, by which time the current
      // classification should be done (or the debounce will be called again)
    }

    if (!claudeAvailable || !autoClassifyEnabled || !reviewState) {
      console.log(
        `[triggerAutoClassification] Skipped - claude: ${claudeAvailable}, autoClassify: ${autoClassifyEnabled}`,
      );
      return;
    }

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
      `[triggerAutoClassification] Scheduling classification for ${unclassifiedHunks.length} hunks`,
    );

    debouncedAutoClassify(async () => {
      await classifyUnlabeledHunks();
    });
  },
});
