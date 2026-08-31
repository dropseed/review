import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useSpurStore } from "../../stores";
import { useDebounce } from "../../hooks/useDebounce";
import { SymbolKindBadge } from "../symbols";
import { HighlightedText } from "../../lib/fuzzy";
import { scoreSymbol } from "../symbols/score";
import { FileGroupHeader } from "./FileGroupHeader";
import { SearchMessage } from "./SearchMessage";
import type { FileSymbol, RepoFileSymbols } from "../../types";

interface FlatRepoSymbol {
  filePath: string;
  name: string;
  kind: FileSymbol["kind"];
  startLine: number;
  parentName: string | null;
}

function flattenFileSymbols(
  filePath: string,
  symbols: FileSymbol[],
  parentName: string | null,
  out: FlatRepoSymbol[],
) {
  for (const sym of symbols) {
    out.push({
      filePath,
      name: sym.name,
      kind: sym.kind,
      startLine: sym.startLine,
      parentName,
    });
    if (sym.children.length > 0) {
      flattenFileSymbols(filePath, sym.children, sym.name, out);
    }
  }
}

function flattenRepoSymbols(repoSymbols: RepoFileSymbols[]): FlatRepoSymbol[] {
  const result: FlatRepoSymbol[] = [];
  for (const file of repoSymbols) {
    flattenFileSymbols(file.filePath, file.symbols, null, result);
  }
  return result;
}

interface SymbolSearchResult {
  symbol: FlatRepoSymbol;
  score: number;
  matchIndices: number[];
}

function searchSymbols(
  allSymbols: FlatRepoSymbol[],
  query: string,
  limit: number,
): SymbolSearchResult[] {
  if (!query.trim()) return [];

  const results: SymbolSearchResult[] = [];
  for (const sym of allSymbols) {
    const scored = scoreSymbol(query, sym);
    if (!scored) continue;
    results.push({ symbol: sym, ...scored });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

interface GroupedResults {
  filePath: string;
  matches: SymbolSearchResult[];
}

function groupByFile(results: SymbolSearchResult[]): GroupedResults[] {
  const groups = new Map<string, SymbolSearchResult[]>();
  for (const r of results) {
    const existing = groups.get(r.symbol.filePath);
    if (existing) {
      existing.push(r);
    } else {
      groups.set(r.symbol.filePath, [r]);
    }
  }
  return Array.from(groups, ([filePath, matches]) => ({ filePath, matches }));
}

export function SymbolResults({ query }: { query: string }): ReactNode {
  const repoSymbols = useSpurStore((s) => s.repoSymbols);
  const repoSymbolsLoading = useSpurStore((s) => s.repoSymbolsLoading);
  const repoSymbolsLoaded = useSpurStore((s) => s.repoSymbolsLoaded);
  const loadRepoSymbols = useSpurStore((s) => s.loadRepoSymbols);

  // Load repo symbols on first render
  useEffect(() => {
    if (!repoSymbolsLoaded && !repoSymbolsLoading) {
      loadRepoSymbols();
    }
  }, [repoSymbolsLoaded, repoSymbolsLoading, loadRepoSymbols]);

  const debouncedQuery = useDebounce(query, 150);

  const allFlat = useMemo(() => flattenRepoSymbols(repoSymbols), [repoSymbols]);

  const results = useMemo(
    () => searchSymbols(allFlat, debouncedQuery, 200),
    [allFlat, debouncedQuery],
  );

  const grouped = useMemo(() => groupByFile(results), [results]);

  const handleSelect = (sym: FlatRepoSymbol) => {
    // The store action rather than a `set` bag of our own: picking a symbol is
    // the same act as picking a search hit, and the hand-rolled version of it
    // here had already fallen behind on what a navigation has to clear.
    useSpurStore.getState().navigateToFileLine(sym.filePath, sym.startLine);
  };

  if (repoSymbolsLoading) {
    return <SearchMessage>Loading symbols…</SearchMessage>;
  }

  if (!debouncedQuery.trim()) {
    return <SearchMessage>Type to search symbols…</SearchMessage>;
  }

  if (results.length === 0) {
    return <SearchMessage>No matching symbols</SearchMessage>;
  }

  return (
    <>
      <div className="flex-1 overflow-y-auto scrollbar-thin pb-8">
        {grouped.map((group) => (
          <div key={group.filePath}>
            <FileGroupHeader
              filePath={group.filePath}
              count={group.matches.length}
            />
            {group.matches.map((result) => (
              <button
                key={`${result.symbol.filePath}:${result.symbol.name}:${result.symbol.startLine}`}
                onClick={() => handleSelect(result.symbol)}
                className="flex w-full items-center gap-3 px-4 py-1 text-left transition-colors hover:bg-surface-raised/50"
              >
                <SymbolKindBadge kind={result.symbol.kind} />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-secondary">
                  <HighlightedText
                    text={result.symbol.name}
                    indices={result.matchIndices}
                  />
                </span>
                {result.symbol.parentName && (
                  <span className="text-xxs text-fg-faint flex-shrink-0 truncate max-w-[8rem]">
                    in {result.symbol.parentName}
                  </span>
                )}
                <span className="w-12 shrink-0 text-right font-mono text-xs text-fg-faint tabular-nums">
                  {result.symbol.startLine}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="border-t border-edge/50 px-4 py-1.5 text-xxs text-fg-muted"
        aria-live="polite"
      >
        {results.length >= 200 ? "200+" : results.length} symbol
        {results.length !== 1 ? "s" : ""} in {grouped.length} file
        {grouped.length !== 1 ? "s" : ""}
      </div>
    </>
  );
}
