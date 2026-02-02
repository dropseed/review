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

export const createSymbolsSlice: SliceCreatorWithClient<SymbolsSlice> =
  (client: ApiClient) => (set, get) => ({
    symbolDiffs: [],
    symbolsLoading: false,
    symbolsLoaded: false,

    loadSymbols: async () => {
      const { repoPath, comparison, files, symbolsLoading } = get();
      if (!repoPath || symbolsLoading) return;

      set({ symbolsLoading: true });

      try {
        const changedPaths = flattenFilesWithStatus(files)
          .filter((f) => f.status !== "deleted")
          .map((f) => f.path);

        if (changedPaths.length === 0) {
          set({ symbolDiffs: [], symbolsLoading: false, symbolsLoaded: true });
          return;
        }

        const results = await client.getFileSymbolDiffs(
          repoPath,
          changedPaths,
          comparison,
        );
        set({
          symbolDiffs: results,
          symbolsLoading: false,
          symbolsLoaded: true,
        });
      } catch (err) {
        console.error("Failed to load symbols:", err);
        set({ symbolDiffs: [], symbolsLoading: false, symbolsLoaded: true });
      }
    },

    clearSymbols: () => {
      set({ symbolDiffs: [], symbolsLoaded: false });
    },
  });
