import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useReviewStore } from "../stores";
import { getApiClient } from "../api";
import type {
  FileSymbol,
  SymbolDiff,
  SymbolChangeType,
  SymbolKind,
} from "../types";
import { Dialog, DialogOverlay, DialogPortal } from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";
import { ChangeIndicator, SymbolKindBadge } from "./symbols";

interface SymbolSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FlatSymbol {
  name: string;
  kind: SymbolKind | null;
  changeType: SymbolChangeType | null;
  hunkIds: string[];
  parentName: string | null;
  sortKey: number;
}

interface SymbolMatch {
  symbol: FlatSymbol;
  score: number;
  matchIndices: number[];
}

// Fuzzy matching (same algorithm as FileFinder)
function fuzzyMatch(
  query: string,
  text: string,
): { score: number; indices: number[] } | null {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  let queryIdx = 0;
  let score = 0;
  const indices: number[] = [];
  let prevMatchIdx = -1;

  for (let i = 0; i < textLower.length && queryIdx < queryLower.length; i++) {
    if (textLower[i] === queryLower[queryIdx]) {
      indices.push(i);
      if (prevMatchIdx === i - 1) {
        score += 10;
      }
      if (i === 0 || /[/._-]/.test(text[i - 1])) {
        score += 5;
      }
      prevMatchIdx = i;
      queryIdx++;
    }
  }

  if (queryIdx !== queryLower.length) {
    return null;
  }

  score += 100 - (text.length - queryLower.length);
  return { score, indices };
}

function HighlightedText({
  text,
  indices,
}: {
  text: string;
  indices: number[];
}) {
  const indicesSet = new Set(indices);
  const chars = text.split("");
  return (
    <>
      {chars.map((char, i) =>
        indicesSet.has(i) ? (
          <span key={i} className="text-amber-400 font-medium">
            {char}
          </span>
        ) : (
          <span key={i}>{char}</span>
        ),
      )}
    </>
  );
}

// Build a lookup of changed symbols from the diff: "name|kind" -> SymbolDiff
function buildDiffLookup(
  symbols: SymbolDiff[],
  parentName: string | null,
  out: Map<string, { diff: SymbolDiff; parentName: string | null }>,
) {
  for (const sym of symbols) {
    const key = `${sym.name}|${sym.kind ?? ""}`;
    out.set(key, { diff: sym, parentName });
    if (sym.children.length > 0) {
      buildDiffLookup(sym.children, sym.name, out);
    }
  }
}

// Recursively flatten full symbols from tree-sitter, merging diff info
function flattenAllSymbols(
  symbols: FileSymbol[],
  parentName: string | null,
  diffLookup: Map<string, { diff: SymbolDiff; parentName: string | null }>,
): FlatSymbol[] {
  const result: FlatSymbol[] = [];
  for (const sym of symbols) {
    const key = `${sym.name}|${sym.kind}`;
    const diffEntry = diffLookup.get(key);

    result.push({
      name: sym.name,
      kind: sym.kind,
      changeType: diffEntry?.diff.changeType ?? null,
      hunkIds: diffEntry?.diff.hunkIds ?? [],
      parentName: diffEntry?.parentName ?? parentName,
      sortKey: sym.startLine,
    });

    if (sym.children.length > 0) {
      result.push(...flattenAllSymbols(sym.children, sym.name, diffLookup));
    }
  }
  return result;
}

// Flatten diff-only symbols (for files without full symbol data)
function flattenDiffSymbols(
  symbols: SymbolDiff[],
  parentName: string | null,
): FlatSymbol[] {
  const result: FlatSymbol[] = [];
  for (const sym of symbols) {
    const sortKey = sym.newRange?.startLine ?? sym.oldRange?.startLine ?? 0;
    if (sym.hunkIds.length > 0) {
      result.push({
        name: sym.name,
        kind: sym.kind,
        changeType: sym.changeType,
        hunkIds: sym.hunkIds,
        parentName,
        sortKey,
      });
    }
    if (sym.children.length > 0) {
      result.push(...flattenDiffSymbols(sym.children, sym.name));
    }
  }
  return result;
}

const CHANGE_ORDER: Record<string, number> = {
  modified: 0,
  added: 1,
  removed: 2,
};

