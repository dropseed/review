import { describe, it, expect, vi } from "vitest";
import type { ApiClient } from "../../api/client";
import {
  PASTE_BEGIN,
  PASTE_END,
  submitComposed,
  wrapMultilinePaste,
} from "./compose-send";

function fakeClient(terminalSubmit: ApiClient["terminalSubmit"]): ApiClient {
  return { terminalSubmit } as unknown as ApiClient;
}

describe("submitting a composed message", () => {
  it("hands the text to the client, which owns the settle", async () => {
    const terminalSubmit = vi.fn(async () => {});
    await submitComposed(fakeClient(terminalSubmit), "t1", "run the tests");
    expect(terminalSubmit).toHaveBeenCalledWith("t1", "run the tests");
  });

  it("sends the text exactly as typed, newlines and all", async () => {
    const terminalSubmit = vi.fn(async () => {});
    await submitComposed(fakeClient(terminalSubmit), "t1", "  first\nsecond");
    // No trim, no join: the Enter that submits is the only byte added, and it
    // is added past this point.
    expect(terminalSubmit).toHaveBeenCalledWith("t1", "  first\nsecond");
  });

  it("propagates a failure rather than reporting a message that never went", async () => {
    const terminalSubmit = vi.fn().mockRejectedValue(new Error("gone"));
    await expect(
      submitComposed(fakeClient(terminalSubmit), "t1", "hi"),
    ).rejects.toThrow("gone");
  });
});

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
