import type { SliceCreatorWithClient } from "../types";
import type { ApiClient } from "../../api";
import type { SearchMatch } from "../../types";
import { getAllHunksFromState } from "../selectors/hunks";

export type SearchMode = "text" | "symbols";

export interface SearchSlice {
  // Search state
  searchQuery: string;
  searchResults: SearchMatch[];
  searchLoading: boolean;
  searchError: string | null;
  searchCaseSensitive: boolean;
  searchMode: SearchMode;
  searchVerifiedOnly: boolean;

  // Actions
  setSearchQuery: (query: string) => void;
  setSearchCaseSensitive: (value: boolean) => void;
  setSearchMode: (mode: SearchMode) => void;
  setSearchVerifiedOnly: (value: boolean) => void;
  performSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
  clearSearchResults: () => void;
  navigateToSearchResult: (match: SearchMatch) => void;
}

export const createSearchSlice: SliceCreatorWithClient<SearchSlice> =
  (client: ApiClient) => (set, get) => ({
    searchQuery: "",
    searchResults: [],
    searchLoading: false,
    searchError: null,
    searchCaseSensitive: false,
    searchMode: "text",
    searchVerifiedOnly: false,

    setSearchQuery: (query) => set({ searchQuery: query }),
    setSearchCaseSensitive: (value) => set({ searchCaseSensitive: value }),
    setSearchMode: (mode) => set({ searchMode: mode }),
    setSearchVerifiedOnly: (value) => set({ searchVerifiedOnly: value }),

    performSearch: async (query) => {
      const { repoPath, searchCaseSensitive } = get();
      if (!repoPath || !query.trim()) {
        set({ searchResults: [], searchLoading: false, searchError: null });
        return;
      }

      set({ searchLoading: true, searchError: null });

      try {
        const results = await client.searchFileContents(
          repoPath,
          query,
          searchCaseSensitive,
          100, // max results
        );
        set({
          searchResults: results,
          searchLoading: false,
        });
      } catch (error) {
        console.error("Search error:", error);
        set({
          searchResults: [],
          searchLoading: false,
          searchError: error instanceof Error ? error.message : "Search failed",
        });
      }
    },

    clearSearch: () =>
      set({
        searchQuery: "",
        searchResults: [],
        searchLoading: false,
        searchError: null,
        searchVerifiedOnly: false,
      }),

    clearSearchResults: () =>
      set({
        searchResults: [],
        searchLoading: false,
        searchError: null,
      }),

    navigateToSearchResult: (match) => {
      const state = get();
      const { guideContentMode } = state;
      const hunks = getAllHunksFromState(state);
      const hunk = hunks.find(
        (h) =>
          h.filePath === match.filePath &&
          (h.lines || []).some(
            (line) => line.newLineNumber === match.lineNumber,
          ),
      );

      set({
        ...(guideContentMode !== null && { guideContentMode: null }),
        selectedFile: match.filePath,
        filesPanelCollapsed: false,
        focusedHunkId: hunk?.id ?? null,
        scrollTarget: {
          type: "line",
          filePath: match.filePath,
          lineNumber: match.lineNumber,
        },
      });
    },
  });
