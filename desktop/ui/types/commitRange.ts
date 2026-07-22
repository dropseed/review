// A commit range is the sub-comparison a review can be narrowed to from the
// commit picker. It is not a hunk filter: it names a real `base..head` that the
// diff pipeline re-diffs, so a change a later commit overwrote is visible
// inside the range that made it and absent from the branch's net diff. That is
// the point of picking a range, and it is why this can't be a `ReviewScope`
// (an exact hunk-ID set carved out of one already-computed diff).
//
// Ordinals are 1-based into the branch's oldest-first commit list, matching the
// `#n` labels the picker renders.

import type { CommitEntry, Comparison, HunkAttribution } from "./index";
import { makeComparison } from "./index";

export interface CommitRange {
  /** `commits` spans a contiguous slice of the branch's commits; `uncommitted`
   *  is the working tree on top of the branch tip. */
  kind: "commits" | "uncommitted";
  /** Inclusive 1-based ordinals; both 0 for `uncommitted`. */
  loOrdinal: number;
  hiOrdinal: number;
  /** Label for the picker trigger. */
  title: string;
  /** The sub-comparison this range narrows the review to. */
  comparison: Comparison;
}

/**
 * The range covering commits `lo..hi` (inclusive, 1-based, oldest first) of
 * `commits`. `branchBase` is the review comparison's base — the parent-side
 * boundary when the range starts at the branch's first commit, where there is
 * no earlier commit to anchor to.
 */
export function commitRangeFor(
  commits: CommitEntry[],
  branchBase: string,
  lo: number,
  hi: number,
): CommitRange | null {
  if (lo < 1 || hi > commits.length || lo > hi) return null;
  return {
    kind: "commits",
    loOrdinal: lo,
    hiOrdinal: hi,
    title:
      lo === hi
        ? `#${lo} · ${commits[lo - 1].message}`
        : `Commits #${lo}–#${hi}`,
    comparison: makeComparison(
      // Diff from the commit *before* the range, so the range's own first
      // commit is included rather than used as the baseline.
      lo === 1 ? branchBase : commits[lo - 2].hash,
      commits[hi - 1].hash,
    ),
  };
}

/** The single-commit range for `sha`, or null if it isn't in `commits`. */
export function commitRangeForSha(
  commits: CommitEntry[],
  branchBase: string,
  sha: string,
): CommitRange | null {
  const ordinal = commits.findIndex((c) => c.hash === sha) + 1;
  return commitRangeFor(commits, branchBase, ordinal, ordinal);
}

/** The working tree on top of `branchHead` — `head..head` reads as "uncommitted". */
export function uncommittedRange(branchHead: string): CommitRange {
  return {
    kind: "uncommitted",
    loOrdinal: 0,
    hiOrdinal: 0,
    title: "Uncommitted changes",
    comparison: makeComparison(branchHead, branchHead),
  };
}

/** The CommitEntry[] a range spans, oldest first — for the context header. */
export function commitsInRange(
  range: CommitRange | null,
  attribution: HunkAttribution | null,
): CommitEntry[] {
  if (!range || !attribution || range.kind !== "commits") return [];
  // The ordinals index into this same oldest-first list.
  return attribution.commits.slice(range.loOrdinal - 1, range.hiOrdinal);
}

/** Whether two ranges name the same sub-comparison (for click-to-toggle). */
export function sameRange(
  a: CommitRange | null,
  b: CommitRange | null,
): boolean {
  if (!a || !b) return a === b;
  return a.kind === b.kind && a.comparison.key === b.comparison.key;
}
