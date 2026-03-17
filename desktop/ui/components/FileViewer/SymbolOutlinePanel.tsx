import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useReviewStore } from "../../stores";
import type { FileSymbol, SymbolDiff, SymbolChangeType } from "../../types";
import { ChangeIndicator, SymbolKindBadge } from "../symbols";
import {
  fuzzyMatch,
  HighlightedText,
  buildDiffLookup,
  nestMarkdownHeadings,
} from "../symbols/utils";
import { isMarkdownFile } from "./languageMap";

interface SymbolOutlinePanelProps {
  filePath: string;
  scrollNode: HTMLDivElement | null;
  symbols: FileSymbol[];
}

/** FileSymbol augmented with optional diff change type. */
interface OutlineSymbol {
  name: string;
  kind: FileSymbol["kind"];
  startLine: number;
  endLine: number;
  depth?: number;
  changeType?: SymbolChangeType;
  children: OutlineSymbol[];
}

function mergeSymbolsWithDiff(
  symbols: FileSymbol[],
  diffLookup: Map<string, { diff: SymbolDiff; parentName: string | null }>,
): OutlineSymbol[] {
  return symbols.map((sym) => {
    const key = `${sym.name}|${sym.kind}`;
    const diffEntry = diffLookup.get(key);
    return {
      name: sym.name,
      kind: sym.kind,
      startLine: sym.startLine,
      endLine: sym.endLine,
      depth: sym.depth,
      changeType: diffEntry?.diff.changeType,
      children: mergeSymbolsWithDiff(sym.children, diffLookup),
    };
  });
}

export const SymbolOutlinePanel = memo(function SymbolOutlinePanel({
  filePath,
  scrollNode,
  symbols: allSymbols,
}: SymbolOutlinePanelProps) {
  const symbolDiffs = useReviewStore((s) => s.symbolDiffs);
  const toggleOutline = useReviewStore((s) => s.toggleOutline);
  const codeFontSize = useReviewStore((s) => s.codeFontSize);

  const [filter, setFilter] = useState("");
  const [activeStartLine, setActiveStartLine] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Reset filter when file changes
  useEffect(() => {
    setFilter("");
  }, [filePath]);

  // Build diff lookup
  const diffLookup = useMemo(() => {
    const lookup = new Map<
      string,
      { diff: SymbolDiff; parentName: string | null }
    >();
    const fileDiff = symbolDiffs.find((d) => d.filePath === filePath);
    if (fileDiff) {
      buildDiffLookup(fileDiff.symbols, null, lookup);
    }
    return lookup;
  }, [symbolDiffs, filePath]);

  // Build outline tree
  const outlineSymbols = useMemo((): OutlineSymbol[] => {
    if (allSymbols.length === 0) return [];

    if (isMarkdownFile(filePath)) {
      const nested = nestMarkdownHeadings(allSymbols);
      return mergeSymbolsWithDiff(nested, diffLookup);
    }
    return mergeSymbolsWithDiff(allSymbols, diffLookup);
  }, [allSymbols, filePath, diffLookup]);

  // Filter symbols
  const filteredSymbols = useMemo(() => {
    if (!filter.trim()) return outlineSymbols;

    function filterTree(symbols: OutlineSymbol[]): OutlineSymbol[] {
      const result: OutlineSymbol[] = [];
      for (const sym of symbols) {
        const match = fuzzyMatch(filter, sym.name);
        const filteredChildren = filterTree(sym.children);
        if (match || filteredChildren.length > 0) {
          result.push({ ...sym, children: filteredChildren });
        }
      }
      return result;
    }

    return filterTree(outlineSymbols);
  }, [outlineSymbols, filter]);

  // Scroll tracking: use a ref for the latest symbols so the scroll handler
  // doesn't need to re-attach when the tree changes.
  const symbolsRef = useRef(outlineSymbols);
  symbolsRef.current = outlineSymbols;

  const lineHeight = Math.round(codeFontSize * 1.5);

  useEffect(() => {
    if (!scrollNode) return;

    let rafId: number;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const approxLine = Math.floor(scrollNode.scrollTop / lineHeight) + 1;
        const found = findSymbolStartLineAt(symbolsRef.current, approxLine);
        setActiveStartLine((prev) => (prev === found ? prev : found));
      });
    };

    scrollNode.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // initial
    return () => {
      scrollNode.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [scrollNode, lineHeight]);

  // Auto-scroll outline list to keep active item visible
  useEffect(() => {
    if (activeStartLine === null || !listRef.current) return;
    const el = listRef.current.querySelector(
      `[data-symbol-line="${activeStartLine}"]`,
    );
    if (el) {
      el.scrollIntoView({ block: "nearest" });
    }
  }, [activeStartLine]);

  const handleSymbolClick = useCallback(
    (startLine: number) => {
      useReviewStore.setState({
        scrollTarget: {
          type: "line",
          filePath,
          lineNumber: startLine,
        },
      });
    },
    [filePath],
  );

  if (outlineSymbols.length === 0) {
    return null;
  }

  return (
    <div className="absolute top-2 right-5 z-10 w-56 max-h-[60vh] flex flex-col rounded-lg border border-edge-default/50 bg-surface-panel/95 backdrop-blur-xl shadow-xl shadow-black/40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-edge/50">
        <span className="text-xxs font-medium text-fg-muted">Outline</span>
        <button
          onClick={toggleOutline}
          className="rounded p-0.5 text-fg-muted hover:text-fg-secondary hover:bg-surface-raised transition-colors"
          aria-label="Close outline"
        >
          <svg
            className="h-3 w-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Filter input */}
      <div className="px-2 py-1.5 border-b border-edge/30">
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter…"
          className="w-full bg-transparent text-xxs text-fg placeholder-fg-faint focus:outline-hidden px-1"
        />
      </div>

      {/* Symbol tree */}
      <div ref={listRef} className="flex-1 overflow-y-auto scrollbar-thin py-1">
        {filteredSymbols.length === 0 ? (
          <div className="px-3 py-2 text-xxs text-fg-faint text-center">
            No matching symbols
          </div>
        ) : (
          filteredSymbols.map((sym) => (
            <OutlineNode
              key={`${sym.name}-${sym.startLine}`}
              symbol={sym}
              depth={0}
              activeStartLine={activeStartLine}
              filter={filter}
              onClick={handleSymbolClick}
            />
          ))
        )}
      </div>
    </div>
  );
});

