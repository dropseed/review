import { describe, it, expect } from "vitest";
import {
  makeComparison,
  isHunkTrusted,
  isHunkReviewed,
  type HunkState,
} from "./index";

describe("makeComparison", () => {
  it("creates a basic comparison", () => {
    const result = makeComparison("main", "HEAD");
    expect(result).toEqual({
      base: "main",
      head: "HEAD",
      key: "main..HEAD",
    });
  });

  it("same-branch comparison produces correct key", () => {
    const result = makeComparison("main", "main");
    expect(result.key).toBe("main..main");
  });

  it("handles branch names with slashes", () => {
    const result = makeComparison("origin/main", "feature/my-branch");
    expect(result.key).toBe("origin/main..feature/my-branch");
  });
});

describe("isHunkTrusted", () => {
  const trustList = ["imports:*", "formatting:whitespace", "comments:removed"];

  it("returns false for undefined hunkState", () => {
    expect(isHunkTrusted(undefined, trustList)).toBe(false);
  });

  it("returns false for hunkState with empty labels", () => {
    const hunkState: HunkState = { label: [] };
    expect(isHunkTrusted(hunkState, trustList)).toBe(false);
  });

  it("returns true when label matches a wildcard pattern", () => {
    const hunkState: HunkState = { label: ["imports:added"] };
    expect(isHunkTrusted(hunkState, trustList)).toBe(true);
  });

  it("returns true when label matches an exact pattern", () => {
    const hunkState: HunkState = { label: ["formatting:whitespace"] };
    expect(isHunkTrusted(hunkState, trustList)).toBe(true);
  });

  it("returns false when label does not match any pattern", () => {
    const hunkState: HunkState = { label: ["code:logic"] };
    expect(isHunkTrusted(hunkState, trustList)).toBe(false);
  });

  it("returns true if any label matches", () => {
    const hunkState: HunkState = { label: ["code:logic", "imports:added"] };
    expect(isHunkTrusted(hunkState, trustList)).toBe(true);
  });

  it("returns false when trustList is empty", () => {
    const hunkState: HunkState = { label: ["imports:added"] };
    expect(isHunkTrusted(hunkState, [])).toBe(false);
  });
});

describe("isHunkReviewed", () => {
  const trustList = ["imports:*"];

  it("returns false for undefined hunkState", () => {
    expect(isHunkReviewed(undefined, trustList)).toBe(false);
  });

  it("returns true when status is approved", () => {
    const hunkState: HunkState = { label: [], status: "approved" };
    expect(isHunkReviewed(hunkState, trustList)).toBe(true);
  });

  it("returns true when status is rejected", () => {
    const hunkState: HunkState = { label: [], status: "rejected" };
    expect(isHunkReviewed(hunkState, trustList)).toBe(true);
  });

  it("returns true when label matches trust list (no status)", () => {
    const hunkState: HunkState = { label: ["imports:added"] };
    expect(isHunkReviewed(hunkState, trustList)).toBe(true);
  });

  it("returns false when no status and label does not match trust list", () => {
    const hunkState: HunkState = { label: ["code:logic"] };
    expect(isHunkReviewed(hunkState, trustList)).toBe(false);
  });

  it("returns false when no status and no labels", () => {
    const hunkState: HunkState = { label: [] };
    expect(isHunkReviewed(hunkState, trustList)).toBe(false);
  });
});
