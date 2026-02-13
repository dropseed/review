import { useState, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useDebounce } from "../../hooks/useDebounce";
import { HighlightedLine } from "../ui/HighlightedLine";
import { groupSearchResultsByFile } from "../../utils/search";

function getEmptyStateMessage(query: string, isLoading: boolean): string {
  if (!query.trim()) return "Type to search file contents\u2026";
  if (isLoading) return "Searching\u2026";
  return "No matches found";
}

export function SearchResultsPanel(): ReactNode {
  const {
    searchQuery,
    searchResults,
    searchLoading,
    searchError,
    performSearch,
    clearSearch,
    clearSearchResults,
    navigateToSearchResult,
  } = useReviewStore();

  const [query, setQuery] = useState(searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Sync local query when store query changes externally (e.g. from modal)
  useEffect(() => {
    setQuery(searchQuery);
  }, [searchQuery]);

  // Perform search when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim()) {
      performSearch(debouncedQuery);
    } else {
      clearSearchResults();
    }
  }, [debouncedQuery, performSearch, clearSearchResults]);

  const groupedResults = useMemo(
    () => groupSearchResultsByFile(searchResults),
    [searchResults],
  );

  let flatIndex = 0;

  return (
    <div className="flex h-full flex-col">
      {/* Search input */}
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 rounded-md bg-stone-800/50 px-2 py-1">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-stone-500 flex-shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.3-4.3" />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              useReviewStore.getState().setSearchQuery(e.target.value);
            }}
            placeholder="Search in files\u2026"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-xs text-stone-100 placeholder-stone-500 focus:outline-hidden min-w-0"
          />
          {searchLoading && (
            <div className="h-3.5 w-3.5 rounded-full border-2 border-stone-600 border-t-stone-300 animate-spin flex-shrink-0" />
          )}
          {query && !searchLoading && (
            <button
              onClick={clearSearch}
              className="text-stone-500 hover:text-stone-300 transition-colors flex-shrink-0"
              aria-label="Clear search"
            >
              <svg
                className="h-3.5 w-3.5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Results */}
      <div className="flex-1 overflow-y-auto scrollbar-thin pb-8">
        {searchError ? (
          <div className="px-4 py-8 text-center text-xs text-red-400">
            {searchError}
          </div>
        ) : searchResults.length === 0 ? (
          <div className="px-4 py-8 text-center text-xs text-stone-500">
            {getEmptyStateMessage(query, searchLoading)}
          </div>
        ) : (
          groupedResults.map((group) => (
            <div key={group.filePath}>
              {/* File header */}
              <div className="sticky top-0 z-10 bg-stone-900 border-b border-stone-800/50 px-3 py-1.5 flex items-center gap-2">
                <svg
                  aria-hidden="true"
                  className="h-3 w-3 text-stone-500 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
                <span className="text-xxs font-mono text-stone-400 truncate flex-1 min-w-0">
                  {group.filePath}
                </span>
                <span className="text-xxs text-stone-600 flex-shrink-0">
                  {group.matches.length}
                </span>
              </div>
              {/* Match rows */}
              {group.matches.map((result) => {
                const currentIndex = flatIndex++;
                return (
                  <button
                    key={`${result.filePath}:${result.lineNumber}:${result.column}`}
                    onClick={() => navigateToSearchResult(currentIndex)}
                    className="w-full flex items-start gap-2 px-3 py-1 text-left hover:bg-stone-800/50 transition-colors"
                  >
                    <span className="text-xxs font-mono text-stone-600 w-8 text-right flex-shrink-0 pt-px tabular-nums">
                      {result.lineNumber}
                    </span>
                    <span className="text-xxs font-mono text-stone-300 truncate flex-1 min-w-0">
                      <HighlightedLine
                        content={result.lineContent}
                        query={query}
                        column={result.column}
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>

      {/* Footer */}
      {searchResults.length > 0 && (
        <div
          className="border-t border-stone-800/50 px-3 py-1.5 text-xxs text-stone-500"
          aria-live="polite"
        >
          {searchResults.length >= 100 ? "100+" : searchResults.length} result
          {searchResults.length !== 1 ? "s" : ""} in {groupedResults.length}{" "}
          file
          {groupedResults.length !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
