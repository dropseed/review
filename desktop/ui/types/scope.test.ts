import { describe, it, expect } from "vitest";
import {
  hunkInScope,
  hunkMatches,
  selectHunkIds,
  shouldSkipHunkForNavigation,
  toggleScope,
  type ReviewScope,
} from "./scope";
import {
  attributed,
  type DiffHunk,
  type HunkState,
  type ReviewState,
} from "./index";

const trustList = ["imports:*", "formatting:whitespace"];

function scope(hunkIds: string[]): ReviewScope {
  return { source: "commit", key: "sha1", title: "Add feature", hunkIds };
}

describe("toggleScope", () => {
  it("sets the scope when nothing is active", () => {
    const s = scope(["a.ts:1"]);
    expect(toggleScope(null, s)).toBe(s);
  });

  it("clears the scope when clicking the already-active one (same source + key)", () => {
    const s = scope(["a.ts:1"]);
    expect(toggleScope(s, { ...s, hunkIds: ["a.ts:1", "b.ts:2"] })).toBeNull();
  });

  it("switches to a different scope even with the same source", () => {
    const current = scope(["a.ts:1"]);
    const next: ReviewScope = { ...current, key: "sha2" };
    expect(toggleScope(current, next)).toBe(next);
  });

  it("switches when the key matches but the source differs", () => {
    const current: ReviewScope = {
      source: "uncommitted",
      key: "reviewed",
      title: "Reviewed",
      hunkIds: [],
    };
    const next: ReviewScope = {
      source: "guide",
      key: "reviewed",
      title: "Reviewed",
      hunkIds: [],
    };
    expect(toggleScope(current, next)).toBe(next);
  });
});

describe("hunkInScope", () => {
  it("a null scope matches everything", () => {
    expect(hunkInScope(null, "a.ts:1")).toBe(true);
  });

  it("matches only hunks in the scope's exact set", () => {
    const s = scope(["a.ts:1", "b.ts:2"]);
    expect(hunkInScope(s, "a.ts:1")).toBe(true);
    expect(hunkInScope(s, "c.ts:3")).toBe(false);
  });
});

describe("hunkMatches", () => {
  it("a null scope imposes no additional constraint", () => {
    expect(
      hunkMatches({
        hunkId: "a.ts:1",
        hunkState: undefined,
        filePath: "a.ts",
        trustList,
        filter: {},
        scope: null,
      }),
    ).toBe(true);
  });

  it("AND-composes the predicate filter with scope", () => {
    const high: HunkState = { status: attributed("approved", "ui") };
    const low: HunkState = { status: attributed("rejected", "ui") };
    const s = scope(["a.ts:1"]);

    expect(
      hunkMatches({
        hunkId: "a.ts:1",
        hunkState: high,
        filePath: "a.ts",
        trustList,
        filter: { status: ["approved"] },
        scope: s,
      }),
    ).toBe(true);

    // Matches the predicate but falls outside scope.
    expect(
      hunkMatches({
        hunkId: "b.ts:2",
        hunkState: high,
        filePath: "b.ts",
        trustList,
        filter: { status: ["approved"] },
        scope: s,
      }),
    ).toBe(false);

    // Inside scope but fails the predicate.
    expect(
      hunkMatches({
        hunkId: "a.ts:1",
        hunkState: low,
        filePath: "a.ts",
        trustList,
        filter: { status: ["approved"] },
        scope: s,
      }),
    ).toBe(false);
  });
});

describe("selectHunkIds", () => {
  const hunks = [
    { id: "a.ts:1", filePath: "a.ts" },
    { id: "b.ts:2", filePath: "b.ts" },
    { id: "c.ts:3", filePath: "c.ts" },
  ] as DiffHunk[];

  it("selects everything with no filter or scope", () => {
    const reviewState = { trustList, hunks: {} } as unknown as ReviewState;
    expect(selectHunkIds(hunks, reviewState, {})).toHaveLength(3);
  });

  it("narrows to a scope's exact membership", () => {
    const reviewState = { trustList, hunks: {} } as unknown as ReviewState;
    expect(
      selectHunkIds(hunks, reviewState, {}, scope(["a.ts:1", "c.ts:3"])),
    ).toEqual(["a.ts:1", "c.ts:3"]);
  });

  it("composes a predicate filter with a scope", () => {
    const reviewState = {
      trustList,
      hunks: {
        "a.ts:1": { status: attributed("approved", "ui") },
        "b.ts:2": { status: attributed("approved", "ui") },
      },
    } as unknown as ReviewState;
    expect(
      selectHunkIds(
        hunks,
        reviewState,
        { status: ["approved"] },
        scope(["a.ts:1", "c.ts:3"]),
      ),
    ).toEqual(["a.ts:1"]);
  });

  it("tolerates a null review state", () => {
    expect(selectHunkIds(hunks, null, {})).toHaveLength(3);
  });
});

describe("shouldSkipHunkForNavigation", () => {
  it("does not skip an untrusted hunk with no filter or scope", () => {
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState: undefined,
        trustList,
        filter: {},
        scope: null,
      }),
    ).toBe(false);
  });

  it("skips a trusted hunk with no explicit status (existing behavior)", () => {
    const hunkState: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState,
        trustList,
        filter: {},
        scope: null,
      }),
    ).toBe(true);
  });

  it("does not skip a trusted hunk once it has an explicit status", () => {
    const hunkState: HunkState = {
      classification: attributed(["imports:added"], "static"),
      status: attributed("approved", "ui"),
    };
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState,
        trustList,
        filter: {},
        scope: null,
      }),
    ).toBe(false);
  });

  it("skips a hunk that falls outside an active scope", () => {
    const s = scope(["b.ts:2"]);
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState: undefined,
        trustList,
        filter: {},
        scope: s,
      }),
    ).toBe(true);
  });

  it("does not skip a hunk that matches an active scope", () => {
    const s = scope(["a.ts:1"]);
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState: undefined,
        trustList,
        filter: {},
        scope: s,
      }),
    ).toBe(false);
  });

  it("an out-of-scope hunk is skipped even if it would otherwise be reviewable", () => {
    const hunkState: HunkState = { status: attributed("approved", "ui") };
    const s = scope(["b.ts:2"]);
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState,
        trustList,
        filter: {},
        scope: s,
      }),
    ).toBe(true);
  });

  it("skips a hunk inside scope that fails the predicate filter", () => {
    const hunkState: HunkState = { status: attributed("rejected", "ui") };
    const s = scope(["a.ts:1"]);
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState,
        trustList,
        filter: { status: ["approved"] },
        scope: s,
      }),
    ).toBe(true);
  });

  it("still skips a trusted hunk when scoped to a non-status source (e.g. a commit)", () => {
    const hunkState: HunkState = {
      classification: attributed(["imports:added"], "static"),
    };
    const s = scope(["a.ts:1"]);
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        filePath: "a.ts",
        hunkState,
        trustList,
        filter: {},
        scope: s,
      }),
    ).toBe(true);
  });
});
