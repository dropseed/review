import { useState, useEffect, useCallback, useMemo } from "react";
import { useReviewStore } from "../../stores";
import { useFileHunks } from "../../stores/selectors/hunks";
import { getApiClient } from "../../api";
import type { FileSymbol, SymbolDiff } from "../../types";
import { HighlightedText } from "../../lib/fuzzy";
import { scoreSymbol } from "../symbols/score";
import { PaletteDialog, countLabel } from "../palette";
import { ChangeIndicator, SymbolKindBadge } from "../symbols";
import {
  type FlatSymbol,
  type SymbolMatch,
  buildDiffLookup,
  flattenAllSymbols,
  flattenDiffSymbols,
} from "../symbols/utils";

interface SymbolSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

const CHANGE_ORDER: Record<string, number> = {
  modified: 0,
  added: 1,
  removed: 2,
};

/** A generated or vendored file can carry thousands of symbols. */
const MAX_RESULTS = 200;

function symbolKey(match: SymbolMatch): string {
  const { symbol } = match;
  return `${symbol.changeType ?? "none"}-${symbol.name}-${symbol.sortKey}`;
}

export function SymbolSearch({ isOpen, onClose }: SymbolSearchProps) {
  const selectedFile = useReviewStore((s) => s.selectedFile);
  const repoPath = useReviewStore((s) => s.repoPath);
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const fileHunks = useFileHunks(selectedFile);
  const navigateToBrowse = useReviewStore((s) => s.navigateToBrowse);

  const [query, setQuery] = useState("");
  const [allSymbols, setAllSymbols] = useState<FileSymbol[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    // Clear first: keeping the previous file's symbols around would merge them
    // with the new file's diff for a render, inventing symbols that are in
    // neither file.
    setAllSymbols(null);
    setError(null);
    setLoading(true);

    getApiClient()
      .getFileSymbols(repoPath, selectedFile)
      .then((symbols) => {
        if (cancelled) return;
        setAllSymbols(symbols);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setAllSymbols(null);
        // A failed fetch used to be indistinguishable from "this file has no
        // symbols", which reads as a missing feature rather than an error.
        setError(e instanceof Error ? e.message : "Failed to load symbols");
        setLoading(false);
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
      return sorted
        .slice(0, MAX_RESULTS)
        .map((s) => ({ symbol: s, score: 0, matchIndices: [] }));
    }

    const matches: SymbolMatch[] = [];
    for (const symbol of flatSymbols) {
      const scored = scoreSymbol(query, {
        name: symbol.name,
        parentName: symbol.parentName,
        changed: symbol.changeType !== null,
      });
      if (!scored) continue;

      matches.push({ symbol, ...scored });
    }

    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, MAX_RESULTS);
  }, [flatSymbols, query]);

  const handleActivate = useCallback(
    (match: SymbolMatch) => {
      if (!selectedFile) return;
      const { symbol } = match;

      // Determine which hunk to scroll to
      let targetHunkId: string | undefined;

      if (symbol.hunkIds.length > 0) {
        targetHunkId = symbol.hunkIds[0];
      } else {
        // No hunks (unchanged symbol) — find the nearest hunk by line number
        if (fileHunks.length > 0) {
          let closest = fileHunks[0];
          let closestDist = Math.abs(
            (fileHunks[0].newStart ?? 0) - symbol.sortKey,
          );
          for (const fh of fileHunks) {
            const dist = Math.abs((fh.newStart ?? 0) - symbol.sortKey);
            if (dist < closestDist) {
              closest = fh;
              closestDist = dist;
            }
          }
          targetHunkId = closest.id;
        }
      }

      // navigateToBrowse with scrollTo sets focusedHunkId without setting
      // scrollTarget, so we can follow up with a "line" scrollTarget that
      // both scrolls AND briefly highlights the symbol's line.
      navigateToBrowse(
        selectedFile,
        targetHunkId ? { hunkId: targetHunkId } : undefined,
      );

      if (symbol.sortKey > 0) {
        useReviewStore.setState({
          scrollTarget: {
            type: "line",
            filePath: selectedFile,
            lineNumber: symbol.sortKey,
          },
        });
      }

      onClose();
    },
    [selectedFile, fileHunks, navigateToBrowse, onClose],
  );

  const emptyMessage = !selectedFile
    ? "Select a file first"
    : loading
      ? "Loading symbols…"
      : !fileDiff && !allSymbols
        ? "No symbols available"
        : query
          ? "No matching symbols"
          : "No symbols in this file";

  return (
    <PaletteDialog<SymbolMatch>
      open={isOpen}
      onClose={onClose}
      title="Go to Symbol"
      query={query}
      onQueryChange={setQuery}
      placeholder="Search symbols…"
      items={results}
      getKey={symbolKey}
      renderRow={(match) => (
        <div className="flex items-center gap-2 px-4 py-2 text-left">
          {match.symbol.changeType ? (
            <ChangeIndicator changeType={match.symbol.changeType} />
          ) : (
            <span className="flex-shrink-0 w-3" />
          )}
          <SymbolKindBadge kind={match.symbol.kind} />
          <span
            className={`min-w-0 flex-1 truncate font-mono text-sm ${
              match.symbol.changeType ? "text-fg-secondary" : "text-fg-muted"
            }`}
          >
            <HighlightedText
              text={match.symbol.name}
              indices={match.matchIndices}
            />
          </span>
          {match.symbol.parentName && (
            <span className="flex-shrink-0 text-xs text-fg-faint">
              in {match.symbol.parentName}
            </span>
          )}
        </div>
      )}
      onActivate={handleActivate}
      busy={loading}
      error={error}
      emptyMessage={emptyMessage}
      renderCount={(n) => countLabel(n, "symbol")}
    />
  );
}
