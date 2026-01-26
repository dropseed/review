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
    }, 1500);
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

    // Find hunks to classify - filter to specified ids if provided, then filter out already-labeled
    let candidateHunks = hunkIds
      ? hunks.filter((h) => hunkIds.includes(h.id))
      : hunks;

    // Always filter out hunks that have already been classified
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

    const classifyingIds = new Set(hunksToClassify.map((h) => h.id));
    set({
      classifying: true,
      classificationError: null,
      classifyingHunkIds: classifyingIds,
    });

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
        set({ classifying: false, classifyingHunkIds: new Set<string>() });
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

      set({
        reviewState: newState,
        classifying: false,
        classifyingHunkIds: new Set<string>(),
      });

      await saveReviewState();
      console.log("[classifyUnlabeledHunks] Review state saved");
    } catch (err) {
      if (unlisten) unlisten();

      if (currentGeneration !== classifyGeneration) {
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
      classifyUnlabeledHunks,
    } = get();

    if (classifying) {
      console.log("[triggerAutoClassification] Already classifying, skipping");
      return;
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
