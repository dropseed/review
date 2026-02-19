import type { DiffHunk } from "../../types";

/**
 * Returns the last changed line in a hunk with its side and line number.
 * Used to position comment editors when rejecting or commenting on a hunk.
 * Uses the last changed line so the comment appears on the same side as
 * the hunk annotation panel (which is positioned at the last changed line).
 */
export function getLastChangedLine(hunk: DiffHunk): {
  lineNumber: number;
  side: "old" | "new";
} {
  const changedLines = hunk.lines.filter(
    (l) => l.type === "added" || l.type === "removed",
  );
  const lastChanged = changedLines[changedLines.length - 1];

  if (!lastChanged) {
    return { lineNumber: hunk.newStart, side: "new" };
  }
  if (lastChanged.type === "removed") {
    return {
      lineNumber: lastChanged.oldLineNumber ?? hunk.oldStart,
      side: "old",
    };
  }
  return {
    lineNumber: lastChanged.newLineNumber ?? hunk.newStart,
    side: "new",
  };
}
