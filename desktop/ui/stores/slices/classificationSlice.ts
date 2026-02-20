import type { ApiClient } from "../../api";
import { isHunkUnclassified } from "../../types";
import type { SliceCreatorWithClient } from "../types";

export interface ClassificationSlice {
  // Classification state
  classifiedHunkIds: string[] | null;

  // Actions
  classifyStaticHunks: (hunkIds?: string[]) => Promise<void>;
  reclassifyHunks: (hunkIds?: string[]) => Promise<void>;
  isClassificationStale: () => boolean;
}

/** State that must be cleared when switching comparisons. */
export const classificationResetState = {
  classifiedHunkIds: null,
} satisfies Partial<ClassificationSlice>;

/** Filter hunks to a subset if hunkIds are provided, otherwise return all. */
function filterHunks<T extends { id: string }>(
  hunks: T[],
  hunkIds?: string[],
): T[] {
  if (!hunkIds) return hunks;
  const idSet = new Set(hunkIds);
  return hunks.filter((h) => idSet.has(h.id));
}

export const createClassificationSlice: SliceCreatorWithClient<
  ClassificationSlice
> = (client: ApiClient) => (set, get) => ({
  ...classificationResetState,

  classifyStaticHunks: async (hunkIds) => {
    const { hunks, reviewState, saveReviewState, startActivity, endActivity } =
      get();
    if (!reviewState) return;

    const hunksToClassify = filterHunks(hunks, hunkIds).filter((hunk) =>
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

      set({
        classifiedHunkIds: get()
          .hunks.map((h) => h.id)
          .sort(),
      });
    } catch (err) {
      console.warn("[classifyStaticHunks] Static classification failed:", err);
    } finally {
      endActivity("classify-static");
    }
  },

  reclassifyHunks: async (hunkIds) => {
    const { hunks, reviewState, saveReviewState } = get();
    if (!reviewState) return;

    const targetHunks = filterHunks(hunks, hunkIds);

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
    const { classifyStaticHunks } = get();
    await classifyStaticHunks(targetHunks.map((h) => h.id));
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
