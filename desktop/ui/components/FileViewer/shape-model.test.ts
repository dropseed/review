import { describe, it, expect } from "vitest";
import type { FileSymbol } from "../../types";
import {
  SHAPE_MARKER,
  buildShapeDocument,
  collectFolds,
  maxRealLine,
  rowAtDocLine,
} from "./shape-model";

function symbol(
  partial: Partial<FileSymbol> & Pick<FileSymbol, "name">,
): FileSymbol {
  return {
    kind: "function",
    startLine: 1,
    endLine: 10,
    children: [],
    ...partial,
  };
}

const EMPTY = new Set<string>();

describe("collectFolds", () => {
  it("folds functions and methods that declare a body start", () => {
    const folds = collectFolds([
      symbol({ name: "big", startLine: 1, endLine: 20, bodyStartLine: 2 }),
    ]);
    expect(folds).toEqual([
      { id: "2:20", name: "big", startLine: 2, endLine: 20 },
    ]);
  });

  it("skips symbols with no bodyStartLine (the Rust half may not send one)", () => {
    expect(collectFolds([symbol({ name: "unknown", endLine: 40 })])).toEqual(
      [],
    );
  });

  it("skips bodies below the adaptive threshold", () => {
    // 4 hidden lines (5..8) is under the 5-line minimum.
    const folds = collectFolds([
      symbol({ name: "tiny", startLine: 4, endLine: 8, bodyStartLine: 5 }),
    ]);
    expect(folds).toEqual([]);
  });

  it("recurses into containers so methods fold individually", () => {
    const folds = collectFolds([
      symbol({
        name: "Widget",
        kind: "class",
        startLine: 1,
        endLine: 40,
        bodyStartLine: 2,
        children: [
          symbol({
            name: "render",
            kind: "method",
            startLine: 3,
            endLine: 20,
            bodyStartLine: 4,
          }),
          symbol({
            name: "update",
            kind: "method",
            startLine: 22,
            endLine: 39,
            bodyStartLine: 23,
          }),
        ],
      }),
    ]);
    expect(folds.map((f) => f.name)).toEqual(["render", "update"]);
    // The class body itself is never folded — that would hide the methods.
    expect(folds.every((f) => f.startLine > 2)).toBe(true);
  });

  it("keeps only the outermost fold when functions nest", () => {
    const folds = collectFolds([
      symbol({
        name: "outer",
        startLine: 1,
        endLine: 30,
        bodyStartLine: 2,
        children: [
          symbol({
            name: "closure",
            startLine: 5,
            endLine: 15,
            bodyStartLine: 6,
          }),
        ],
      }),
    ]);
    expect(folds.map((f) => f.name)).toEqual(["outer"]);
  });

  it("still folds a nested function when its parent was too small to fold", () => {
    const folds = collectFolds([
      symbol({
        name: "thin",
        startLine: 1,
        endLine: 3,
        bodyStartLine: 2,
        children: [
          symbol({
            name: "inner",
            startLine: 5,
            endLine: 15,
            bodyStartLine: 6,
          }),
        ],
      }),
    ]);
    expect(folds.map((f) => f.name)).toEqual(["inner"]);
  });

  it("drops folds that overlap an earlier one", () => {
    const folds = collectFolds([
      symbol({ name: "a", startLine: 1, endLine: 20, bodyStartLine: 2 }),
      symbol({ name: "b", startLine: 10, endLine: 30, bodyStartLine: 11 }),
    ]);
    expect(folds.map((f) => f.name)).toEqual(["a"]);
  });
});

const FILE = [
  "import os", // 1
  "", // 2
  "", // 3
  "def greet(name):", // 4
  '    """Say hello."""', // 5
  "    a = 1", // 6
  "    b = 2", // 7
  "    c = 3", // 8
  "    return a + b + c", // 9
  "", // 10
  "", // 11
  "VALUE = 3", // 12
].join("\n");

