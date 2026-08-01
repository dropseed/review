import { describe, it, expect } from "vitest";
import type { FileSymbol } from "../../types";
import {
  SHAPE_MARKER,
  buildShapeDocument,
  collectFolds,
  maxRealLine,
  realLineToRow,
  rowToRealLine,
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

/** For cases where the fold's extent doesn't depend on what the lines say. */
const NO_TEXT: string[] = [];

describe("collectFolds", () => {
  it("folds functions and methods that declare a body start", () => {
    const folds = collectFolds(
      [symbol({ name: "big", startLine: 1, endLine: 20, bodyStartLine: 2 })],
      NO_TEXT,
    );
    expect(folds).toEqual([
      { id: "2:20", name: "big", startLine: 2, endLine: 20 },
    ]);
  });

  it("skips symbols with no bodyStartLine (the Rust half may not send one)", () => {
    expect(
      collectFolds([symbol({ name: "unknown", endLine: 40 })], NO_TEXT),
    ).toEqual([]);
  });

  it("skips bodies below the adaptive threshold", () => {
    // 4 hidden lines (5..8) is under the 5-line minimum.
    const folds = collectFolds(
      [symbol({ name: "tiny", startLine: 4, endLine: 8, bodyStartLine: 5 })],
      NO_TEXT,
    );
    expect(folds).toEqual([]);
  });

  it("recurses into containers so methods fold individually", () => {
    const folds = collectFolds(
      [
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
      ],
      NO_TEXT,
    );
    expect(folds.map((f) => f.name)).toEqual(["render", "update"]);
    // The class body itself is never folded — that would hide the methods.
    expect(folds.every((f) => f.startLine > 2)).toBe(true);
  });

  it("keeps only the outermost fold when functions nest", () => {
    const folds = collectFolds(
      [
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
      ],
      NO_TEXT,
    );
    expect(folds.map((f) => f.name)).toEqual(["outer"]);
  });

  it("still folds a nested function when its parent was too small to fold", () => {
    const folds = collectFolds(
      [
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
      ],
      NO_TEXT,
    );
    expect(folds.map((f) => f.name)).toEqual(["inner"]);
  });

  it("drops folds that overlap an earlier one", () => {
    const folds = collectFolds(
      [
        symbol({ name: "a", startLine: 1, endLine: 20, bodyStartLine: 2 }),
        symbol({ name: "b", startLine: 10, endLine: 30, bodyStartLine: 11 }),
      ],
      NO_TEXT,
    );
    expect(folds.map((f) => f.name)).toEqual(["a"]);
  });
});

const FILE_LINES = [
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
];
const FILE = FILE_LINES.join("\n");

const GREET = { id: "5:9", name: "greet", startLine: 5, endLine: 9 };

describe("buildShapeDocument", () => {
  it("replaces a collapsed body with one indent-matched marker line", () => {
    const doc = buildShapeDocument(FILE_LINES, [GREET], EMPTY);
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
    const markers = doc.rows.filter((r) => r.kind === "marker");
    expect(markers).toHaveLength(1);
    expect(markers[0]).toMatchObject({ hiddenLines: 5 });
  });

  it("maps every rendered row back to its real line number", () => {
    const doc = buildShapeDocument(FILE_LINES, [GREET], EMPTY);
    expect(
      doc.rows.map((r) => (r.kind === "code" ? r.line : "marker")),
    ).toEqual([1, 2, 3, 4, "marker", 10, 11, 12]);
    // The gap in the numbering is the elision signal: the hidden lines have no
    // row at all, and the lines after them keep their real numbers.
    expect(doc.rows[7]).toEqual({ kind: "code", line: 12 });
    expect(doc.rows.some((r) => r.kind === "code" && r.line === 6)).toBe(false);
    expect(maxRealLine(doc.rows)).toBe(12);
  });

  it("carries the hidden range on the marker row", () => {
    const doc = buildShapeDocument(FILE_LINES, [GREET], EMPTY);
    // `rows[n - 1]` describes doc line `n` — the marker is on doc line 5.
    expect(doc.rows[4]).toEqual({
      kind: "marker",
      foldId: "5:9",
      foldName: "greet",
      startLine: 5,
      endLine: 9,
      hiddenLines: 5,
    });
  });

  it("restores the literal file when a fold is expanded", () => {
    const doc = buildShapeDocument(FILE_LINES, [GREET], new Set(["5:9"]));
    expect(doc.content).toBe(FILE);
    expect(doc.rows.some((r) => r.kind === "marker")).toBe(false);
  });

  /**
   * The whole reason expanding doesn't move the page: the marker occupies the
   * same row index that the body's first line takes once expanded.
   */
  it("puts the expanded body's first line at the marker's row index", () => {
    const collapsed = buildShapeDocument(FILE_LINES, [GREET], EMPTY);
    const expanded = buildShapeDocument(FILE_LINES, [GREET], new Set(["5:9"]));
    const markerIndex = collapsed.rows.findIndex((r) => r.kind === "marker");
    expect(expanded.rows[markerIndex]).toEqual({
      kind: "code",
      line: 5,
      foldId: "5:9",
      foldName: "greet",
    });
  });

  it("is a no-op when nothing folds", () => {
    const doc = buildShapeDocument(FILE_LINES, [], EMPTY);
    expect(doc.content).toBe(FILE);
    expect(doc.rows).toHaveLength(12);
  });

  it("preserves a trailing newline", () => {
    const doc = buildShapeDocument(["a", "b", ""], [], EMPTY);
    expect(doc.content).toBe("a\nb\n");
    expect(doc.rows).toHaveLength(2);
  });

  it("clamps a fold that runs past the end of the file", () => {
    const doc = buildShapeDocument(
      FILE_LINES,
      [{ ...GREET, endLine: 999 }],
      EMPTY,
    );
    const last = doc.rows[doc.rows.length - 1];
    expect(last).toMatchObject({ kind: "marker", startLine: 5, endLine: 12 });
    expect(doc.content.endsWith(`    ${SHAPE_MARKER}`)).toBe(true);
    expect(maxRealLine(doc.rows)).toBe(12);
  });

  it("indents the marker from the first non-blank hidden line", () => {
    const nested = ["class A:", "    def m(self):", "", "", "", "", ""];
    const doc = buildShapeDocument(
      nested,
      [{ id: "3:7", name: "m", startLine: 3, endLine: 7 }],
      EMPTY,
    );
    // Body is entirely blank — fall back to the signature's indent plus a step.
    expect(doc.content.split("\n")[2]).toBe(`      ${SHAPE_MARKER}`);
  });
});

/** TS/Rust-shaped: the body's last line is the `}` closing the signature. */
const BRACE_LINES = [
  "export function big() {", // 1
  "  const a = 1;", // 2
  "  const b = 2;", // 3
  "  const c = 3;", // 4
  "  const d = 4;", // 5
  "  return a + b + c + d;", // 6
  "}", // 7
  "", // 8
];

describe("folds in brace languages", () => {
  it("leaves the closing brace outside the hidden range", () => {
    const folds = collectFolds(
      [symbol({ name: "big", startLine: 1, endLine: 7, bodyStartLine: 2 })],
      BRACE_LINES,
    );
    expect(folds).toEqual([
      { id: "2:6", name: "big", startLine: 2, endLine: 6 },
    ]);
  });

  it("keeps the rendered document brace-balanced", () => {
    const folds = collectFolds(
      [symbol({ name: "big", startLine: 1, endLine: 7, bodyStartLine: 2 })],
      BRACE_LINES,
    );
    const doc = buildShapeDocument(BRACE_LINES, folds, EMPTY);
    expect(doc.content).toBe(`export function big() {\n  ${SHAPE_MARKER}\n}\n`);
    const opens = (doc.content.match(/{/g) ?? []).length;
    const closes = (doc.content.match(/}/g) ?? []).length;
    expect(opens).toBe(closes);
  });

  it("also spares a closer that carries a trailing semicolon", () => {
    const lines = [
      "const handler = wrap(() => {", // 1
      "  const a = 1;", // 2
      "  const b = 2;", // 3
      "  const c = 3;", // 4
      "  const d = 4;", // 5
      "  return a + b + c + d;", // 6
      "});", // 7
    ];
    const folds = collectFolds(
      [symbol({ name: "handler", startLine: 1, endLine: 7, bodyStartLine: 2 })],
      lines,
    );
    expect(folds[0]).toMatchObject({ startLine: 2, endLine: 6 });
  });

  it("declines a body that only clears the threshold with its brace", () => {
    const lines = [
      "function small() {", // 1
      "  const a = 1;", // 2
      "  const b = 2;", // 3
      "  const c = 3;", // 4
      "  const d = 4;", // 5
      "}", // 6
    ];
    // 2..6 is five lines, but only four of them are hidden once the `}` stays.
    const folds = collectFolds(
      [symbol({ name: "small", startLine: 1, endLine: 6, bodyStartLine: 2 })],
      lines,
    );
    expect(folds).toEqual([]);
  });

  it("hides an indentation body to its last line, unchanged", () => {
    const folds = collectFolds(
      [symbol({ name: "greet", startLine: 4, endLine: 9, bodyStartLine: 5 })],
      FILE_LINES,
    );
    expect(folds).toEqual([GREET]);
  });
});

describe("realLineToRow", () => {
  const doc = buildShapeDocument(FILE_LINES, [GREET], EMPTY);

  it("finds the row showing a visible line", () => {
    expect(realLineToRow(doc.rows, 4)).toEqual({ row: 4 });
    // Line 12 has slid up to row 8 — the five hidden lines cost four rows.
    expect(realLineToRow(doc.rows, 12)).toEqual({ row: 8 });
  });

  it("names the fold to open for a hidden line", () => {
    expect(realLineToRow(doc.rows, 7)).toEqual({ row: 5, hiddenBy: "5:9" });
  });

  it("drops the fold once it is expanded", () => {
    const expanded = buildShapeDocument(FILE_LINES, [GREET], new Set(["5:9"]));
    expect(realLineToRow(expanded.rows, 7)).toEqual({ row: 7 });
  });

  it("returns null for a line the document doesn't reach", () => {
    expect(realLineToRow(doc.rows, 99)).toBeNull();
  });
});

describe("rowToRealLine", () => {
  const doc = buildShapeDocument(FILE_LINES, [GREET], EMPTY);

  it("reads a code row's own line", () => {
    expect(rowToRealLine(doc.rows, 8)).toBe(12);
  });

  it("reads a marker row as the first line it hides", () => {
    expect(rowToRealLine(doc.rows, 5)).toBe(5);
  });

  it("returns null past the end of the document", () => {
    expect(rowToRealLine(doc.rows, 99)).toBeNull();
  });
});
