import { describe, it, expect } from "vitest";
import { PALETTE_MODES, modeForPrefix, readModeSwitch } from "./modes";

describe("prefixes", () => {
  it("gives every mode but the root a distinct prefix", () => {
    const prefixes = Object.values(PALETTE_MODES)
      .map((info) => info.prefix)
      .filter((prefix): prefix is string => prefix !== null);
    expect(new Set(prefixes).size).toBe(prefixes.length);
    // Go is the unprefixed root, and the only one.
    expect(prefixes.length).toBe(Object.keys(PALETTE_MODES).length - 1);
    expect(PALETTE_MODES.go.prefix).toBeNull();
  });

  it("resolves a prefix to its mode", () => {
    expect(modeForPrefix("/")).toBe("files");
    expect(modeForPrefix(">")).toBe("commands");
    expect(modeForPrefix("@")).toBe("symbols");
    expect(modeForPrefix("#")).toBe("content");
    expect(modeForPrefix("x")).toBeNull();
  });
});

describe("reading a mode switch out of an input change", () => {
  it("switches on a prefix typed into an empty box", () => {
    expect(readModeSwitch("", ">", "go")).toBe("commands");
    expect(readModeSwitch("", "@", "go")).toBe("symbols");
    expect(readModeSwitch("", "/", "go")).toBe("files");
  });

  /**
   * `#include` is an ordinary thing to grep for. If the leading `#` were taken
   * as a prefix it would vanish into a switch to the mode already showing, and
   * the search would silently run for `include`.
   */
  it("leaves a prefix alone when it names the current mode", () => {
    expect(readModeSwitch("", "#", "content")).toBeNull();
    expect(readModeSwitch("", ">", "commands")).toBeNull();
  });

  it("ignores a prefix that is not the first thing typed", () => {
    expect(readModeSwitch("src", "src>", "go")).toBeNull();
    expect(readModeSwitch("a", "a@b", "go")).toBeNull();
  });

  /** Pasting a whole query in must not be read one character at a time. */
  it("ignores a multi-character paste that happens to start with a prefix", () => {
    expect(readModeSwitch("", "@decorator", "content")).toBeNull();
  });

  it("takes ordinary text as text", () => {
    expect(readModeSwitch("", "s", "go")).toBeNull();
  });
});
