import { describe, it, expect } from "vitest";
import {
  makeComparison,
  isHunkTrusted,
  isHunkReviewed,
  attributed,
  describeTrustedLabel,
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
    const hunkState: HunkState = { classification: attributed([], "static") };
    expect(isHunkTrusted(hunkState, trustList)).toBe(false);
  });

  it("returns true when label matches a wildcard pattern", () => {
    const hunkState: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    expect(isHunkTrusted(hunkState, trustList)).toBe(true);
  });

  it("returns true when label matches an exact pattern", () => {
    const hunkState: HunkState = {
      classification: attributed(["formatting:whitespace"], "static"),
    };
    expect(isHunkTrusted(hunkState, trustList)).toBe(true);
  });

  it("returns false when label does not match any pattern", () => {
    const hunkState: HunkState = {
      classification: attributed(["code:logic"], "static"),
    };
    expect(isHunkTrusted(hunkState, trustList)).toBe(false);
  });

  it("returns true if any label matches", () => {
    const hunkState: HunkState = {
      classification: attributed(["code:logic", "imports:added"], "static"),
    };
    expect(isHunkTrusted(hunkState, trustList)).toBe(true);
  });

  it("returns false when trustList is empty", () => {
    const hunkState: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    expect(isHunkTrusted(hunkState, [])).toBe(false);
  });
});

describe("describeTrustedLabel", () => {
  it("shows only the label for an exact-match pattern", () => {
    expect(
      describeTrustedLabel("formatting:whitespace", "formatting:whitespace"),
    ).toBe('"formatting:whitespace"');
  });

  it("names the wildcard pattern when it differs from the label", () => {
    expect(describeTrustedLabel("imports:added", "imports:*")).toBe(
      '"imports:added" (pattern "imports:*")',
    );
  });
});

describe("isHunkReviewed", () => {
  const trustList = ["imports:*"];

  it("returns false for undefined hunkState", () => {
    expect(isHunkReviewed(undefined, trustList)).toBe(false);
  });

  it("returns true when status is approved", () => {
    const hunkState: HunkState = { status: attributed("approved", "ui") };
    expect(isHunkReviewed(hunkState, trustList)).toBe(true);
  });

  it("returns true when status is rejected", () => {
    const hunkState: HunkState = { status: attributed("rejected", "ui") };
    expect(isHunkReviewed(hunkState, trustList)).toBe(true);
  });

  it("returns true when label matches trust list (no status)", () => {
    const hunkState: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    expect(isHunkReviewed(hunkState, trustList)).toBe(true);
  });

  it("returns false when no status and label does not match trust list", () => {
    const hunkState: HunkState = {
      classification: attributed(["code:logic"], "static"),
    };
    expect(isHunkReviewed(hunkState, trustList)).toBe(false);
  });

  it("returns false when no status and no labels", () => {
    const hunkState: HunkState = { classification: attributed([], "static") };
    expect(isHunkReviewed(hunkState, trustList)).toBe(false);
  });
});
