import type { Comparison } from "../../types";
import type { ReviewStore } from "../types";
import { reviewScopeKey } from "../../utils/review-key";
import { activeBrowseRef } from "./browse";

/**
 * A commit being looked at inside a review's tab, without becoming a review.
 *
 * Held here rather than in the slice so the modules that only *read* it —
 * `reviewSlice`'s write guards, the viewer, the banner — don't take a runtime
 * dependency on the slice that writes it.
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

type EphemeralState = Pick<
  ReviewStore,
  "repoPath" | "reviewRef" | "comparison" | "ephemeralByReview"
>;

/**
 * The commit being peeked at right now, or null when the tab is showing its
 * own comparison.
 *
 * The comparison check is the load-bearing half. An entry only counts while it
 * is *the thing being diffed* — so a switch that swaps `comparison` out from
 * under a stale entry (a review switch, a base override) leaves it inert
 * rather than leaving the app half in a peek it never left.
 */
export function ephemeralView(state: EphemeralState): EphemeralView | null {
  const key = reviewScopeKey(state);
  if (key === null) return null;
  const view = state.ephemeralByReview[key];
  if (!view) return null;
  return view.comparison.key === state.comparison?.key ? view : null;
}

/**
 * The content on screen can't be decided on or annotated. Three ways to get
 * there, one consequence: a read-only branch preview has no worktree to act
 * against, a commit peek renders a comparison this review isn't of, and a
 * Browse ref pin renders a revision it isn't of — either of the last two would
 * file a comment against a line the review's own revision may not have.
 *
 * One predicate, because every surface that hides an approve button or a
 * comment gutter wants the same answer from all three.
 */
export function viewOnly(
  state: EphemeralState &
    Pick<
      ReviewStore,
      "readOnlyPreview" | "browseRefByReview" | "filesPanelTab"
    >,
): boolean {
  return (
    state.readOnlyPreview ||
    ephemeralView(state) !== null ||
    activeBrowseRef(state) !== null
  );
}
