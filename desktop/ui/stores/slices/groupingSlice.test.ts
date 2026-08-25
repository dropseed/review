import { describe, it, expect } from "vitest";
import { patchStaleGroups } from "./groupingSlice";
import type { HunkGroup } from "../../types";

function group(title: string, hunkIds: string[]): HunkGroup {
  return { title, hunkIds };
}

describe("patchStaleGroups", () => {
  it("keeps a group untouched (same reference) when none of its ids vanished", () => {
    const groups = [group("A", ["f:a", "f:b"])];
    const patched = patchStaleGroups(groups, new Set(["f:a", "f:b"]));
    expect(patched).toHaveLength(1);
    expect(patched[0]).toBe(groups[0]);
  });

  it("filters vanished ids from a group but keeps the surviving ones", () => {
    const groups = [group("A", ["f:a", "f:gone"])];
    const patched = patchStaleGroups(groups, new Set(["f:a"]));
    expect(patched).toHaveLength(1);
    expect(patched[0].title).toBe("A");
    expect(patched[0].hunkIds).toEqual(["f:a"]);
  });

  it("drops a group entirely once every id in it has vanished", () => {
    const groups = [group("A", ["f:a"]), group("B", ["f:gone1", "f:gone2"])];
    const patched = patchStaleGroups(groups, new Set(["f:a"]));
    expect(patched.map((g) => g.title)).toEqual(["A"]);
  });

  it("buckets ids not covered by any group into an ungrouped catchall", () => {
    const groups = [group("A", ["f:a"])];
    const patched = patchStaleGroups(groups, new Set(["f:a", "f:new"]));
    expect(patched).toHaveLength(2);
    expect(patched[1]).toEqual({
      title: "Other changes",
      hunkIds: ["f:new"],
      ungrouped: true,
    });
  });

  it("adds no catchall when every live id is already covered by a group", () => {
    const groups = [group("A", ["f:a", "f:b"])];
    const patched = patchStaleGroups(groups, new Set(["f:a", "f:b"]));
    expect(patched).toEqual(groups);
  });

  it("returns an empty result for no groups and no live hunks", () => {
    expect(patchStaleGroups([], new Set())).toEqual([]);
  });

  it("buckets every live hunk as ungrouped when there are no stored groups", () => {
    const patched = patchStaleGroups([], new Set(["f:a", "f:b"]));
    expect(patched).toHaveLength(1);
    expect(patched[0].ungrouped).toBe(true);
    expect(new Set(patched[0].hunkIds)).toEqual(new Set(["f:a", "f:b"]));
  });
});
