import { describe, it, expect } from "vitest";
import { refLabel } from "./refLabel";

describe("refLabel", () => {
  it("shows a PR ref as its number", () => {
    expect(refLabel("refs/review/pr/123")).toBe("#123");
  });

  it("shortens a full 40-char sha to its short form", () => {
    const sha = "a".repeat(40);
    expect(refLabel(sha)).toBe(sha.slice(0, 7));
  });

  it("leaves a branch name untouched", () => {
    expect(refLabel("main")).toBe("main");
    expect(refLabel("feature/add-thing")).toBe("feature/add-thing");
  });

  it("does not shorten a short or non-hex sha-like string", () => {
    // A short hash (e.g. from a display context) isn't the 40-char form the
    // regex expects, so it passes through as an ordinary ref name.
    expect(refLabel("a1b2c3d")).toBe("a1b2c3d");
    // 40 characters but not all hex digits.
    const notHex = "g".repeat(40);
    expect(refLabel(notHex)).toBe(notHex);
    // 40 hex characters but uppercase — git shas are always lowercase, so
    // this is treated as an ordinary ref rather than shortened.
    const upper = "A".repeat(40);
    expect(refLabel(upper)).toBe(upper);
  });

  it("passes through an empty ref", () => {
    expect(refLabel("")).toBe("");
  });
});
