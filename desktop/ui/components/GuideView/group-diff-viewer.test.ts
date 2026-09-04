import { describe, it, expect } from "vitest";
import { estimateSectionHeight } from "./GroupDiffViewer";
import type { DiffHunk } from "../../types";

function hunk(lines: number): DiffHunk {
  return {
    id: `f.ts:${lines}`,
    filePath: "f.ts",
    oldStart: 1,
    oldCount: lines,
    newStart: 1,
    newCount: lines,
    content: "",
    contentHash: String(lines),
    lines: Array.from({ length: lines }, () => ({
      type: "context" as const,
      content: "x",
    })),
  } as DiffHunk;
}

describe("deferred file sections", () => {
  /**
   * The estimate exists to give a placeholder a plausible height. What it must
   * never be is zero: 639 zero-height sections all sit inside one rootMargin,
   * so every one of them mounts at once and the deferral buys nothing.
   */
  it("stands a section up at roughly the height of its lines", () => {
    const height = estimateSectionHeight([hunk(50), hunk(30)], 20);

    expect(height).toBeGreaterThan(80 * 20);
    expect(height).toBeLessThan(80 * 20 + 200);
  });

  it("grows with the diff rather than being a constant", () => {
    const small = estimateSectionHeight([hunk(10)], 20);
    const large = estimateSectionHeight([hunk(1000)], 20);

    expect(large).toBeGreaterThan(small * 10);
  });

  it("is zero for a file with no hunks, which has nothing to stand up", () => {
    expect(estimateSectionHeight([], 20)).toBe(0);
  });
});