const OutlineNode = memo(function OutlineNode({
  symbol,
  depth,
  activeStartLine,
  filter,
  onClick,
}: {
  symbol: OutlineSymbol;
  depth: number;
  activeStartLine: number | null;
  filter: string;
  onClick: (startLine: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = symbol.children.length > 0;
  const isActive = activeStartLine === symbol.startLine;
  const matchResult = filter ? fuzzyMatch(filter, symbol.name) : null;

  return (
    <>
      <div
        data-symbol-line={symbol.startLine}
        className={`group flex items-center gap-1 py-0.5 pr-2 cursor-pointer transition-colors ${
          isActive
            ? "bg-surface-raised/60 text-fg-secondary"
            : "hover:bg-surface-raised/30"
        }`}
        style={{ paddingLeft: `${depth * 0.6 + 0.5}rem` }}
        onClick={() => onClick(symbol.startLine)}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            className="flex-shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
          >
            <svg
              className={`h-2.5 w-2.5 text-fg-faint transition-transform ${expanded ? "rotate-90" : ""}`}
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M10 6l6 6-6 6" />
            </svg>
          </button>
        ) : (
          <span className="w-2.5 flex-shrink-0" />
        )}

        {/* Change indicator */}
        {symbol.changeType ? (
          <ChangeIndicator changeType={symbol.changeType} />
        ) : (
          <span className="w-3 flex-shrink-0" />
        )}

        {/* Kind badge */}
        <SymbolKindBadge kind={symbol.kind} />

        {/* Name */}
        <span
          className={`min-w-0 flex-1 truncate text-xxs font-mono ${
            symbol.changeType ? "text-fg-secondary" : "text-fg-muted"
          }`}
        >
          {matchResult ? (
            <HighlightedText text={symbol.name} indices={matchResult.indices} />
          ) : (
            symbol.name
          )}
        </span>
      </div>

      {/* Children */}
      {expanded &&
        hasChildren &&
        symbol.children.map((child) => (
          <OutlineNode
            key={`${child.name}-${child.startLine}`}
            symbol={child}
            depth={depth + 1}
            activeStartLine={activeStartLine}
            filter={filter}
            onClick={onClick}
          />
        ))}
    </>
  );
});

/** Find the startLine of the deepest symbol whose range contains the given line. */
function findSymbolStartLineAt(
  symbols: OutlineSymbol[],
  line: number,
): number | null {
  for (const sym of symbols) {
    if (line >= sym.startLine && line <= sym.endLine) {
      const childMatch = findSymbolStartLineAt(sym.children, line);
      return childMatch ?? sym.startLine;
    }
  }
  return null;
}
