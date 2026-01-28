import { useState, useEffect, useRef, useCallback, useMemo } from "react";

interface InFileSearchBarProps {
  content: string;
  onHighlightLine: (line: number | null) => void;
  onClose: () => void;
}

export function InFileSearchBar({
  content,
  onHighlightLine,
  onClose,
}: InFileSearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Select all text when Cmd+F is pressed while already open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
        e.preventDefault();
        inputRef.current?.select();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Find all matching line numbers
  const matchingLines = useMemo(() => {
    if (!query) return [];
    const lines = content.split("\n");
    const matches: number[] = [];
    const searchQuery = caseSensitive ? query : query.toLowerCase();
    for (let i = 0; i < lines.length; i++) {
      const line = caseSensitive ? lines[i] : lines[i].toLowerCase();
      if (line.includes(searchQuery)) {
        matches.push(i + 1); // 1-indexed line numbers
      }
    }
    return matches;
  }, [content, query, caseSensitive]);

  // Reset current match index when matches change
  useEffect(() => {
    setCurrentMatchIndex(0);
  }, [matchingLines.length, query, caseSensitive]);

  // Highlight the current match line
  useEffect(() => {
    if (matchingLines.length > 0 && currentMatchIndex < matchingLines.length) {
      onHighlightLine(matchingLines[currentMatchIndex]);
    } else {
      onHighlightLine(null);
    }
  }, [matchingLines, currentMatchIndex, onHighlightLine]);

  // Clear highlight on unmount
  useEffect(() => {
    return () => onHighlightLine(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goToNext = useCallback(() => {
    if (matchingLines.length === 0) return;
    setCurrentMatchIndex((prev) => (prev + 1) % matchingLines.length);
  }, [matchingLines.length]);

  const goToPrev = useCallback(() => {
    if (matchingLines.length === 0) return;
    setCurrentMatchIndex(
      (prev) => (prev - 1 + matchingLines.length) % matchingLines.length,
    );
  }, [matchingLines.length]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrev();
      } else {
        goToNext();
      }
    }
  };

  const hasQuery = query.length > 0;
  const noResults = hasQuery && matchingLines.length === 0;

  return (
    <div className="flex items-center gap-1.5 rounded-lg bg-stone-800 border border-stone-700/80 px-2 py-1.5 shadow-xl shadow-black/30">
      {/* Search input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in file…"
          className={`w-44 rounded bg-stone-900/80 border px-2 py-1 text-xs text-stone-200 placeholder-stone-500 outline-none transition-colors focus:border-amber-500/50 ${
            noResults
              ? "border-rose-500/50 bg-rose-500/5"
              : "border-stone-700/50"
          }`}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {/* Case sensitivity toggle */}
      <button
        onClick={() => setCaseSensitive(!caseSensitive)}
        className={`flex h-6 w-6 items-center justify-center rounded text-xs font-bold transition-colors ${
          caseSensitive
            ? "bg-amber-500/20 text-amber-400"
            : "text-stone-500 hover:text-stone-300 hover:bg-stone-700/50"
        }`}
        title={caseSensitive ? "Case sensitive (on)" : "Case sensitive (off)"}
        aria-label="Toggle case sensitivity"
      >
        Aa
      </button>

      {/* Match count */}
      <span
        className={`min-w-[3.5rem] text-center text-xxs tabular-nums ${
          noResults ? "text-rose-400" : "text-stone-500"
        }`}
      >
        {hasQuery
          ? noResults
            ? "No results"
            : `${currentMatchIndex + 1} of ${matchingLines.length}`
          : ""}
      </span>

      {/* Previous match */}
      <button
        onClick={goToPrev}
        disabled={matchingLines.length === 0}
        className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-700/50 hover:text-stone-200 disabled:opacity-30 disabled:pointer-events-none"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M5 15l7-7 7 7"
          />
        </svg>
      </button>

      {/* Next match */}
      <button
        onClick={goToNext}
        disabled={matchingLines.length === 0}
        className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-700/50 hover:text-stone-200 disabled:opacity-30 disabled:pointer-events-none"
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {/* Close */}
      <button
        onClick={onClose}
        className="flex h-6 w-6 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-700/50 hover:text-stone-200"
        title="Close (Escape)"
        aria-label="Close search"
      >
        <svg
          className="h-3.5 w-3.5"
          fill="none"
          viewBox="0 0 24 24"
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
    </div>
  );
}
