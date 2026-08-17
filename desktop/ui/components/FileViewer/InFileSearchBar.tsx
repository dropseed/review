import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { FindBar } from "../ui/find-bar";

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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
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
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
      // Cmd+F with the bar already focused re-selects the query for
      // overwriting.
      e.preventDefault();
      e.currentTarget.select();
    }
  };

  const hasQuery = query.length > 0;
  const noResults = hasQuery && matchingLines.length === 0;
  const countLabel = !hasQuery
    ? ""
    : noResults
      ? "No results"
      : `${currentMatchIndex + 1} of ${matchingLines.length}`;

  return (
    <FindBar
      inputRef={inputRef}
      placeholder="Find in file…"
      query={query}
      onQueryChange={setQuery}
      onInputKeyDown={handleKeyDown}
      caseSensitive={caseSensitive}
      onToggleCase={() => setCaseSensitive(!caseSensitive)}
      countLabel={countLabel}
      noResults={noResults}
      navDisabled={matchingLines.length === 0}
      onPrev={goToPrev}
      onNext={goToNext}
      onClose={onClose}
      closeLabel="Close search"
    />
  );
}
