import { describe, it, expect } from "vitest";
import {
  hunkInScope,
  shouldSkipHunkForNavigation,
  toggleScope,
  type ReviewScope,
} from "./scope";
import { attributed, type HunkState } from "./index";

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

describe("shouldSkipHunkForNavigation", () => {
  it("does not skip an untrusted hunk with no scope", () => {
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        hunkState: undefined,
        trustList,
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
        hunkState,
        trustList,
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
        hunkState,
        trustList,
        scope: null,
      }),
    ).toBe(false);
  });

  it("skips a hunk that falls outside an active scope", () => {
    const s = scope(["b.ts:2"]);
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        hunkState: undefined,
        trustList,
        scope: s,
      }),
    ).toBe(true);
  });

  it("does not skip a hunk that matches an active scope", () => {
    const s = scope(["a.ts:1"]);
    expect(
      shouldSkipHunkForNavigation({
        hunkId: "a.ts:1",
        hunkState: undefined,
        trustList,
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
        hunkState,
        trustList,
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
        hunkState,
        trustList,
        scope: s,
      }),
    ).toBe(true);
  });
});
