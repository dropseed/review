import type { SliceCreatorWithClient } from "../types";
import type { ApiClient } from "../../api";
import type { SearchMatch } from "../../types";

export interface SearchSlice {
  // Search state
  searchQuery: string;
  searchResults: SearchMatch[];
  searchLoading: boolean;
  searchError: string | null;
  searchActive: boolean;
  // Line to scroll to and highlight (null when not active)
  scrollToLine: { filePath: string; lineNumber: number } | null;

  // Actions
  setSearchQuery: (query: string) => void;
  performSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
  clearSearchResults: () => void;
  clearScrollToLine: () => void;
  navigateToSearchResult: (index: number) => void;
}

export const createSearchSlice: SliceCreatorWithClient<SearchSlice> =
  (client: ApiClient) => (set, get) => ({
    searchQuery: "",
    searchResults: [],
    searchLoading: false,
    searchError: null,
    searchActive: false,
    scrollToLine: null,

    setSearchQuery: (query) => set({ searchQuery: query }),

    performSearch: async (query) => {
      const { repoPath } = get();
      if (!repoPath || !query.trim()) {
        set({ searchResults: [], searchLoading: false, searchError: null });
        return;
      }

      set({ searchLoading: true, searchError: null });

      try {
        const results = await client.searchFileContents(
          repoPath,
          query,
          false, // case insensitive by default
          100, // max results
        );
        set({
          searchResults: results,
          searchLoading: false,
          searchActive: true,
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
        searchActive: false,
      }),

    clearSearchResults: () =>
      set({
        searchResults: [],
        searchLoading: false,
        searchError: null,
      }),

    clearScrollToLine: () => set({ scrollToLine: null }),

    navigateToSearchResult: (index) => {
      const { searchResults, navigateToBrowse, guideContentMode, hunks } =
        get();
      const result = searchResults[index];
      if (!result) return;

      // Auto-switch to browse if in guide content, otherwise select the file
      if (guideContentMode !== null) {
        navigateToBrowse(result.filePath);
      } else {
        get().setSelectedFile(result.filePath);
      }

      // Set scroll target for line highlighting
      set({
        scrollToLine: {
          filePath: result.filePath,
          lineNumber: result.lineNumber,
        },
      });

      // Find the hunk that contains this line and focus it
      const hunkIndex = hunks.findIndex(
        (h) =>
          h.filePath === result.filePath &&
          (h.lines || []).some(
            (line) => line.newLineNumber === result.lineNumber,
          ),
      );

      if (hunkIndex >= 0) {
        set({ focusedHunkIndex: hunkIndex });
      }
    },
  });
