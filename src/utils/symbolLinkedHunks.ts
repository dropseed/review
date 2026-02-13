import type { FileSymbolDiff, SymbolDiff } from "../types";

export interface SymbolLinkedHunk {
  hunkId: string;
  symbolName: string;
  relationship: "defines" | "references";
  /**
   * For "references" entries: the 1-based line numbers in the linked hunk
   * where the symbol reference appears. Empty for "defines" entries.
   */
  referenceLineNumbers: number[];
}

/**
 * Build a bidirectional map from hunk ID to symbol-linked hunks.
 *
 * A "defining" hunk is one listed in a SymbolDiff.hunkIds (it modifies the symbol definition).
 * A "referencing" hunk is one listed in FileSymbolDiff.symbolReferences (it references the symbol).
 *
 * For each referencing hunk, we link it to the defining hunks (and vice versa).
 */
export function computeSymbolLinkedHunks(
  symbolDiffs: FileSymbolDiff[],
  identicalHunkIds?: Map<string, string[]>,
): Map<string, SymbolLinkedHunk[]> {
  // Build symbolName → defining hunk IDs
  const symbolToDefiningHunks = new Map<string, string[]>();

  function collectDefiningHunks(symbols: SymbolDiff[]) {
    for (const sym of symbols) {
      if (sym.hunkIds.length > 0) {
        const existing = symbolToDefiningHunks.get(sym.name) ?? [];
        existing.push(...sym.hunkIds);
        symbolToDefiningHunks.set(sym.name, existing);
      }
      collectDefiningHunks(sym.children);
    }
  }

  for (const fileDiff of symbolDiffs) {
    collectDefiningHunks(fileDiff.symbols);
  }

  // Build hunkId → symbol references (with line numbers)
  const hunkToRefs = new Map<
    string,
    { symbolName: string; lineNumbers: number[] }[]
  >();
  for (const fileDiff of symbolDiffs) {
    for (const ref of fileDiff.symbolReferences) {
      const existing = hunkToRefs.get(ref.hunkId) ?? [];
      existing.push({
        symbolName: ref.symbolName,
        lineNumbers: ref.lineNumbers,
      });
      hunkToRefs.set(ref.hunkId, existing);
    }
  }

  // Build set of identical hunk pairs for dedup
  const identicalPairs = new Set<string>();
  if (identicalHunkIds) {
    for (const [hunkId, ids] of identicalHunkIds) {
      for (const otherId of ids) {
        if (otherId !== hunkId) {
          identicalPairs.add(`${hunkId}:${otherId}`);
        }
      }
    }
  }

  // Link referencing hunks to defining hunks (bidirectional)
  const result = new Map<string, SymbolLinkedHunk[]>();
  const seen = new Set<string>();

  for (const [refHunkId, refs] of hunkToRefs) {
    for (const { symbolName, lineNumbers } of refs) {
      const definingHunkIds = symbolToDefiningHunks.get(symbolName) ?? [];
      for (const defHunkId of definingHunkIds) {
        // Skip self-references
        if (defHunkId === refHunkId) continue;
        // Skip same-file links (multiple hunks in the same class aren't cross-file connections)
        const refFile = refHunkId.slice(0, refHunkId.lastIndexOf(":"));
        const defFile = defHunkId.slice(0, defHunkId.lastIndexOf(":"));
        if (refFile === defFile) continue;
        // Skip if these hunks are already identical
        if (identicalPairs.has(`${refHunkId}:${defHunkId}`)) continue;

        // Add: refHunk -> defHunk (referencing hunk points to definition)
        const refKey = `${refHunkId}:${defHunkId}:${symbolName}`;
        if (!seen.has(refKey)) {
          seen.add(refKey);
          const refEntries = result.get(refHunkId) ?? [];
          refEntries.push({
            hunkId: defHunkId,
            symbolName,
            relationship: "defines",
            referenceLineNumbers: [],
          });
          result.set(refHunkId, refEntries);
        }

        // Add: defHunk -> refHunk (definition hunk points to references)
        const defKey = `${defHunkId}:${refHunkId}:${symbolName}`;
        if (!seen.has(defKey)) {
          seen.add(defKey);
          const defEntries = result.get(defHunkId) ?? [];
          defEntries.push({
            hunkId: refHunkId,
            symbolName,
            relationship: "references",
            referenceLineNumbers: lineNumbers,
          });
          result.set(defHunkId, defEntries);
        }
      }
    }
  }

  return result;
}
