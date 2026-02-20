import type { DiffHunk } from "../types";

/**
 * Compute a content key for a hunk based on its changed lines (ignoring context).
 * Used to group identical changes across different files for batch operations.
 */
export function getChangedLinesKey(hunk: DiffHunk): string {
  return hunk.lines
    .filter((l) => l.type === "added" || l.type === "removed")
    .map((l) => `${l.type}:${l.content}`)
    .join("\n");
}
