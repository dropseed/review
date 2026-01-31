import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";

export interface NarrativeSlice {
  narrativeGenerating: boolean;
  narrativeError: string | null;
  isNarrativeStale: () => boolean;
  generateNarrative: () => Promise<void>;
  clearNarrative: () => void;
}

export const createNarrativeSlice: SliceCreatorWithClient<NarrativeSlice> =
  (client: ApiClient) => (set, get) => ({
    narrativeGenerating: false,
    narrativeError: null,

    isNarrativeStale: () => {
      const { reviewState, hunks } = get();
      const narrative = reviewState?.narrative;
      if (!narrative) return false;

      const storedIds = new Set(narrative.hunkIds);
      const currentIds = new Set(hunks.map((h) => h.id));

      if (storedIds.size !== currentIds.size) return true;
      for (const id of storedIds) {
        if (!currentIds.has(id)) return true;
      }
      return false;
    },

    generateNarrative: async () => {
      const { repoPath, hunks, reviewState, classifyCommand, saveReviewState } =
        get();
      if (!repoPath || !reviewState) return;
      if (hunks.length === 0) return;

      set({ narrativeGenerating: true, narrativeError: null });

      try {
        const narrativeInputs = hunks.map((hunk) => ({
          id: hunk.id,
          filePath: hunk.filePath,
          content: hunk.content,
        }));

        const content = await client.generateNarrative(
          repoPath,
          narrativeInputs,
          { command: classifyCommand || undefined },
        );

        const currentState = get().reviewState;
        if (!currentState) return;

        const updatedState = {
          ...currentState,
          narrative: {
            content,
            hunkIds: hunks.map((h) => h.id).sort(),
            generatedAt: new Date().toISOString(),
          },
          updatedAt: new Date().toISOString(),
        };

        set({ reviewState: updatedState, narrativeGenerating: false });
        await saveReviewState();
      } catch (err) {
        console.error("[generateNarrative] Failed:", err);
        set({
          narrativeGenerating: false,
          narrativeError: err instanceof Error ? err.message : String(err),
        });
      }
    },

    clearNarrative: () => {
      const { reviewState, saveReviewState } = get();
      if (!reviewState) return;

      const updatedState = {
        ...reviewState,
        narrative: undefined,
        updatedAt: new Date().toISOString(),
      };

      set({ reviewState: updatedState });
      saveReviewState();
    },
  });
