import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useDebounce } from "../../hooks/useDebounce";
import { HighlightedLine } from "../ui/HighlightedLine";
import { groupSearchResultsByFile } from "../../utils/search";
import { Dialog, DialogOverlay, DialogPortal } from "../ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

interface ContentSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

function getEmptyStateMessage(query: string, isLoading: boolean): string {
  if (!query.trim()) return "Type to search file contents…";
  if (isLoading) return "Searching…";
  return "No matches found";
}

export function ContentSearch({
  isOpen,
  onClose,
}: ContentSearchProps): ReactNode {
  const {
    searchResults,
    searchLoading,
    searchError,
    performSearch,
    clearSearchResults,
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
      clearSearchResults();
    }
  }, [debouncedQuery, performSearch, clearSearchResults]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [searchResults]);

  // Pre-fill from store query when modal opens, select all for easy replacement
  useEffect(() => {
    if (isOpen) {
      const storeQuery = useReviewStore.getState().searchQuery;
      setQuery(storeQuery);
      setSelectedIndex(0);
      const rafId = requestAnimationFrame(() => {
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isOpen]);

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

  const groupedResults = useMemo(
    () => groupSearchResultsByFile(searchResults),
    [searchResults],
  );

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
      }
    },
    [searchResults, selectedIndex, handleSelect],
  );

  let flatIndex = 0;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay className="items-start pt-[15vh]">
          <DialogPrimitive.Content
            className="w-full max-w-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <VisuallyHidden.Root>
              <DialogPrimitive.Title>Search in Files</DialogPrimitive.Title>
            </VisuallyHidden.Root>
            <div className="rounded-xl border border-stone-700/80 bg-stone-900 shadow-2xl shadow-black/50 overflow-hidden">
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
                    onChange={(e) => {
                      setQuery(e.target.value);
                      useReviewStore.getState().setSearchQuery(e.target.value);
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Search in files…"
                    aria-label="Search in files"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    className="flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded px-1 py-1"
                  />
                  {searchLoading && (
                    <div className="h-4 w-4 rounded-full border-2 border-stone-600 border-t-stone-300 animate-spin" />
                  )}
                  {query && !searchLoading && (
                    <button
                      onClick={() => {
                        setQuery("");
                        useReviewStore.getState().setSearchQuery("");
                        clearSearchResults();
                      }}
                      className="text-stone-500 hover:text-stone-300 transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded"
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
                    {getEmptyStateMessage(query, searchLoading)}
                  </div>
                ) : (
                  groupedResults.map((group) => (
                    <div key={group.filePath}>
                      {/* File header */}
                      <div className="sticky top-0 bg-stone-900 border-b border-stone-800 px-4 py-1.5 flex items-center gap-2">
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
                            className={`w-full flex items-start gap-3 px-4 py-1.5 text-left transition-colors focus-visible:outline-hidden focus-visible:inset-ring-2 focus-visible:inset-ring-amber-500/50 ${
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
                <span aria-live="polite">
                  {searchResults.length > 0 &&
                    `${searchResults.length >= 100 ? "100+" : searchResults.length} results`}
                </span>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  );
}
