import { describe, it, expect } from "vitest";
import { lineRangeRef } from "./line-range";

describe("lineRangeRef", () => {
  it("returns empty string when start is undefined", () => {
    expect(lineRangeRef(undefined)).toBe("");
  });

  it("formats a single line with no end", () => {
    expect(lineRangeRef(42)).toBe("42");
  });

  it("formats a span of start and end", () => {
    expect(lineRangeRef(42, 48)).toBe("42-48");
  });

  it("collapses a redundant end equal to start", () => {
    expect(lineRangeRef(42, 42)).toBe("42");
  });
});
