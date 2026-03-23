import { useState, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useDebounce } from "../../hooks/useDebounce";
import { HighlightedLine } from "../ui/HighlightedLine";
import { Spinner } from "../ui/spinner";
import { SimpleTooltip } from "../ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { groupSearchResultsByFile } from "../../utils/search";
import { SymbolSearchPanel } from "./SymbolSearchPanel";
import { FileGroupHeader } from "./FileGroupHeader";
import type { SearchMode } from "../../stores/slices/searchSlice";

function getEmptyStateMessage(query: string, isLoading: boolean): string {
  if (!query.trim()) return "Type to search file contents…";
  if (isLoading) return "Searching…";
  return "No matches found";
}

export function SearchResultsPanel(): ReactNode {
  const searchQuery = useReviewStore((s) => s.searchQuery);
  const searchResults = useReviewStore((s) => s.searchResults);
  const searchLoading = useReviewStore((s) => s.searchLoading);
  const searchError = useReviewStore((s) => s.searchError);
  const performSearch = useReviewStore((s) => s.performSearch);
  const clearSearch = useReviewStore((s) => s.clearSearch);
  const clearSearchResults = useReviewStore((s) => s.clearSearchResults);
  const navigateToSearchResult = useReviewStore(
    (s) => s.navigateToSearchResult,
  );
  const searchCaseSensitive = useReviewStore((s) => s.searchCaseSensitive);
  const setSearchCaseSensitive = useReviewStore(
    (s) => s.setSearchCaseSensitive,
  );
  const searchMode = useReviewStore((s) => s.searchMode);
  const setSearchMode = useReviewStore((s) => s.setSearchMode);

  const [query, setQuery] = useState(searchQuery);
  const inputRef = useRef<HTMLInputElement>(null);
  const debouncedQuery = useDebounce(query, 300);

  // Sync local query when store query changes externally (e.g. from modal)
  useEffect(() => {
    setQuery(searchQuery);
  }, [searchQuery]);

  // Perform text search when debounced query changes (only in text mode)
  useEffect(() => {
    if (searchMode !== "text") return;
    if (debouncedQuery.trim()) {
      performSearch(debouncedQuery);
    } else {
      clearSearchResults();
    }
  }, [
    debouncedQuery,
    performSearch,
    clearSearchResults,
    searchCaseSensitive,
    searchMode,
  ]);

  const groupedResults = useMemo(
    () => groupSearchResultsByFile(searchResults),
    [searchResults],
  );

  let flatIndex = 0;

  return (
    <div className="flex h-full flex-col">
      {/* Search input + mode toggle */}
      <div className="px-3 py-2 flex flex-col gap-2">
        <div className="flex items-center gap-2 rounded-md bg-surface-raised/50 px-2 py-1">
          <svg
            aria-hidden="true"
            className="h-3.5 w-3.5 text-fg-muted flex-shrink-0"
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
            placeholder={
              searchMode === "text" ? "Search in files…" : "Search symbols…"
            }
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            className="flex-1 bg-transparent text-xs text-fg placeholder-fg-muted focus:outline-hidden min-w-0"
          />
          {searchMode === "text" && (
            <SimpleTooltip
              content={
                searchCaseSensitive
                  ? "Case sensitive (on)"
                  : "Case sensitive (off)"
              }
            >
              <button
                onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
                className={`flex h-5 w-5 items-center justify-center rounded text-xxs font-bold transition-colors flex-shrink-0 ${
                  searchCaseSensitive
                    ? "bg-status-modified/20 text-status-modified"
                    : "text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50"
                }`}
                aria-label="Toggle case sensitivity"
              >
                Aa
              </button>
            </SimpleTooltip>
          )}
          {searchMode === "text" && searchLoading && (
            <Spinner className="h-3.5 w-3.5 border-2 border-surface-active border-t-fg-secondary flex-shrink-0" />
          )}
          {query && !(searchMode === "text" && searchLoading) && (
            <button
              onClick={() => {
                setQuery("");
                clearSearch();
              }}
              className="text-fg-muted hover:text-fg-secondary transition-colors flex-shrink-0"
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
        <Tabs
          value={searchMode}
          onValueChange={(v) => setSearchMode(v as SearchMode)}
        >
          <TabsList>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="symbols">Symbols</TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {/* Results — both panels stay mounted to preserve memo caches */}
      <div
        className={
          searchMode === "symbols" ? "hidden" : "flex flex-col flex-1 min-h-0"
        }
      >
        <div className="flex-1 overflow-y-auto scrollbar-thin pb-8">
          {searchError ? (
            <div className="px-4 py-8 text-center text-xs text-status-rejected">
              {searchError}
            </div>
          ) : searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-fg-muted">
              {getEmptyStateMessage(query, searchLoading)}
            </div>
          ) : (
            groupedResults.map((group) => (
              <div key={group.filePath}>
                <FileGroupHeader
                  filePath={group.filePath}
                  count={group.matches.length}
                />
                {/* Match rows */}
                {group.matches.map((result) => {
                  const currentIndex = flatIndex++;
                  return (
                    <button
                      key={`${result.filePath}:${result.lineNumber}:${result.column}`}
                      onClick={() => navigateToSearchResult(currentIndex)}
                      className="w-full flex items-start gap-2 px-3 py-1 text-left hover:bg-surface-raised/50 transition-colors"
                    >
                      <span className="text-xxs font-mono text-fg-faint w-8 text-right flex-shrink-0 pt-px tabular-nums">
                        {result.lineNumber}
                      </span>
                      <span className="text-xxs font-mono text-fg-secondary truncate flex-1 min-w-0">
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
            className="border-t border-edge/50 px-3 py-1.5 text-xxs text-fg-muted"
            aria-live="polite"
          >
            {searchResults.length >= 100 ? "100+" : searchResults.length} result
            {searchResults.length !== 1 ? "s" : ""} in {groupedResults.length}{" "}
            file
            {groupedResults.length !== 1 ? "s" : ""}
          </div>
        )}
      </div>

      <div
        className={
          searchMode === "text" ? "hidden" : "flex flex-col flex-1 min-h-0"
        }
      >
        <SymbolSearchPanel query={query} />
      </div>
    </div>
  );
}
