import { useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import type { SearchMatch } from "../../types";
import { useDebounce } from "../../hooks/useDebounce";
import { HighlightedLine } from "../ui/HighlightedLine";
import { groupSearchResultsByFile } from "../../utils/search";
import { SimpleTooltip } from "../ui/tooltip";
import { FileIcon } from "../ui/icons";
import { PaletteDialog, countLabel, type PaletteGroup } from "../palette";

interface ContentSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

function getEmptyStateMessage(query: string, isLoading: boolean): string {
  if (!query.trim()) return "Type to search file contents…";
  if (isLoading) return "Searching…";
  return "No matches found";
}

function matchKey(match: SearchMatch): string {
  return `${match.filePath}:${match.lineNumber}:${match.column}`;
}

export function ContentSearch({
  isOpen,
  onClose,
}: ContentSearchProps): ReactNode {
  const searchResults = useReviewStore((s) => s.searchResults);
  const searchLoading = useReviewStore((s) => s.searchLoading);
  const searchError = useReviewStore((s) => s.searchError);
  const performSearch = useReviewStore((s) => s.performSearch);
  const clearSearchResults = useReviewStore((s) => s.clearSearchResults);
  const navigateToSearchResult = useReviewStore(
    (s) => s.navigateToSearchResult,
  );
  const searchCaseSensitive = useReviewStore((s) => s.searchCaseSensitive);
  const setSearchCaseSensitive = useReviewStore(
    (s) => s.setSearchCaseSensitive,
  );

  // Derived, not mirrored: the slice drops stale responses by comparing
  // against `searchQuery`, so the store has to be the one source of truth.
  const query = useReviewStore((s) => s.searchQuery);
  const setSearchQuery = useReviewStore((s) => s.setSearchQuery);
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery.trim()) {
      performSearch(debouncedQuery);
    } else {
      clearSearchResults();
    }
  }, [debouncedQuery, performSearch, clearSearchResults, searchCaseSensitive]);

  const handleClear = useCallback(() => {
    setSearchQuery("");
    clearSearchResults();
  }, [clearSearchResults, setSearchQuery]);

  const groups = useMemo<PaletteGroup<SearchMatch>[]>(
    () =>
      groupSearchResultsByFile(searchResults).map((group) => ({
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
      })),
    [searchResults],
  );

  const handleActivate = useCallback(
    (match: SearchMatch) => {
      navigateToSearchResult(match);
      onClose();
    },
    [navigateToSearchResult, onClose],
  );

  const handleKeyDown = useCallback(
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

  return (
    <PaletteDialog<SearchMatch>
      open={isOpen}
      onClose={onClose}
      title="Search in Files"
      query={query}
      onQueryChange={setSearchQuery}
      onClear={handleClear}
      selectOnOpen
      placeholder="Search in files…"
      groups={groups}
      getKey={matchKey}
      renderRow={(match) => (
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
      )}
      onActivate={handleActivate}
      onKeyDown={handleKeyDown}
      busy={searchLoading}
      error={searchError}
      emptyMessage={getEmptyStateMessage(query, searchLoading)}
      enterLabel="go to line"
      renderCount={(n) => (n >= 100 ? "100+ results" : countLabel(n, "result"))}
      size="lg"
      inputAccessories={
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
      }
    />
  );
}
