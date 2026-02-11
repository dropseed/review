import type { DiffHunk } from "../types";

export interface SymbolReferenceInDiff {
  filePath: string;
  hunkId: string;
  lineNumber: number;
  lineContent: string;
  side: "added" | "removed" | "context";
}

const MAX_RESULTS = 50;

/**
 * Find all references to a symbol name within the loaded diff hunks.
 * Uses word-boundary matching to avoid partial matches.
 * This is instant since hunk data is already in memory.
 */
export function findSymbolReferencesInDiff(
  symbolName: string,
  hunks: DiffHunk[],
): SymbolReferenceInDiff[] {
  const results: SymbolReferenceInDiff[] = [];
  const pattern = new RegExp(`\\b${escapeRegex(symbolName)}\\b`);

  for (const hunk of hunks) {
    for (const line of hunk.lines) {
      if (results.length >= MAX_RESULTS) return results;
      if (pattern.test(line.content)) {
        results.push({
          filePath: hunk.filePath,
          hunkId: hunk.id,
          lineNumber: line.newLineNumber ?? line.oldLineNumber ?? hunk.newStart,
          lineContent: line.content,
          side: line.type,
        });
      }
    }
  }

  return results;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
