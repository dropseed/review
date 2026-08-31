import { useState, useEffect, useCallback, useMemo, useRef, memo } from "react";
import { useSpurStore } from "../../stores";
import type { FileSymbol, SymbolDiff, SymbolChangeType } from "../../types";
import { ChangeIndicator, SymbolKindBadge } from "../symbols";
import { HighlightedText } from "../../lib/fuzzy";
import { scoreSymbol } from "../symbols/score";
import { buildDiffLookup, nestMarkdownHeadings } from "../symbols/utils";
import { isMarkdownFile } from "./languageMap";
import { rowToRealLine, type ShapeRow } from "./shape-model";
import { useCodeFont } from "../../hooks";

import { XIcon } from "../ui/icons";
interface SymbolOutlinePanelProps {
  filePath: string;
  scrollNode: HTMLDivElement | null;
  symbols: FileSymbol[];
  /**
   * Set in shape mode, where the view is a synthesized document: scroll
   * position then counts its lines, not the file's, so tracking which symbol
   * is on screen has to translate. Jumps need no such care — the FileViewer
   * translates every line target on its way to the scroller.
   */
  shapeRows?: readonly ShapeRow[];
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
  /** Offsets matched by the current filter, if this node matched it. */
  matchIndices?: number[];
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
  shapeRows,
}: SymbolOutlinePanelProps) {
  const symbolDiffs = useSpurStore((s) => s.symbolDiffs);
  const toggleOutline = useSpurStore((s) => s.toggleOutline);
  const { lineHeight } = useCodeFont();

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
        const match = scoreSymbol(filter, { name: sym.name, parentName: null });
        const filteredChildren = filterTree(sym.children);
        if (match || filteredChildren.length > 0) {
          // Carry the matched offsets on the node so rows can highlight
          // without re-running the matcher during render.
          result.push({
            ...sym,
            children: filteredChildren,
            matchIndices: match?.matchIndices,
          });
        }
      }
      return result;
    }

    return filterTree(outlineSymbols);
  }, [outlineSymbols, filter]);

  // Scroll tracking: the handler reads everything that changes more often
  // than the scroll node itself — the symbol tree, the row↔line mapping, the
  // line height — through refs, so the listener attaches once per node
  // instead of re-attaching on every fold toggle.
  const symbolsRef = useRef(outlineSymbols);
  symbolsRef.current = outlineSymbols;
  const geometryRef = useRef({ lineHeight, shapeRows });
  geometryRef.current = { lineHeight, shapeRows };
  const recomputeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!scrollNode) return;

    let rafId: number;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const { lineHeight, shapeRows } = geometryRef.current;
        const row = Math.floor(scrollNode.scrollTop / lineHeight) + 1;
        const approxLine = shapeRows ? rowToRealLine(shapeRows, row) : row;
        const found =
          approxLine === null
            ? null
            : findSymbolStartLineAt(symbolsRef.current, approxLine);
        setActiveStartLine((prev) => (prev === found ? prev : found));
      });
    };
    recomputeRef.current = handleScroll;

    scrollNode.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll(); // initial
    return () => {
      recomputeRef.current = null;
      scrollNode.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [scrollNode]);

  // A fold toggle (or zoom) rewrites the geometry under a scroll position
  // that hasn't moved, and no scroll event will fire to notice — recompute
  // the active symbol against the new mapping.
  useEffect(() => {
    recomputeRef.current?.();
  }, [lineHeight, shapeRows]);

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
      useSpurStore.setState({
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
          <XIcon className="h-3 w-3" strokeWidth={2.5} />
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
  onClick,
}: {
  symbol: OutlineSymbol;
  depth: number;
  activeStartLine: number | null;
  onClick: (startLine: number) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = symbol.children.length > 0;
  const isActive = activeStartLine === symbol.startLine;

  return (
    <>
      <div
        data-symbol-line={symbol.startLine}
        className={`group flex items-center gap-1 py-0.5 pr-2 transition-colors ${
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
          {symbol.matchIndices ? (
            <HighlightedText text={symbol.name} indices={symbol.matchIndices} />
          ) : (
            // Unfiltered rows render the bare string: HighlightedText would
            // build a Set and walk the name by code point for every row on
            // every render, and `?? []` would hand it a fresh array identity
            // each time so its own memo could never hit.
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
