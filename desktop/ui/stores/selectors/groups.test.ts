import { describe, it, expect, vi } from "vitest";

// getHunkIdsByStatus pulls in ./hunks, which imports the store module for its
// hook forms. The store wires a real backend client at module load (which
// trips on HMR internals under vitest) — stub the backend + platform, same
// as ReviewFilterBar.test.tsx.
vi.mock("../../api", () => ({
  getApiClient: () =>
    new Proxy({}, { get: () => () => Promise.resolve(undefined) }),
}));
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({
    storage: new Proxy({}, { get: () => () => undefined }),
  }),
}));

import { computeGuideGroups, countGroupUnreviewed } from "./groups";
import { attributed, type DiffHunk, type ReviewState } from "../../types";

const hunks = [
  { id: "a.ts:1", filePath: "a.ts" },
  { id: "b.ts:2", filePath: "b.ts" },
  { id: "c.ts:3", filePath: "c.ts" },
] as DiffHunk[];

describe("computeGuideGroups", () => {
  it("maps HunkGroup shape onto the shared Group contract", () => {
    const groups = computeGuideGroups(
      [
        { title: "Auth", description: "Login flow", hunkIds: ["a.ts:1"] },
        { title: "Other changes", hunkIds: ["b.ts:2"], ungrouped: true },
      ],
      hunks,
    );
    expect(groups).toEqual([
      {
        key: "Auth",
        source: "guide",
        title: "Auth",
        context: "Login flow",
        hunkIds: ["a.ts:1"],
        isPlaceholder: undefined,
      },
      {
        key: "Other changes",
        source: "guide",
        title: "Other changes",
        context: undefined,
        hunkIds: ["b.ts:2"],
        isPlaceholder: true,
      },
    ]);
  });

  it("filters out hunk ids that no longer exist in the loaded diff (amend/rebase left a phantom id behind)", () => {
    const groups = computeGuideGroups(
      [{ title: "Auth", hunkIds: ["a.ts:1", "vanished.ts:9"] }],
      hunks, // only a.ts:1, b.ts:2, c.ts:3 are live
    );
    expect(groups[0].hunkIds).toEqual(["a.ts:1"]);
  });
});

describe("countGroupUnreviewed", () => {
  it("counts only unreviewed hunks in the group", () => {
    const reviewState = {
      trustList: [],
      hunks: { "a.ts:1": { status: attributed("approved", "ui") } },
    } as unknown as ReviewState;
    const group = {
      key: "g",
      source: "guide" as const,
      title: "g",
      hunkIds: ["a.ts:1", "b.ts:2"],
    };
    expect(countGroupUnreviewed(group, reviewState)).toBe(1);
  });
});
