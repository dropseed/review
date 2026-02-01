import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";

export interface NarrativeSlice {
  narrativeGenerating: boolean;
  narrativeError: string | null;
  isNarrativeStale: () => boolean;
  narrativeFileOverlap: () => number;
  isNarrativeIrrelevant: () => boolean;
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

    narrativeFileOverlap: () => {
      const { reviewState, hunks } = get();
      const narrative = reviewState?.narrative;
      if (!narrative) return 1;

      const narrativeFilePaths = new Set(
        narrative.hunkIds.map((id) => id.substring(0, id.lastIndexOf(":"))),
      );
      if (narrativeFilePaths.size === 0) return 1;

      const currentFilePaths = new Set(hunks.map((h) => h.filePath));

      let overlap = 0;
      for (const fp of narrativeFilePaths) {
        if (currentFilePaths.has(fp)) overlap++;
      }

      return overlap / narrativeFilePaths.size;
    },

    isNarrativeIrrelevant: () => {
      const { reviewState, isNarrativeStale, narrativeFileOverlap } = get();
      const narrative = reviewState?.narrative;
      if (!narrative) return false;

      return isNarrativeStale() && narrativeFileOverlap() < 0.5;
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
