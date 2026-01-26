import { describe, it, expect } from "vitest";
import {
  makeComparison,
  isHunkTrusted,
  isHunkReviewed,
  type HunkState,
} from "./index";

describe("makeComparison", () => {
  it("creates a basic comparison with workingTree=false", () => {
    const result = makeComparison("main", "HEAD", false);
    expect(result).toEqual({
      old: "main",
      new: "HEAD",
      workingTree: false,
      stagedOnly: undefined,
      key: "main..HEAD",
    });
  });

  it("creates a working tree comparison", () => {
    const result = makeComparison("main", "HEAD", true);
    expect(result).toEqual({
      old: "main",
      new: "HEAD",
      workingTree: true,
      stagedOnly: undefined,
      key: "main..HEAD+working-tree",
    });
  });

  it("creates a staged-only comparison", () => {
    const result = makeComparison("HEAD", "HEAD", false, true);
    expect(result).toEqual({
      old: "HEAD",
      new: "HEAD",
      workingTree: false,
      stagedOnly: true,
      key: "HEAD..HEAD+staged-only",
    });
  });

  it("staged-only takes precedence over working-tree in key", () => {
    // When stagedOnly is true, key should show +staged-only even if workingTree is true
    const result = makeComparison("HEAD", "HEAD", true, true);
    expect(result.key).toBe("HEAD..HEAD+staged-only");
  });

  it("handles branch names with slashes", () => {
    const result = makeComparison("origin/main", "feature/my-branch", false);
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
