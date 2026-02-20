import type { ApiClient } from "../../api";
import type { FileSymbolDiff } from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { flattenFilesWithStatus } from "../types";

export interface SymbolsSlice {
  symbolDiffs: FileSymbolDiff[];
  symbolsLoading: boolean;
  symbolsLoaded: boolean;
  loadSymbols: () => Promise<void>;
  clearSymbols: () => void;
}

/** State that must be cleared when switching comparisons. */
export const symbolsResetState = {
  symbolDiffs: [],
  symbolsLoading: false,
  symbolsLoaded: false,
} satisfies Partial<SymbolsSlice>;

export const createSymbolsSlice: SliceCreatorWithClient<SymbolsSlice> =
  (client: ApiClient) => (set, get) => ({
    ...symbolsResetState,

    loadSymbols: async () => {
      const {
        repoPath,
        comparison,
        files,
        symbolsLoading,
        startActivity,
        endActivity,
      } = get();
      if (!repoPath || symbolsLoading) return;

      const comparisonKey = comparison.key;
      set({ symbolsLoading: true });
      startActivity("load-symbols", "Building symbols", 40);

      try {
        const changedPaths = flattenFilesWithStatus(files)
          .filter((f) => f.status !== "deleted")
          .map((f) => f.path);

        if (changedPaths.length === 0) {
          set({
            symbolDiffs: [],
            symbolsLoading: false,
            symbolsLoaded: true,
          });
          return;
        }

        const results = await client.getFileSymbolDiffs(
          repoPath,
          changedPaths,
          comparison,
        );

        // Don't update state if comparison changed while awaiting
        if (get().comparison.key !== comparisonKey) {
          set({ symbolsLoading: false });
          return;
        }

        set({
          symbolDiffs: results,
          symbolsLoading: false,
          symbolsLoaded: true,
        });
      } catch (err) {
        console.error("Failed to load symbols:", err);
        set({
          symbolDiffs: [],
          symbolsLoading: false,
          symbolsLoaded: true,
        });
      } finally {
        endActivity("load-symbols");
      }
    },

    clearSymbols: () => {
      set({
        symbolDiffs: [],
        symbolsLoaded: false,
      });
    },
  });
