import { useEffect, useMemo, useRef, useState } from "react";
import { FindBar } from "../ui/find-bar";
import { useReviewStore } from "../../stores";
import { getSearchAddon, setTerminalFocus } from "./registry";
import { buildSearchDecorations } from "./xterm-theme";

interface TerminalSearchBarProps {
  /** The session whose buffer is searched. */
  id: string;
}

/**
 * Typing pause before the live search runs. An incremental find re-scans the
 * whole scrollback and rebuilds every match decoration, so a typed word should
 * cost one pass, not one per letter. Enter/⇧Enter stay immediate.
 */
const FIND_DEBOUNCE_MS = 120;

/** "Nothing counted yet" — module-level so resets keep one identity. */
const NO_RESULTS = { index: -1, count: 0 };

/**
 * The ⌘F bar over one terminal pane, driving the instance's SearchAddon
 * (registry-owned, so matches survive this bar unmounting on a tab switch).
 * Same chrome and grammar as the file viewer's InFileSearchBar, via the shared
 * FindBar: Enter/⇧Enter walk matches, Aa toggles case, Escape hands focus back
 * to the shell.
 */
export function TerminalSearchBar({ id }: TerminalSearchBarProps) {
  const setTerminalSearchId = useReviewStore((s) => s.setTerminalSearchId);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState(NO_RESULTS);

  // Per mount, like buildXtermTheme per mount: a theme change lands on the
  // next open, and the addon only reads these when it rebuilds highlights.
  const decorations = useMemo(buildSearchDecorations, []);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Match counts come back from the addon (it re-runs an open search when the
  // buffer changes under it), so the count stays honest on a live terminal —
  // which also means it fires with unchanged numbers on every output batch,
  // hence the identity-preserving set.
  useEffect(() => {
    const search = getSearchAddon(id);
    if (!search) return;
    const sub = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setResults((prev) =>
        prev.index === resultIndex && prev.count === resultCount
          ? prev
          : { index: resultIndex, count: resultCount },
      );
    });
    return () => sub.dispose();
  }, [id]);

  const find = (direction: "next" | "prev", incremental = false) => {
    const search = getSearchAddon(id);
    if (!search) return;
    if (!query) {
      search.clearDecorations();
      setResults(NO_RESULTS);
      return;
    }
    const options = { caseSensitive, incremental, decorations };
    if (direction === "next") search.findNext(query, options);
    else search.findPrevious(query, options);
  };

  // Live search as the query or case mode changes. Incremental, so a growing
  // query extends the current match instead of hopping to the one after it;
  // debounced, except clearing, which should drop the highlights at once.
  useEffect(() => {
    if (!query) {
      find("next", true);
      return;
    }
    const timer = setTimeout(() => find("next", true), FIND_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, query, caseSensitive]);

  // Leaving the bar (Escape, ✕, tab close) takes the highlights with it.
  useEffect(() => {
    return () => getSearchAddon(id)?.clearDecorations();
  }, [id]);

  const close = () => {
    setTerminalSearchId(null);
    setTerminalFocus(id, true);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Enter") {
      e.preventDefault();
      find(e.shiftKey ? "prev" : "next");
    } else if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === "f") {
      // ⌘F with the bar already focused re-selects the query for overwriting.
      e.preventDefault();
      e.currentTarget.select();
    }
  };

  const hasQuery = query.length > 0;
  const noResults = hasQuery && results.count === 0;
  // Index -1 with matches means the addon passed its highlight limit — the
  // count is still right, there's just no "which one" to name.
  const countLabel = !hasQuery
    ? ""
    : noResults
      ? "No results"
      : results.index >= 0
        ? `${results.index + 1} of ${results.count}`
        : `${results.count} matches`;

  return (
    <FindBar
      inputRef={inputRef}
      placeholder="Find in terminal…"
      query={query}
      onQueryChange={setQuery}
      onInputKeyDown={handleKeyDown}
      caseSensitive={caseSensitive}
      onToggleCase={() => setCaseSensitive(!caseSensitive)}
      countLabel={countLabel}
      noResults={noResults}
      navDisabled={!hasQuery}
      onPrev={() => find("prev")}
      onNext={() => find("next")}
      onClose={close}
      closeLabel="Close search"
    />
  );
}
