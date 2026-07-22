import { describe, it, expect } from "vitest";
import {
  commitRangeFor,
  commitsInRange,
  sameRange,
  uncommittedRange,
} from "./commitRange";
import { commitRangeForSha } from "./commitRange";
import type { CommitEntry, HunkAttribution } from "./index";

// Oldest first, matching attribution order and the picker's `#n` ordinals.
const commits: CommitEntry[] = [
  { hash: "sha1", shortHash: "sha1", message: "first", body: "" },
  { hash: "sha2", shortHash: "sha2", message: "second", body: "" },
  { hash: "sha3", shortHash: "sha3", message: "third", body: "" },
] as CommitEntry[];

describe("commitRangeFor", () => {
  it("anchors a range starting at the first commit to the branch base", () => {
    const r = commitRangeFor(commits, "main", 1, 2)!;
    // Not "sha1" — that would use the range's own first commit as the
    // baseline and hide the change it introduced.
    expect(r.comparison.key).toBe("main..sha2");
  });

  it("anchors a mid-branch range to the commit before it", () => {
    expect(commitRangeFor(commits, "main", 2, 3)!.comparison.key).toBe(
      "sha1..sha3",
    );
  });

  it("builds a single-commit range as parent..commit", () => {
    const r = commitRangeFor(commits, "main", 2, 2)!;
    expect(r.comparison.key).toBe("sha1..sha2");
    expect(r.title).toBe("#2 · second");
  });

  it("titles a multi-commit range by its ordinals", () => {
    expect(commitRangeFor(commits, "main", 1, 3)!.title).toBe("Commits #1–#3");
  });

  it("rejects out-of-bounds and inverted ordinals", () => {
    expect(commitRangeFor(commits, "main", 0, 2)).toBeNull();
    expect(commitRangeFor(commits, "main", 1, 4)).toBeNull();
    expect(commitRangeFor(commits, "main", 3, 2)).toBeNull();
  });
});

describe("uncommittedRange", () => {
  it("is head..head, which the diff layer reads as the working tree", () => {
    const r = uncommittedRange("feature");
    expect(r.kind).toBe("uncommitted");
    expect(r.comparison.key).toBe("feature..feature");
  });
});

describe("commitsInRange", () => {
  const attribution = { commits, hunkCommits: {} } as HunkAttribution;

  it("returns the spanned commits oldest first", () => {
    const r = commitRangeFor(commits, "main", 2, 3)!;
    expect(commitsInRange(r, attribution).map((c) => c.hash)).toEqual([
      "sha2",
      "sha3",
    ]);
  });

  it("returns nothing for the uncommitted range or a missing attribution", () => {
    expect(commitsInRange(uncommittedRange("feature"), attribution)).toEqual(
      [],
    );
    expect(commitsInRange(commitRangeFor(commits, "main", 1, 1), null)).toEqual(
      [],
    );
    expect(commitsInRange(null, attribution)).toEqual([]);
  });
});

describe("sameRange", () => {
  it("compares by the comparison a range names, not its ordinals", () => {
    const a = commitRangeFor(commits, "main", 2, 2)!;
    const b = commitRangeFor(commits, "main", 2, 2)!;
    expect(sameRange(a, b)).toBe(true);
    expect(sameRange(a, commitRangeFor(commits, "main", 3, 3))).toBe(false);
  });

  it("treats a range and the full comparison as different", () => {
    expect(sameRange(commitRangeFor(commits, "main", 1, 1), null)).toBe(false);
    expect(sameRange(null, null)).toBe(true);
  });

  it("distinguishes the uncommitted range from a commit range that shares refs", () => {
    const uncommitted = uncommittedRange("sha3");
    const asCommits = { ...uncommitted, kind: "commits" as const };
    expect(sameRange(uncommitted, asCommits)).toBe(false);
  });
});

describe("commitRangeForSha", () => {
  it("resolves a sha to its single-commit range", () => {
    expect(commitRangeForSha(commits, "main", "sha2")!.comparison.key).toBe(
      "sha1..sha2",
    );
  });

  it("returns null for a sha outside the branch", () => {
    expect(commitRangeForSha(commits, "main", "nope")).toBeNull();
  });
});
