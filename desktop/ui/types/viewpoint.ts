// Which revision the code half is looking at.
//
// A review is one `base..head`, but the screen is not always showing it: it can
// be narrowed to a slice of the branch, or handed over entirely to a commit
// being peeked at. Those used to be two independent pieces of state that had to
// agree with a third (`comparison`) about what was on screen, and the ways they
// could disagree were all real: a peek left over a comparison it wasn't of, a
// narrowing restored under a peek. One tagged union instead — the diff on
// screen is a function of it, so there is nothing left to keep in step.

import type { Comparison } from "./index";
import { sameRange, type CommitRange } from "./commitRange";

/**
 * A commit being looked at inside a review's tab, without becoming a review.
 *
 * Held in `types/` rather than beside the state that writes it so the modules
 * that only *read* it — `reviewSlice`'s write guards, the viewer, the files
 * panel — take no dependency on the store to name it.
 */
export interface EphemeralView {
  hash: string;
  shortHash: string;
  subject: string;
  /** `parent..sha` — a merge's first parent, a root commit's empty tree. */
  comparison: Comparison;
  /** More than one parent: what's on screen is the first-parent diff. */
  isMerge: boolean;
}

/**
 * `review` is the review's own comparison; `range` narrows within it and keeps
 * the review attached (decisions still persist, `reviewComparison` still names
 * the branch); `commit` detaches — the review state is null for its whole
 * duration and nothing is written.
 */
export type Viewpoint =
  | { kind: "review" }
  | { kind: "range"; range: CommitRange }
  | { kind: "commit"; view: EphemeralView };

/** The default, and where every "back to the review" lands. */
export const REVIEW_VIEWPOINT: Viewpoint = { kind: "review" };

/**
 * Whether two viewpoints name the same thing to look at — the no-op check, and
 * what makes clicking the active row in a picker mean "clear it" rather than
 * "set it again".
 */
export function sameViewpoint(a: Viewpoint, b: Viewpoint): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "review") return true;
  if (a.kind === "range" && b.kind === "range") {
    return sameRange(a.range, b.range);
  }
  if (a.kind === "commit" && b.kind === "commit") {
    return a.view.hash === b.view.hash;
  }
  return false;
}

/** The `base..head` a viewpoint puts on screen, against the review's own. */
export function viewpointComparison(
  viewpoint: Viewpoint,
  reviewComparison: Comparison,
): Comparison {
  switch (viewpoint.kind) {
    case "review":
      return reviewComparison;
    case "range":
      return viewpoint.range.comparison;
    case "commit":
      return viewpoint.view.comparison;
  }
}
