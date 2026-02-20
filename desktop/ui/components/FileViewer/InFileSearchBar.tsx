import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { SimpleTooltip } from "../ui/tooltip";

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
    <div className="flex items-center gap-1.5 rounded-lg bg-surface-raised border border-edge-default/80 px-2 py-1.5 shadow-xl shadow-black/30">
      {/* Search input */}
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Find in file…"
          className={`w-44 rounded bg-surface-panel/80 border px-2 py-1 text-xs text-fg-secondary placeholder-fg-muted outline-hidden transition-colors focus:border-focus-ring/50 ${
            noResults
              ? "border-status-rejected/50 bg-status-rejected/5"
              : "border-edge-default/50"
          }`}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      {/* Case sensitivity toggle */}
      <SimpleTooltip
        content={caseSensitive ? "Case sensitive (on)" : "Case sensitive (off)"}
      >
        <button
          onClick={() => setCaseSensitive(!caseSensitive)}
          className={`flex h-6 w-6 items-center justify-center rounded text-xs font-bold transition-colors ${
            caseSensitive
              ? "bg-status-modified/20 text-status-modified"
              : "text-fg-muted hover:text-fg-secondary hover:bg-surface-hover/50"
          }`}
          aria-label="Toggle case sensitivity"
        >
          Aa
        </button>
      </SimpleTooltip>

      {/* Match count */}
      <span
        className={`min-w-[3.5rem] text-center text-xxs tabular-nums ${
          noResults ? "text-status-rejected" : "text-fg-muted"
        }`}
      >
        {hasQuery
          ? noResults
            ? "No results"
            : `${currentMatchIndex + 1} of ${matchingLines.length}`
          : ""}
      </span>

      {/* Previous match */}
      <SimpleTooltip content="Previous match (Shift+Enter)">
        <button
          onClick={goToPrev}
          disabled={matchingLines.length === 0}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover/50 hover:text-fg-secondary disabled:opacity-30 disabled:pointer-events-none"
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
      </SimpleTooltip>

      {/* Next match */}
      <SimpleTooltip content="Next match (Enter)">
        <button
          onClick={goToNext}
          disabled={matchingLines.length === 0}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover/50 hover:text-fg-secondary disabled:opacity-30 disabled:pointer-events-none"
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
      </SimpleTooltip>

      {/* Close */}
      <SimpleTooltip content="Close (Escape)">
        <button
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded text-fg-muted transition-colors hover:bg-surface-hover/50 hover:text-fg-secondary"
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
      </SimpleTooltip>
    </div>
  );
}
