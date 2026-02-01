import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useReviewStore } from "../stores";
import type { FileEntry } from "../types";
import { Dialog, DialogOverlay, DialogPortal } from "./ui/dialog";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as VisuallyHidden from "@radix-ui/react-visually-hidden";

interface FileFinderProps {
  isOpen: boolean;
  onClose: () => void;
}

interface FuzzyMatch {
  path: string;
  name: string;
  score: number;
  matchIndices: number[];
  isChanged: boolean;
}

// Flatten all files from tree structure, excluding gitignored files
function flattenAllFiles(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    // Skip gitignored files and directories
    if (entry.status === "gitignored") {
      continue;
    }
    if (entry.isDirectory && entry.children) {
      result.push(...flattenAllFiles(entry.children));
    } else if (!entry.isDirectory) {
      result.push(entry);
    }
  }
  return result;
}

// VS Code-style fuzzy matching with recursive best-path scoring
function fuzzyMatch(
  query: string,
  text: string,
): { score: number; indices: number[] } | null {
  const queryLower = query.toLowerCase();
  const textLower = text.toLowerCase();

  // Quick check: all query chars must exist in text
  {
    let qi = 0;
    for (let i = 0; i < textLower.length && qi < queryLower.length; i++) {
      if (textLower[i] === queryLower[qi]) qi++;
    }
    if (qi !== queryLower.length) return null;
  }

  // Recursive matching to find the best scoring path
  const bestResult = fuzzyMatchRecursive(
    queryLower,
    textLower,
    text,
    0,
    0,
    [],
    0,
  );
  if (!bestResult) return null;

  return { score: bestResult.score, indices: bestResult.indices };
}

const MAX_RECURSION = 10;

function fuzzyMatchRecursive(
  queryLower: string,
  textLower: string,
  textOriginal: string,
  queryIdx: number,
  textIdx: number,
  currentIndices: number[],
  depth: number,
): { score: number; indices: number[] } | null {
  if (queryIdx === queryLower.length) {
    return {
      score: scoreIndices(currentIndices, textOriginal),
      indices: [...currentIndices],
    };
  }
  if (textIdx >= textLower.length) return null;
  if (depth > MAX_RECURSION) {
    // Fall back to greedy match from current position
    const indices = [...currentIndices];
    let qi = queryIdx;
    for (let i = textIdx; i < textLower.length && qi < queryLower.length; i++) {
      if (textLower[i] === queryLower[qi]) {
        indices.push(i);
        qi++;
      }
    }
    if (qi !== queryLower.length) return null;
    return { score: scoreIndices(indices, textOriginal), indices };
  }

  let best: { score: number; indices: number[] } | null = null;

  for (let i = textIdx; i < textLower.length; i++) {
    if (textLower[i] !== queryLower[queryIdx]) continue;

    const result = fuzzyMatchRecursive(
      queryLower,
      textLower,
      textOriginal,
      queryIdx + 1,
      i + 1,
      [...currentIndices, i],
      depth + 1,
    );

    if (result && (!best || result.score > best.score)) {
      best = result;
    }

    // Only explore a limited number of starting positions for this char
    // to avoid exponential blowup, but enough to find good matches
    if (currentIndices.length === 0 && i - textIdx > 20) break;
  }

  return best;
}

function scoreIndices(indices: number[], text: string): number {
  if (indices.length === 0) return 0;

  let score = 0;

  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];

    // Consecutive match bonus (strongest signal)
    if (i > 0 && indices[i - 1] === idx - 1) {
      score += 15;
    }

    // Word boundary bonus (after separator or camelCase)
    const prevChar = idx > 0 ? text[idx - 1] : "";
    const currChar = text[idx];
    if (idx === 0) {
      score += 10; // Start of string
    } else if (/[/\\._\-\s]/.test(prevChar)) {
      score += 10; // After separator
    } else if (
      prevChar === prevChar.toLowerCase() &&
      currChar === currChar.toUpperCase() &&
      currChar !== currChar.toLowerCase()
    ) {
      score += 8; // camelCase boundary
    }

    // Penalize large gaps between matches
    if (i > 0) {
      const gap = idx - indices[i - 1] - 1;
      if (gap > 0) {
        score -= Math.min(gap, 5); // Cap gap penalty
      }
    }
  }

  // Prefer shorter texts (tighter matches)
  score += Math.max(0, 100 - text.length);

  // Bonus for match starting earlier in the string
  score += Math.max(0, 10 - indices[0]);

  return score;
}

// Match multiple space-separated terms against text (all must match)
function fuzzyMatchTerms(
  terms: string[],
  text: string,
): { score: number; indices: number[] } | null {
  if (terms.length === 0) return null;
  if (terms.length === 1) return fuzzyMatch(terms[0], text);

  let totalScore = 0;
  const allIndices: number[] = [];

  for (const term of terms) {
    const result = fuzzyMatch(term, text);
    if (!result) return null; // All terms must match
    totalScore += result.score;
    allIndices.push(...result.indices);
  }

  // Deduplicate and sort indices for highlighting
  const uniqueIndices = [...new Set(allIndices)].sort((a, b) => a - b);

  return { score: totalScore, indices: uniqueIndices };
}

