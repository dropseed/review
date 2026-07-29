import { useEffect, useCallback, useMemo } from "react";
import { useReviewStore } from "../../../stores";
import type { SearchMatch } from "../../../types";
import { useDebounce } from "../../../hooks/useDebounce";
import { HighlightedLine } from "../../ui/HighlightedLine";
import { groupSearchResultsByFile } from "../../../utils/search";
import { SimpleTooltip } from "../../ui/tooltip";
import { FileIcon } from "../../ui/icons";
import {
  countLabel,
  type PaletteGroup,
  type PaletteSource,
} from "../PaletteDialog";

const NO_GROUPS: PaletteGroup<SearchMatch>[] = [];

function getEmptyStateMessage(query: string, isLoading: boolean): string {
  if (!query.trim()) return "Type to search file contents…";
  if (isLoading) return "Searching…";
  return "No matches found";
}

function matchKey(match: SearchMatch): string {
  return `${match.filePath}:${match.lineNumber}:${match.column}`;
}

/**
 * Content search across the repo, grouped by file.
 *
 * The query is the palette's, but it is mirrored into the store: the slice
 * drops stale responses by comparing the query it was called with against
 * `searchQuery`, and the sidebar's results panel reads the same field. The
 * mirror is written well before the debounce elapses, so the comparison always
 * sees the query the request was actually issued for.
 */
export function useContentSource(
  query: string,
  active: boolean,
): PaletteSource<SearchMatch> {
  const searchResults = useReviewStore((s) => s.searchResults);
  const searchLoading = useReviewStore((s) => s.searchLoading);
  const searchError = useReviewStore((s) => s.searchError);
  const performSearch = useReviewStore((s) => s.performSearch);
  const clearSearchResults = useReviewStore((s) => s.clearSearchResults);
  const setSearchQuery = useReviewStore((s) => s.setSearchQuery);
  const navigateToSearchResult = useReviewStore(
    (s) => s.navigateToSearchResult,
  );
  const searchCaseSensitive = useReviewStore((s) => s.searchCaseSensitive);
  const setSearchCaseSensitive = useReviewStore(
    (s) => s.setSearchCaseSensitive,
  );
  const closeOverlay = useReviewStore((s) => s.closeOverlay);

  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (!active) return;
    setSearchQuery(query);
  }, [active, query, setSearchQuery]);

  useEffect(() => {
    if (!active) return;
    if (debouncedQuery.trim()) {
      performSearch(debouncedQuery);
    } else {
      clearSearchResults();
    }
  }, [
    active,
    debouncedQuery,
    performSearch,
    clearSearchResults,
    searchCaseSensitive,
  ]);

  const onClear = useCallback(() => {
    setSearchQuery("");
    clearSearchResults();
  }, [clearSearchResults, setSearchQuery]);

  const groups = useMemo<PaletteGroup<SearchMatch>[]>(
    () =>
      active
        ? groupSearchResultsByFile(searchResults).map((group) => ({
            key: group.filePath,
            items: group.matches,
            header: (
              <div
                data-palette-header
                className="sticky top-0 bg-surface-panel border-b border-edge px-4 py-1.5 flex items-center gap-2"
              >
                <FileIcon className="h-3.5 w-3.5 text-fg-muted flex-shrink-0" />
                <span className="text-xs font-mono text-fg-muted truncate">
                  {group.filePath}
                </span>
                <span className="text-xxs text-fg-faint ml-auto">
                  {countLabel(group.matches.length, "match", "matches")}
                </span>
              </div>
            ),
          }))
        : NO_GROUPS,
    [active, searchResults],
  );

  const onActivate = useCallback(
    (match: SearchMatch) => {
      navigateToSearchResult(match);
      closeOverlay("palette");
    },
    [navigateToSearchResult, closeOverlay],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      // Alt+C toggles case sensitivity (VS Code convention). Matched on
      // `code`, not `key`: on macOS Option+C produces "ç", so a `key === "c"`
      // test never fires.
      if (event.altKey && event.code === "KeyC") {
        event.preventDefault();
        setSearchCaseSensitive(!searchCaseSensitive);
        return true;
      }
      return false;
    },
    [searchCaseSensitive, setSearchCaseSensitive],
  );

  return {
    title: "Search in Files",
    placeholder: "Search in files…",
    onClear,
    groups,
    getKey: matchKey,
    renderRow: (match) => (
      <div className="flex items-start gap-3 px-4 py-1.5 text-left">
        <span className="text-xxs font-mono text-fg-faint w-10 text-right flex-shrink-0 pt-0.5 tabular-nums">
          {match.lineNumber}
        </span>
        <span className="text-xs font-mono text-fg-secondary truncate flex-1 min-w-0">
          <HighlightedLine
            content={match.lineContent}
            query={query}
            column={match.column}
          />
        </span>
      </div>
    ),
    onActivate,
    onKeyDown,
    busy: searchLoading,
    error: searchError,
    emptyMessage: getEmptyStateMessage(query, searchLoading),
    enterLabel: "go to line",
    renderCount: (n) => (n >= 100 ? "100+ results" : countLabel(n, "result")),
    size: "lg",
    inputAccessories: (
      <SimpleTooltip
        content={
          searchCaseSensitive ? "Case sensitive (on)" : "Case sensitive (off)"
        }
      >
        <button
          onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
          className={`flex h-6 w-6 items-center justify-center rounded text-xs font-bold transition-colors flex-shrink-0 ${
            searchCaseSensitive
              ? "bg-status-modified/20 text-status-modified"
              : "text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50"
          }`}
          aria-label="Toggle case sensitivity"
        >
          Aa
        </button>
      </SimpleTooltip>
    ),
  };
}
