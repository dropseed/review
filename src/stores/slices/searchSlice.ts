import type { SliceCreatorWithClient } from "../types";
import type { ApiClient } from "../../api";
import type { SearchMatch } from "../../api/types";

export interface SearchSlice {
  // Search state
  searchQuery: string;
  searchResults: SearchMatch[];
  searchLoading: boolean;
  searchError: string | null;
  // Line to scroll to and highlight (null when not active)
  scrollToLine: { filePath: string; lineNumber: number } | null;

  // Actions
  setSearchQuery: (query: string) => void;
  performSearch: (query: string) => Promise<void>;
  clearSearch: () => void;
  clearScrollToLine: () => void;
  navigateToSearchResult: (index: number) => void;
}

export const createSearchSlice: SliceCreatorWithClient<SearchSlice> =
  (client: ApiClient) => (set, get) => ({
    searchQuery: "",
    searchResults: [],
    searchLoading: false,
    searchError: null,
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
        set({ searchResults: results, searchLoading: false });
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

    clearScrollToLine: () => set({ scrollToLine: null }),

    navigateToSearchResult: (index) => {
      const { searchResults, navigateToBrowse, topLevelView, hunks } = get();
      const result = searchResults[index];
      if (!result) return;

      // Auto-switch to browse if in overview
      if (topLevelView === "overview") {
        navigateToBrowse(result.filePath);
      } else {
        // Select the file within browse
        const { setSelectedFile } = get();
        setSelectedFile(result.filePath);
      }

      // Set scroll target for line highlighting
      set({
        scrollToLine: {
          filePath: result.filePath,
          lineNumber: result.lineNumber,
        },
      });

      // Find the hunk that contains this line
      const hunkIndex = hunks.findIndex((h) => {
        if (h.filePath !== result.filePath) return false;
        // Check if the line is within the hunk's range
        const hunkLines = h.lines || [];
        for (const line of hunkLines) {
          if (line.newLineNumber === result.lineNumber) {
            return true;
          }
        }
        return false;
      });

      if (hunkIndex >= 0) {
        set({ focusedHunkIndex: hunkIndex });
      }
    },
  });