// Extract filename from path
function getFileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

// Highlight matched characters in text
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

export function FileFinder({ isOpen, onClose }: FileFinderProps) {
  const { allFiles, files, navigateToBrowse } = useReviewStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Get changed file paths for highlighting
  const changedPaths = useMemo(() => {
    const changed = new Set<string>();
    const collectChanged = (entries: FileEntry[]) => {
      for (const entry of entries) {
        if (entry.status && !entry.isDirectory) {
          changed.add(entry.path);
        }
        if (entry.children) {
          collectChanged(entry.children);
        }
      }
    };
    collectChanged(files);
    return changed;
  }, [files]);

  // Compute filtered and sorted results
  const results = useMemo(() => {
    const flatFiles = flattenAllFiles(allFiles);

    if (!query.trim()) {
      // Show changed files first when no query
      const matches: FuzzyMatch[] = flatFiles.map((f) => ({
        path: f.path,
        name: getFileName(f.path),
        score: 0,
        matchIndices: [],
        isChanged: changedPaths.has(f.path),
      }));

      // Sort: changed files first, then alphabetically
      matches.sort((a, b) => {
        if (a.isChanged !== b.isChanged) return a.isChanged ? -1 : 1;
        return a.path.localeCompare(b.path);
      });

      return matches.slice(0, 50);
    }

    const matches: FuzzyMatch[] = [];

    for (const file of flatFiles) {
      const fileName = getFileName(file.path);
      const isChanged = changedPaths.has(file.path);

      // Split query on spaces to support multi-term matching
      const terms = query.split(/\s+/).filter(Boolean);

      // Try matching against filename first (higher weight)
      const filenameMatch = fuzzyMatchTerms(terms, fileName);
      // Also try matching against full path
      const pathMatch = fuzzyMatchTerms(terms, file.path);

      let bestScore = -1;
      let bestIndices: number[] = [];

      if (filenameMatch) {
        // Filename matches get bonus, adjust indices to path position
        const filenameStartIndex = file.path.length - fileName.length;
        const adjustedIndices = filenameMatch.indices.map(
          (i) => i + filenameStartIndex,
        );
        bestScore = filenameMatch.score + 50; // Filename bonus
        bestIndices = adjustedIndices;
      }

      if (pathMatch && pathMatch.score > bestScore) {
        bestScore = pathMatch.score;
        bestIndices = pathMatch.indices;
      }

      if (bestScore >= 0) {
        // Bonus for changed files
        if (isChanged) {
          bestScore += 20;
        }

        matches.push({
          path: file.path,
          name: fileName,
          score: bestScore,
          matchIndices: bestIndices,
          isChanged,
        });
      }
    }

    // Sort by score (descending), then changed status, then path
    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.isChanged !== b.isChanged) return a.isChanged ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    return matches.slice(0, 50);
  }, [allFiles, files, query, changedPaths]);

  // Reset selection when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [results]);

  // Focus input when modal opens
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setSelectedIndex(0);
      // Small delay to ensure modal is rendered
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
    (path: string) => {
      navigateToBrowse(path);
      onClose();
    },
    [navigateToBrowse, onClose],
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
            handleSelect(results[selectedIndex].path);
          }
          break;
      }
    },
    [results, selectedIndex, handleSelect],
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogPortal>
        <DialogOverlay className="items-start pt-[15vh]">
          <DialogPrimitive.Content
            className="w-full max-w-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <VisuallyHidden.Root>
              <DialogPrimitive.Title>Find File</DialogPrimitive.Title>
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
                    placeholder="Find file..."
                    aria-label="Find file"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    autoComplete="off"
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
                aria-label="File search results"
              >
                {results.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-stone-500">
                    {query ? "No matching files" : "No files available"}
                  </div>
                ) : (
                  results.map((result, index) => (
                    <button
                      key={result.path}
                      data-index={index}
                      role="option"
                      aria-selected={index === selectedIndex}
                      onClick={() => handleSelect(result.path)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        index === selectedIndex
                          ? "bg-stone-800"
                          : "hover:bg-stone-800/50"
                      }`}
                    >
                      {/* File icon */}
                      <svg
                        className={`h-4 w-4 flex-shrink-0 ${
                          result.isChanged ? "text-amber-500" : "text-stone-500"
                        }`}
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

                      {/* File path with highlighted matches */}
                      <div className="flex-1 min-w-0 font-mono text-sm">
                        <span className="text-stone-300 truncate block">
                          <HighlightedText
                            text={result.path}
                            indices={result.matchIndices}
                          />
                        </span>
                      </div>

                      {/* Changed indicator */}
                      {result.isChanged && (
                        <span className="text-xxs text-amber-500/80 flex-shrink-0">
                          changed
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
                <span>{results.length} files</span>
              </div>
            </div>
          </DialogPrimitive.Content>
        </DialogOverlay>
      </DialogPortal>
    </Dialog>
  );
}
