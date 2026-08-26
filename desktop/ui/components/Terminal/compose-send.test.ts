import { describe, it, expect } from "vitest";
import { PASTE_BEGIN, PASTE_END, wrapMultilinePaste } from "./compose-send";

describe("bracketing a multi-line message as a paste", () => {
  it("leaves a single line exactly as it was", () => {
    // Nothing to protect, and the markers are input to any program that never
    // enabled the mode.
    expect(wrapMultilinePaste("run the tests")).toBe("run the tests");
    expect(wrapMultilinePaste("")).toBe("");
  });

  it("wraps text carrying a newline, newline and all", () => {
    expect(wrapMultilinePaste("first\nsecond")).toBe(
      `${PASTE_BEGIN}first\nsecond${PASTE_END}`,
    );
    // One paste however many lines it runs to — the interior newlines stay
    // newlines, which is the whole point.
    expect(wrapMultilinePaste("a\nb\nc")).toBe(
      `${PASTE_BEGIN}a\nb\nc${PASTE_END}`,
    );
  });

  it("counts a bare carriage return too", () => {
    expect(wrapMultilinePaste("a\rb").startsWith(PASTE_BEGIN)).toBe(true);
  });

  it("never brackets text that already holds an escape", () => {
    // Its own end marker would close the bracket early and the tail would land
    // as ordinary input — the exact failure this exists to prevent.
    const hostile = `first\n${PASTE_END}rm -rf /`;
    expect(wrapMultilinePaste(hostile)).toBe(hostile);
  });

  it("agrees with the rule the server applies to the same text", () => {
    // review_core::terminal::wrap_multiline_paste, kept in step by hand: if
    // this shape changes, that one has to change with it.
    expect(wrapMultilinePaste("x\ny")).toBe("\x1b[200~x\ny\x1b[201~");
  });
});
