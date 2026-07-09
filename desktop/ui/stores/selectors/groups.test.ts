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

import {
  computeCommitGroups,
  computeGuideGroups,
  countGroupUnreviewed,
  UNCOMMITTED_GROUP_KEY,
} from "./groups";
import {
  attributed,
  type DiffHunk,
  type HunkAttribution,
  type ReviewState,
} from "../../types";

const hunks = [
  { id: "a.ts:1", filePath: "a.ts" },
  { id: "b.ts:2", filePath: "b.ts" },
  { id: "c.ts:3", filePath: "c.ts" },
] as DiffHunk[];

describe("computeCommitGroups", () => {
  it("buckets by attributed commit, oldest first, with a trailing uncommitted group", () => {
    const attribution: HunkAttribution = {
      commits: [
        {
          hash: "sha1",
          shortHash: "sha1",
          message: "Add feature",
          author: "a",
          authorEmail: "a@x.com",
          date: "t",
        },
      ],
      hunkCommits: { "a.ts:1": ["sha1"], "b.ts:2": [] },
    };
    const groups = computeCommitGroups(hunks.slice(0, 2), attribution);
    expect(groups).toEqual([
      {
        key: "sha1",
        source: "commit",
        title: "Add feature",
        context: undefined,
        hunkIds: ["a.ts:1"],
        commit: attribution.commits[0],
      },
      {
        key: UNCOMMITTED_GROUP_KEY,
        source: "uncommitted",
        title: "Uncommitted changes",
        hunkIds: ["b.ts:2"],
        isPlaceholder: true,
      },
    ]);
  });

  it("returns nothing without attribution data", () => {
    expect(computeCommitGroups(hunks, null)).toEqual([]);
  });
});

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
