import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useReviewStore } from "../stores/reviewStore";

interface ContentSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

// Debounce helper
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}

// Highlight matched text in a line
function HighlightedLine({
  content,
  query,
  column,
}: {
  content: string;
  query: string;
  column: number;
}) {
  if (!query) {
    return <span>{content}</span>;
  }

  // Column is 1-indexed, convert to 0-indexed
  const matchStart = column - 1;
  const matchEnd = matchStart + query.length;

  // Ensure indices are within bounds
  if (matchStart < 0 || matchStart >= content.length) {
    return <span>{content}</span>;
  }

  const before = content.slice(0, matchStart);
  const match = content.slice(matchStart, Math.min(matchEnd, content.length));
  const after = content.slice(Math.min(matchEnd, content.length));

  return (
    <>
      <span>{before}</span>
      <span className="bg-amber-500/30 text-amber-200 font-medium">
        {match}
      </span>
      <span>{after}</span>
    </>
  );
}

export function ContentSearch({ isOpen, onClose }: ContentSearchProps) {
  const {
    searchResults,
    searchLoading,
    searchError,
    performSearch,
    clearSearch,
    navigateToSearchResult,
  } = useReviewStore();

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Debounce the search query
  const debouncedQuery = useDebounce(query, 300);

  // Perform search when debounced query changes
  useEffect(() => {
    if (debouncedQuery.trim()) {
      performSearch(debouncedQuery);
    } else {
      clearSearch();
    }
  }, [debouncedQuery, performSearch, clearSearch]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      clearSearch();
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen, clearSearch]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selectedEl = listRef.current.querySelector(
      `[data-index="${selectedIndex}"]`,
    );
    if (selectedEl) {
      selectedEl.scrollIntoView({ block: "nearest" });
    }
  }, [selectedIndex]);

  // Group results by file for display
  const groupedResults = useMemo(() => {
    const groups = new Map<
      string,
      { filePath: string; matches: typeof searchResults }
    >();
    for (const result of searchResults) {
      const existing = groups.get(result.filePath);
      if (existing) {
        existing.matches.push(result);
      } else {
        groups.set(result.filePath, {
          filePath: result.filePath,
          matches: [result],
        });
      }
    }
    return Array.from(groups.values());
  }, [searchResults]);

  const handleSelect = useCallback(
    (index: number) => {
      navigateToSearchResult(index);
      onClose();
    },
    [navigateToSearchResult, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            Math.min(prev + 1, searchResults.length - 1),
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (searchResults[selectedIndex]) {
            handleSelect(selectedIndex);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [searchResults, selectedIndex, handleSelect, onClose],
  );

  if (!isOpen) return null;

  // Compute the flat index for each result in the grouped display
  let flatIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-center bg-black/60 backdrop-blur-sm animate-fade-in pt-[15vh] motion-reduce:animate-none"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-2xl h-fit rounded-xl border border-stone-700/80 bg-stone-900 shadow-2xl shadow-black/50 overflow-hidden">
        {/* Search input */}
        <div className="border-b border-stone-800 p-3">
          <div className="flex items-center gap-3 px-2">
            <svg
              aria-hidden="true"
              className="h-4 w-4 text-stone-500 flex-shrink-0"
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
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search in files…"
              aria-label="Search in files"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              className="flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded px-1 py-1"
            />
            {searchLoading && (
              <div className="h-4 w-4 rounded-full border-2 border-stone-600 border-t-stone-300 animate-spin" />
            )}
            {query && !searchLoading && (
              <button
                onClick={() => setQuery("")}
                className="text-stone-500 hover:text-stone-300 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded"
                aria-label="Clear search"
              >
                <svg
                  className="h-4 w-4"
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

        {/* Results list */}
        <div
          ref={listRef}
          className="max-h-96 overflow-y-auto scrollbar-thin"
          role="listbox"
          aria-label="Search results"
        >
          {searchError ? (
            <div className="px-4 py-8 text-center text-sm text-red-400">
              {searchError}
            </div>
          ) : searchResults.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-stone-500">
              {query.trim()
                ? searchLoading
                  ? "Searching..."
                  : "No matches found"
                : "Type to search file contents…"}
            </div>
          ) : (
            groupedResults.map((group) => (
              <div key={group.filePath}>
                {/* File header */}
                <div className="sticky top-0 bg-stone-850 border-b border-stone-800 px-4 py-1.5 flex items-center gap-2">
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
                    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
                    <polyline points="14 2 14 8 20 8" />
                  </svg>
                  <span className="text-xs font-mono text-stone-400 truncate">
                    {group.filePath}
                  </span>
                  <span className="text-xxs text-stone-600 ml-auto">
                    {group.matches.length} match
                    {group.matches.length !== 1 ? "es" : ""}
                  </span>
                </div>
                {/* Matches in this file */}
                {group.matches.map((result) => {
                  const currentIndex = flatIndex++;
                  return (
                    <button
                      key={`${result.filePath}:${result.lineNumber}:${result.column}`}
                      data-index={currentIndex}
                      role="option"
                      aria-selected={currentIndex === selectedIndex}
                      onClick={() => handleSelect(currentIndex)}
                      className={`w-full flex items-start gap-3 px-4 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500/50 ${
                        currentIndex === selectedIndex
                          ? "bg-stone-800"
                          : "hover:bg-stone-800/50"
                      }`}
                    >
                      {/* Line number */}
                      <span className="text-xxs font-mono text-stone-600 w-10 text-right flex-shrink-0 pt-0.5 tabular-nums">
                        {result.lineNumber}
                      </span>
                      {/* Line content */}
                      <span className="text-xs font-mono text-stone-300 truncate flex-1 min-w-0">
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

        {/* Footer with keyboard hints */}
        <div className="border-t border-stone-800 px-4 py-2 flex items-center justify-between text-xxs text-stone-600">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-stone-500">
                ↑
              </kbd>
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-stone-500">
                ↓
              </kbd>
              <span className="ml-0.5">navigate</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-stone-500">
                Enter
              </kbd>
              <span className="ml-0.5">go to line</span>
            </span>
            <span className="flex items-center gap-1">
              <kbd className="rounded bg-stone-800 px-1 py-0.5 text-stone-500">
                Esc
              </kbd>
              <span className="ml-0.5">close</span>
            </span>
          </div>
          <span>
            {searchResults.length > 0 && `${searchResults.length} results`}
          </span>
        </div>
      </div>
    </div>
  );
}
