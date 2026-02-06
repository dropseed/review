import type { DiffHunk } from "../../types";

/**
 * Returns the first changed line in a hunk with its side and line number.
 * Used to position comment editors when rejecting or commenting on a hunk.
 */
export function getFirstChangedLine(hunk: DiffHunk): {
  lineNumber: number;
  side: "old" | "new";
} {
  const firstChanged = hunk.lines.find(
    (l) => l.type === "added" || l.type === "removed",
  );
  const side: "old" | "new" = firstChanged?.type === "removed" ? "old" : "new";
  const lineNumber =
    side === "old"
      ? (firstChanged?.oldLineNumber ?? hunk.oldStart)
      : (firstChanged?.newLineNumber ?? hunk.newStart);
  return { lineNumber, side };
}