export function SymbolSearch({ isOpen, onClose }: SymbolSearchProps) {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const repoPath = useReviewStore((s) => s.repoPath);
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const hunks = useReviewStore((s) => s.hunks);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allSymbols, setAllSymbols] = useState<FileSymbol[] | null>(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Find the FileSymbolDiff for the currently selected file
  const fileDiff = useMemo(() => {
    if (!selectedFile) return null;
    return symbolDiffs.find((d) => d.filePath === selectedFile) ?? null;
  }, [selectedFile, symbolDiffs]);

  // Fetch all symbols when dialog opens or file changes
  useEffect(() => {
    if (!isOpen || !selectedFile || !repoPath) {
      return;
    }

    let cancelled = false;
    setLoading(true);

    getApiClient()
      .getFileSymbols(repoPath, selectedFile)
      .then((symbols) => {
        if (!cancelled) {
          setAllSymbols(symbols);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAllSymbols(null);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedFile, repoPath]);

  // Build the flat symbol list, merging full symbols with diff data
  const flatSymbols = useMemo(() => {
    if (!selectedFile) return [];

    const diffLookup = new Map<
      string,
      { diff: SymbolDiff; parentName: string | null }
    >();
    if (fileDiff) {
      buildDiffLookup(fileDiff.symbols, null, diffLookup);
    }

    let symbols: FlatSymbol[];

    if (allSymbols) {
      // We have full symbol data: show all symbols, annotated with diff info
      symbols = flattenAllSymbols(allSymbols, null, diffLookup);

      // Also include "added" symbols from diff that don't exist in allSymbols
      // (added symbols only appear in the new version, which allSymbols covers,
      // but "removed" symbols only exist in the old version)
      if (fileDiff) {
        const allNames = new Set(
          symbols.map((s) => `${s.name}|${s.kind ?? ""}`),
        );
        const removedSymbols = flattenDiffSymbols(
          fileDiff.symbols,
          null,
        ).filter(
          (s) =>
            s.changeType === "removed" &&
            !allNames.has(`${s.name}|${s.kind ?? ""}`),
        );
        symbols.push(...removedSymbols);
      }
    } else if (fileDiff) {
      // No full symbol data, fall back to diff-only symbols
      symbols = flattenDiffSymbols(fileDiff.symbols, null);
    } else {
      return [];
    }

    // Add top-level changes entry if present in diff
    if (fileDiff && fileDiff.topLevelHunkIds.length > 0) {
      symbols.push({
        name: "top-level changes",
        kind: null,
        changeType: "modified",
        hunkIds: fileDiff.topLevelHunkIds,
        parentName: null,
        sortKey: -1,
      });
    }

    return symbols;
  }, [allSymbols, fileDiff, selectedFile]);

  // Compute results based on query
  const results = useMemo((): SymbolMatch[] => {
    if (!query.trim()) {
      // No query: changed symbols first (by change type), then unchanged by line
      const sorted = [...flatSymbols].sort((a, b) => {
        const aChanged = a.changeType !== null;
        const bChanged = b.changeType !== null;
        if (aChanged !== bChanged) return aChanged ? -1 : 1;
        if (aChanged && bChanged) {
          const orderDiff =
            (CHANGE_ORDER[a.changeType!] ?? 3) -
            (CHANGE_ORDER[b.changeType!] ?? 3);
          if (orderDiff !== 0) return orderDiff;
        }
        return a.sortKey - b.sortKey;
      });
      return sorted.map((s) => ({ symbol: s, score: 0, matchIndices: [] }));
    }

    const matches: SymbolMatch[] = [];
    for (const sym of flatSymbols) {
      const match = fuzzyMatch(query, sym.name);
      if (match) {
        // Bonus for changed symbols
        const changeBonus = sym.changeType !== null ? 20 : 0;
        matches.push({
          symbol: sym,
          score: match.score + changeBonus,
          matchIndices: match.indices,
        });
      }
    }

    matches.sort((a, b) => b.score - a.score);
    return matches;
  }, [flatSymbols, query]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
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

  const handleSelect = useCallback(
    (symbol: FlatSymbol) => {
      if (!selectedFile) return;

      navigateToBrowse(selectedFile);

      if (symbol.hunkIds.length > 0) {
        // Navigate to the first hunk for this symbol
        const firstHunkId = symbol.hunkIds[0];
        const hunkIndex = hunks.findIndex((h) => h.id === firstHunkId);
        if (hunkIndex >= 0) {
          useReviewStore.setState({ focusedHunkIndex: hunkIndex });
        }
      } else {
        // No hunks (unchanged symbol) — find the nearest hunk by line number
        const fileHunks = hunks
          .map((h, i) => ({ hunk: h, index: i }))
          .filter((h) => h.hunk.filePath === selectedFile);

        if (fileHunks.length > 0) {
          // Find the hunk closest to this symbol's start line
          let closest = fileHunks[0];
          let closestDist = Math.abs(
            (fileHunks[0].hunk.newStart ?? 0) - symbol.sortKey,
          );
          for (const fh of fileHunks) {
            const dist = Math.abs((fh.hunk.newStart ?? 0) - symbol.sortKey);
            if (dist < closestDist) {
              closest = fh;
              closestDist = dist;
            }
          }
          useReviewStore.setState({ focusedHunkIndex: closest.index });
        }
      }

      onClose();
    },
    [selectedFile, hunks, navigateToBrowse, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
          e.preventDefault();
          if (results[selectedIndex]) {
            handleSelect(results[selectedIndex].symbol);
          }
          break;
      }
    },
    [results, selectedIndex, handleSelect],
  );

  // Determine empty state message
  const emptyMessage = !selectedFile
    ? "Select a file first"
    : loading
      ? "Loading symbols..."
      : !fileDiff && !allSymbols
        ? "No symbols available"
        : query
          ? "No matching symbols"
          : "No symbols in this file";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay className="items-start pt-[15vh]">
          <DialogPrimitive.Content
            className="w-full max-w-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <VisuallyHidden.Root>
              <DialogPrimitive.Title>Go to Symbol</DialogPrimitive.Title>
            </VisuallyHidden.Root>
            <div className="rounded-xl border border-stone-700/80 bg-stone-900 shadow-2xl shadow-black/50 overflow-hidden">
              {/* Search input */}
              <div className="border-b border-stone-800 p-3">
                <div className="flex items-center gap-3 px-2">
                  <svg
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
                    placeholder="Search symbols..."
                    aria-label="Search symbols"
                    className="flex-1 bg-transparent text-sm text-stone-100 placeholder-stone-500 focus:outline-none"
                  />
                  {query && (
                    <button
                      onClick={() => setQuery("")}
                      className="text-stone-500 hover:text-stone-300 transition-colors"
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
                className="max-h-80 overflow-y-auto scrollbar-thin"
                role="listbox"
                aria-label="Symbol search results"
              >
                {results.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-stone-500">
                    {emptyMessage}
                  </div>
                ) : (
                  results.map((result, index) => (
                    <button
                      key={`${result.symbol.changeType ?? "none"}-${result.symbol.name}-${result.symbol.sortKey}`}
                      data-index={index}
                      role="option"
                      aria-selected={index === selectedIndex}
                      onClick={() => handleSelect(result.symbol)}
                      className={`w-full flex items-center gap-2 px-4 py-2 text-left transition-colors ${
                        index === selectedIndex
                          ? "bg-stone-800"
                          : "hover:bg-stone-800/50"
                      }`}
                    >
                      {result.symbol.changeType ? (
                        <ChangeIndicator
                          changeType={result.symbol.changeType}
                        />
                      ) : (
                        <span className="flex-shrink-0 w-3" />
                      )}
                      <SymbolKindBadge kind={result.symbol.kind} />
                      <span
                        className={`min-w-0 flex-1 truncate font-mono text-sm ${
                          result.symbol.changeType
                            ? "text-stone-300"
                            : "text-stone-500"
                        }`}
                      >
                        {result.matchIndices.length > 0 ? (
                          <HighlightedText
                            text={result.symbol.name}
                            indices={result.matchIndices}
                          />
                        ) : (
                          result.symbol.name
                        )}
                      </span>
                      {result.symbol.parentName && (
                        <span className="flex-shrink-0 text-xs text-stone-600">
                          in {result.symbol.parentName}
                        </span>
                      )}
                    </button>
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
                    <span className="ml-0.5">select</span>
                  </span>
                  <span className="flex items-center gap-1">
                    <kbd className="rounded bg-stone-800 px-1 py-0.5 text-stone-500">
                      Esc
                    </kbd>
                    <span className="ml-0.5">close</span>
                  </span>
                </div>
                <span>{results.length} symbols</span>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  );
}
