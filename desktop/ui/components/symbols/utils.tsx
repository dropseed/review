import type {
  FileSymbol,
  SymbolDiff,
  SymbolChangeType,
  SymbolKind,
} from "../../types";

export interface FlatSymbol {
  name: string;
  kind: SymbolKind | null;
  changeType: SymbolChangeType | null;
  hunkIds: string[];
  parentName: string | null;
  sortKey: number;
}

export interface SymbolMatch {
  symbol: FlatSymbol;
  score: number;
  matchIndices: number[];
}

// Build a lookup of changed symbols from the diff: "name|kind" -> SymbolDiff
export function buildDiffLookup(
  symbols: SymbolDiff[],
  parentName: string | null,
  out: Map<string, { diff: SymbolDiff; parentName: string | null }>,
) {
  for (const sym of symbols) {
    const key = `${sym.name}|${sym.kind ?? ""}`;
    out.set(key, { diff: sym, parentName });
    if (sym.children.length > 0) {
      buildDiffLookup(sym.children, sym.name, out);
    }
  }
}

// Recursively flatten full symbols from tree-sitter, merging diff info
export function flattenAllSymbols(
  symbols: FileSymbol[],
  parentName: string | null,
  diffLookup: Map<string, { diff: SymbolDiff; parentName: string | null }>,
): FlatSymbol[] {
  const result: FlatSymbol[] = [];
  for (const sym of symbols) {
    const key = `${sym.name}|${sym.kind}`;
    const diffEntry = diffLookup.get(key);

    result.push({
      name: sym.name,
      kind: sym.kind,
      changeType: diffEntry?.diff.changeType ?? null,
      hunkIds: diffEntry?.diff.hunkIds ?? [],
      parentName: diffEntry?.parentName ?? parentName,
      sortKey: sym.startLine,
    });

    if (sym.children.length > 0) {
      result.push(...flattenAllSymbols(sym.children, sym.name, diffLookup));
    }
  }
  return result;
}

// Flatten diff-only symbols (for files without full symbol data)
export function flattenDiffSymbols(
  symbols: SymbolDiff[],
  parentName: string | null,
): FlatSymbol[] {
  const result: FlatSymbol[] = [];
  for (const sym of symbols) {
    const sortKey = sym.newRange?.startLine ?? sym.oldRange?.startLine ?? 0;
    if (sym.hunkIds.length > 0) {
      result.push({
        name: sym.name,
        kind: sym.kind,
        changeType: sym.changeType,
        hunkIds: sym.hunkIds,
        parentName,
        sortKey,
      });
    }
    if (sym.children.length > 0) {
      result.push(...flattenDiffSymbols(sym.children, sym.name));
    }
  }
  return result;
}

/**
 * Convert flat markdown heading list into nested tree based on `depth`.
 * Iterates symbols, maintaining a stack of ancestors; for each heading,
 * pops stack until top has a lower depth, then attaches as child.
 */
export function nestMarkdownHeadings(symbols: FileSymbol[]): FileSymbol[] {
  const root: FileSymbol[] = [];
  const stack: { symbol: FileSymbol; depth: number }[] = [];

  for (const sym of symbols) {
    const depth = sym.depth ?? 1;
    const nested: FileSymbol = { ...sym, children: [] };

    // Pop stack until we find a parent with a lower depth
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) {
      stack.pop();
    }

    if (stack.length > 0) {
      stack[stack.length - 1].symbol.children.push(nested);
    } else {
      root.push(nested);
    }

    stack.push({ symbol: nested, depth });
  }

  return root;
}
