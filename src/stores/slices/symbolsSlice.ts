import type { ApiClient } from "../../api";
import type { FileSymbolDiff } from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { flattenFilesWithStatus } from "../types";
import {
  computeSymbolLinkedHunks,
  type SymbolLinkedHunk,
} from "../../utils/symbolLinkedHunks";

/** Singleton empty map -- preserves reference equality to avoid spurious re-renders. */
const EMPTY_SYMBOL_MAP = new Map<string, SymbolLinkedHunk[]>();

export interface SymbolsSlice {
  symbolDiffs: FileSymbolDiff[];
  symbolsLoading: boolean;
  symbolsLoaded: boolean;
  loadSymbols: () => Promise<void>;
  clearSymbols: () => void;

  /** Map from hunk ID → symbol-linked hunks (definition ↔ reference connections) */
  symbolLinkedHunks: Map<string, SymbolLinkedHunk[]>;
}

/** State that must be cleared when switching comparisons. */
export const symbolsResetState = {
  symbolDiffs: [],
  symbolsLoading: false,
  symbolsLoaded: false,
  symbolLinkedHunks: EMPTY_SYMBOL_MAP,
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
            symbolLinkedHunks: EMPTY_SYMBOL_MAP,
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
          symbolLinkedHunks: computeSymbolLinkedHunks(results),
          symbolsLoading: false,
          symbolsLoaded: true,
        });
      } catch (err) {
        console.error("Failed to load symbols:", err);
        set({
          symbolDiffs: [],
          symbolLinkedHunks: EMPTY_SYMBOL_MAP,
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
        symbolLinkedHunks: EMPTY_SYMBOL_MAP,
        symbolsLoaded: false,
      });
    },
  });
