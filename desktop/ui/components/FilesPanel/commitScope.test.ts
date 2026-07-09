import { describe, it, expect } from "vitest";
import {
  commitRangeScope,
  commitSetScope,
  commitsInScope,
  isCommitScope,
  scopeCommitKeys,
  singleCommitScope,
} from "./commitScope";
import type { Group } from "../../stores/selectors/groups";
import type { CommitEntry, HunkAttribution } from "../../types";
import type { ReviewScope } from "../../types/scope";

function group(key: string, hunkIds: string[]): Group {
  return { key, source: "commit", title: `Commit ${key}`, hunkIds };
}

describe("singleCommitScope", () => {
  it("carries commitKeys with the single group's key", () => {
    const s = singleCommitScope(group("sha1", ["a.ts:1"]));
    expect(s.commitKeys).toEqual(["sha1"]);
    expect(s.hunkIds).toEqual(["a.ts:1"]);
  });
});

describe("commitRangeScope", () => {
  it("carries commitKeys for every commit spanned, oldest first", () => {
    const commits = [
      group("sha1", ["a.ts:1"]),
      group("sha2", ["b.ts:2"]),
      group("sha3", ["c.ts:3"]),
    ];
    const s = commitRangeScope(commits, 1, 3);
    expect(s.commitKeys).toEqual(["sha1", "sha2", "sha3"]);
    expect(s.hunkIds).toEqual(["a.ts:1", "b.ts:2", "c.ts:3"]);
    expect(s.title).toBe("Commits #1–#3");
  });
});

describe("commitSetScope", () => {
  it("builds a non-contiguous set with a stable key and 'N commits' title", () => {
    const commits = [group("sha1", ["a.ts:1"]), group("sha3", ["c.ts:3"])];
    const s = commitSetScope(commits);
    expect(s.commitKeys).toEqual(["sha1", "sha3"]);
    expect(s.title).toBe("2 commits");
    expect(s.hunkIds).toEqual(["a.ts:1", "c.ts:3"]);
  });

  it("dedupes hunk ids shared across the set's commits", () => {
    const commits = [
      group("sha1", ["a.ts:1", "shared.ts:1"]),
      group("sha2", ["shared.ts:1", "b.ts:2"]),
    ];
    const s = commitSetScope(commits);
    expect(s.hunkIds).toEqual(["a.ts:1", "shared.ts:1", "b.ts:2"]);
  });
});

describe("scopeCommitKeys", () => {
  it("reads commitKeys directly when present", () => {
    const s: ReviewScope = {
      source: "commit",
      key: "commits:sha1,sha3",
      title: "2 commits",
      hunkIds: [],
      commitKeys: ["sha1", "sha3"],
    };
    expect(scopeCommitKeys(s)).toEqual(new Set(["sha1", "sha3"]));
  });

  it("falls back to [key] for a legacy commit scope with no commitKeys", () => {
    const s: ReviewScope = {
      source: "commit",
      key: "sha1",
      title: "Commit",
      hunkIds: [],
    };
    expect(scopeCommitKeys(s)).toEqual(new Set(["sha1"]));
  });

  it("is empty for a non-commit scope", () => {
    expect(
      scopeCommitKeys({
        source: "status",
        key: "reviewed",
        title: "Reviewed",
        hunkIds: [],
      }),
    ).toEqual(new Set());
  });

  it("is empty for a null scope", () => {
    expect(scopeCommitKeys(null)).toEqual(new Set());
  });
});

describe("isCommitScope", () => {
  it("recognizes commit and uncommitted sources", () => {
    expect(
      isCommitScope({ source: "commit", key: "sha1", title: "", hunkIds: [] }),
    ).toBe(true);
    expect(
      isCommitScope({
        source: "uncommitted",
        key: "uncommitted",
        title: "",
        hunkIds: [],
      }),
    ).toBe(true);
    expect(
      isCommitScope({
        source: "status",
        key: "reviewed",
        title: "",
        hunkIds: [],
      }),
    ).toBe(false);
    expect(isCommitScope(null)).toBe(false);
  });
});

describe("commitsInScope", () => {
  const commit = (hash: string): CommitEntry => ({
    hash,
    shortHash: hash.slice(0, 4),
    message: `msg ${hash}`,
    author: "a",
    authorEmail: "a@x.com",
    date: "t",
  });
  const attribution: HunkAttribution = {
    commits: [commit("sha1"), commit("sha2"), commit("sha3")],
    hunkCommits: {},
  };

  it("returns the commits spanned by a non-contiguous set, in attribution order", () => {
    const s = commitSetScope([group("sha3", []), group("sha1", [])]);
    expect(commitsInScope(s, attribution).map((c) => c.hash)).toEqual([
      "sha1",
      "sha3",
    ]);
  });

  it("returns empty for a null attribution or non-commit scope", () => {
    const s = singleCommitScope(group("sha1", []));
    expect(commitsInScope(s, null)).toEqual([]);
    expect(
      commitsInScope(
        { source: "uncommitted", key: "uncommitted", title: "", hunkIds: [] },
        attribution,
      ),
    ).toEqual([]);
  });
});
