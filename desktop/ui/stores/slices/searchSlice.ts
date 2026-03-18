import type { SliceCreatorWithClient } from "../types";
import type { ApiClient } from "../../api";
import type { SearchMatch } from "../../types";

export type SearchMode = "text" | "symbols";

export interface SearchSlice {
  // Search state
  searchQuery: string;
  searchResults: SearchMatch[];
  searchLoading: boolean;
  searchError: string | null;
  searchCaseSensitive: boolean;
  searchMode: SearchMode;

  // Actions
  setSearchQuery: (query: string) => void;
  setSearchCaseSensitive: (value: boolean) => void;
  setSearchMode: (mode: SearchMode) => void;
  performSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
  clearSearchResults: () => void;
  navigateToSearchResult: (index: number) => void;
}

export const createSearchSlice: SliceCreatorWithClient<SearchSlice> =
  (client: ApiClient) => (set, get) => ({
    searchQuery: "",
    searchResults: [],
    searchLoading: false,
    searchError: null,
    searchCaseSensitive: false,
    searchMode: "text",

    setSearchQuery: (query) => set({ searchQuery: query }),
    setSearchCaseSensitive: (value) => set({ searchCaseSensitive: value }),
    setSearchMode: (mode) => set({ searchMode: mode }),

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
      }),

    clearSearchResults: () =>
      set({
        searchResults: [],
        searchLoading: false,
        searchError: null,
      }),

    navigateToSearchResult: (index) => {
      const { searchResults, hunks, guideContentMode } = get();
      const result = searchResults[index];
      if (!result) return;

      const hunk = hunks.find(
        (h) =>
          h.filePath === result.filePath &&
          (h.lines || []).some(
            (line) => line.newLineNumber === result.lineNumber,
          ),
      );

      set({
        ...(guideContentMode !== null && { guideContentMode: null }),
        selectedFile: result.filePath,
        filesPanelCollapsed: false,
        focusedHunkId: hunk?.id ?? null,
        scrollTarget: {
          type: "line",
          filePath: result.filePath,
          lineNumber: result.lineNumber,
        },
      });
    },
  });
