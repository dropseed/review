import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useDebounce } from "../../hooks/useDebounce";
import { SymbolKindBadge } from "../symbols";
import { fuzzyMatch, HighlightedText } from "../symbols/utils";
import { FileGroupHeader } from "./FileGroupHeader";
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
    const match = fuzzyMatch(query, sym.name);
    if (match) {
      results.push({
        symbol: sym,
        score: match.score,
        matchIndices: match.indices,
      });
    }
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

export function SymbolSearchPanel({ query }: { query: string }): ReactNode {
  const repoSymbols = useReviewStore((s) => s.repoSymbols);
  const repoSymbolsLoading = useReviewStore((s) => s.repoSymbolsLoading);
  const repoSymbolsLoaded = useReviewStore((s) => s.repoSymbolsLoaded);
  const loadRepoSymbols = useReviewStore((s) => s.loadRepoSymbols);

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
    useReviewStore.setState({
      selectedFile: sym.filePath,
      filesPanelCollapsed: false,
      guideContentMode: null,
      focusedHunkId: null,
      scrollTarget: {
        type: "line",
        filePath: sym.filePath,
        lineNumber: sym.startLine,
      },
    });
  };

  if (repoSymbolsLoading) {
    return (
      <div className="px-4 py-8 text-center text-xs text-fg-muted">
        Loading symbols…
      </div>
    );
  }

  if (!debouncedQuery.trim()) {
    return (
      <div className="px-4 py-8 text-center text-xs text-fg-muted">
        Type to search symbols…
      </div>
    );
  }

  if (results.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-xs text-fg-muted">
        No matching symbols
      </div>
    );
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
                className="w-full flex items-center gap-2 px-3 py-1 text-left hover:bg-surface-raised/50 transition-colors"
              >
                <SymbolKindBadge kind={result.symbol.kind} />
                <span className="text-xxs font-mono text-fg-secondary truncate flex-1 min-w-0">
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
                <span className="text-xxs font-mono text-fg-faint w-6 text-right flex-shrink-0 tabular-nums">
                  {result.symbol.startLine}
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>

      {/* Footer */}
      <div
        className="border-t border-edge/50 px-3 py-1.5 text-xxs text-fg-muted"
        aria-live="polite"
      >
        {results.length >= 200 ? "200+" : results.length} symbol
        {results.length !== 1 ? "s" : ""} in {grouped.length} file
        {grouped.length !== 1 ? "s" : ""}
      </div>
    </>
  );
}