const GREET = { id: "5:9", name: "greet", startLine: 5, endLine: 9 };

describe("buildShapeDocument", () => {
  it("replaces a collapsed body with one indent-matched marker line", () => {
    const doc = buildShapeDocument(FILE, [GREET], EMPTY);
    expect(doc.content.split("\n")).toEqual([
      "import os",
      "",
      "",
      "def greet(name):",
      `    ${SHAPE_MARKER}`,
      "",
      "",
      "VALUE = 3",
    ]);
    expect(doc.collapsedCount).toBe(1);
    expect(doc.hiddenLineCount).toBe(5);
  });

  it("maps every rendered row back to its real line number", () => {
    const doc = buildShapeDocument(FILE, [GREET], EMPTY);
    expect(
      doc.rows.map((r) => (r.kind === "code" ? r.line : "marker")),
    ).toEqual([1, 2, 3, 4, "marker", 10, 11, 12]);
    // The gap in the numbering is the elision signal.
    expect(doc.docLineByRealLine.get(12)).toBe(8);
    expect(doc.docLineByRealLine.has(6)).toBe(false);
    expect(maxRealLine(doc)).toBe(12);
  });

  it("carries the hidden range on the marker row", () => {
    const doc = buildShapeDocument(FILE, [GREET], EMPTY);
    const row = rowAtDocLine(doc, 5);
    expect(row).toEqual({
      kind: "marker",
      foldId: "5:9",
      foldName: "greet",
      startLine: 5,
      endLine: 9,
      hiddenLines: 5,
    });
  });

  it("restores the literal file when a fold is expanded", () => {
    const doc = buildShapeDocument(FILE, [GREET], new Set(["5:9"]));
    expect(doc.content).toBe(FILE);
    expect(doc.collapsedCount).toBe(0);
    expect(doc.hiddenLineCount).toBe(0);
  });

  /**
   * The whole reason expanding doesn't move the page: the marker occupies the
   * same row index that the body's first line takes once expanded.
   */
  it("puts the expanded body's first line at the marker's row index", () => {
    const collapsed = buildShapeDocument(FILE, [GREET], EMPTY);
    const expanded = buildShapeDocument(FILE, [GREET], new Set(["5:9"]));
    const markerIndex = collapsed.rows.findIndex((r) => r.kind === "marker");
    expect(expanded.rows[markerIndex]).toEqual({
      kind: "code",
      line: 5,
      foldId: "5:9",
      foldName: "greet",
    });
  });

  it("is a no-op when nothing folds", () => {
    const doc = buildShapeDocument(FILE, [], EMPTY);
    expect(doc.content).toBe(FILE);
    expect(doc.rows).toHaveLength(12);
  });

  it("preserves a trailing newline", () => {
    const doc = buildShapeDocument("a\nb\n", [], EMPTY);
    expect(doc.content).toBe("a\nb\n");
    expect(doc.rows).toHaveLength(2);
  });

  it("clamps a fold that runs past the end of the file", () => {
    const doc = buildShapeDocument(FILE, [{ ...GREET, endLine: 999 }], EMPTY);
    const last = doc.rows[doc.rows.length - 1];
    expect(last).toMatchObject({ kind: "marker", startLine: 5, endLine: 12 });
    expect(doc.content.endsWith(`    ${SHAPE_MARKER}`)).toBe(true);
  });

  it("indents the marker from the first non-blank hidden line", () => {
    const nested = ["class A:", "    def m(self):", "", "", "", "", ""].join(
      "\n",
    );
    const doc = buildShapeDocument(
      nested,
      [{ id: "3:7", name: "m", startLine: 3, endLine: 7 }],
      EMPTY,
    );
    // Body is entirely blank — fall back to the signature's indent plus a step.
    expect(doc.content.split("\n")[2]).toBe(`      ${SHAPE_MARKER}`);
  });
});
