import { describe, expect, it } from "vitest";
import {
  type SelectionBuffer,
  normalizeCopyText,
  snapshotRows,
  wordRangeAt,
} from "./selection-text";

/** An xterm buffer, as much of one as any of this needs. */
function buffer(lines: string[], viewportY = 0): SelectionBuffer {
  return {
    viewportY,
    getLine: (y) =>
      lines[y] === undefined
        ? undefined
        : {
            translateToString: (trimRight?: boolean) =>
              trimRight ? lines[y].replace(/\s+$/, "") : lines[y],
          },
  };
}

describe("the snapshot of a visible screen", () => {
  it("takes the rows the viewport is over, not the ones above it", () => {
    const rows = snapshotRows(buffer(["a", "b", "c", "d"], 2), 2);
    expect(rows).toEqual(["c", "d"]);
  });

  it("keeps the row count when the screen is half empty", () => {
    // The overlay is drawn cell-for-cell onto the terminal: a row that says
    // nothing still has to be a box, or every row below it moves up one.
    const rows = snapshotRows(buffer(["only this"]), 4);
    expect(rows).toEqual(["only this", "", "", ""]);
  });

  it("drops the padding a terminal pads its rows with", () => {
    // 80 columns of trailing space is 80 columns iOS's handles would happily
    // drag out into.
    expect(snapshotRows(buffer(["hi        "]), 1)).toEqual(["hi"]);
  });
});

describe("the word under a press", () => {
  it("takes the whole run, from anywhere inside it", () => {
    const text = "npm run test";
    expect(wordRangeAt(text, 4)).toEqual({ start: 4, end: 7 });
    expect(wordRangeAt(text, 6)).toEqual({ start: 4, end: 7 });
  });

  /**
   * The reason this isn't `\w`: what is worth grabbing out of a terminal in
   * one gesture is almost never a bare word.
   */
  it("keeps a path, a URL and a file:line in one piece", () => {
    const path = "ui/components/Terminal/registry.ts:120";
    expect(wordRangeAt(path, 3)).toEqual({ start: 0, end: path.length });

    // Query strings included: `?` and `=` are the inside of a URL, and a
    // half-copied one is not a link.
    const line = "see https://example.com/a/b?c=1 for more";
    expect(wordRangeAt(line, 10)).toEqual({ start: 4, end: 31 });
  });

  it("stops at the punctuation output puts around things", () => {
    const text = `error("bad", 12)`;
    expect(wordRangeAt(text, 8)).toEqual({ start: 7, end: 10 });
  });

  it("answers nothing for whitespace and for past the end of the row", () => {
    expect(wordRangeAt("a b", 1)).toBeNull();
    expect(wordRangeAt("abc", 3)).toBeNull();
    expect(wordRangeAt("", 0)).toBeNull();
    expect(wordRangeAt("abc", -1)).toBeNull();
  });
});

describe("what leaves for the clipboard", () => {
  it("is the lines that were on screen, without the boxes they were in", () => {
    expect(normalizeCopyText("one   \ntwo  \n")).toBe("one\ntwo");
  });

  it("drops the blank rows a selection was dragged past", () => {
    expect(normalizeCopyText("\n\nresult\n\n\n")).toBe("result");
  });

  it("keeps the gaps the program printed", () => {
    expect(normalizeCopyText("a\n\nb")).toBe("a\n\nb");
  });

  it("normalizes the newlines a browser serializes with", () => {
    expect(normalizeCopyText("a\r\nb")).toBe("a\nb");
  });
});
