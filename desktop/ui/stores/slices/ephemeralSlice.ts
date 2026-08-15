import type { SliceCreator } from "../types";
import type { EphemeralView } from "../selectors/ephemeral";
import { reviewScopeKey } from "../../utils/review-key";
import { beginDiffSwap, diffDataResetState } from "./filesSlice";

export interface EphemeralSlice {
  /**
   * The commit each review's tab is currently peeking at. A key with no entry
   * means the tab is showing its own comparison, which is the default and
   * where "Back to the review" returns.
   *
   * Session state, and only that. It is never written to the review, to the
   * workspace's attachment, or to `work.json` — looking at a commit is looking,
   * not a decision about anything. Read it through `ephemeralView`, which also
   * checks the entry is the diff currently on screen.
   */
  ephemeralByReview: Record<string, EphemeralView>;
  /**
   * Peek at a commit in the current tab, or return to the review with `null`.
   * The single writer — nothing else moves an ephemeral view in or out.
   */
  setEphemeralView: (view: EphemeralView | null) => void;
}

/**
 * Dropped when the review a peek belongs to changes.
 *
 * Spread into `filesSlice`'s review-identity reset rather than written there:
 * `setEphemeralView` is the single writer of a peek *within* a review, and the
 * one other way an entry can go — the review under it being swapped out — stays
 * this slice's word too. Dropped rather than left to expire so a promoted peek
 * ("Start reviewing this range") doesn't leave its own record behind on the tab
 * it came from.
 */
export const ephemeralResetState = {
  ephemeralByReview: {} as Record<string, EphemeralView>,
};

/**
 * Viewing a commit without reviewing it.
 *
 * Opening a comparison normally creates review state on disk: the loader reads
 * it, classification decorates it, and the debounced save writes it — so merely
 * looking at a range would put a file in `~/.review` and a row in `review
 * list`. A peek must not do that, and the way it doesn't is that **the review
 * state is null for the whole peek**: this action clears it, and
 * `loadReviewState` refuses to refill it while a view is set. Every write path
 * below that — `saveReviewState`, `updateHunkStatuses`, `classifyStaticHunks`,
 * `syncTotalDiffHunks`, `reconcileReviewState` — already returns early on a
 * null review state, so they are all closed by the one gate rather than by five
 * flags that could drift apart.
 *
 * What is *shown* is the ordinary diff pipeline: the comparison is swapped the
 * same way a commit-range narrowing swaps it, keeping the review's identity
 * (`reviewRef`, `reviewComparison`) untouched so leaving restores it intact.
 */
export const createEphemeralSlice: SliceCreator<EphemeralSlice> = (
  set,
  get,
) => ({
  ephemeralByReview: {},

  setEphemeralView: (view) => {
    const state = get();
    const key = reviewScopeKey(state);
    if (key === null) return;
    if ((state.ephemeralByReview[key]?.hash ?? null) === (view?.hash ?? null)) {
      return;
    }

    beginDiffSwap(state, { snapshot: view !== null });

    const next = { ...state.ephemeralByReview };
    if (view) {
      next[key] = view;
    } else {
      delete next[key];
    }

    set({
      ...diffDataResetState,
      ephemeralByReview: next,
      // Leaving lands back on whatever slice the review was showing — its own
      // comparison, or the range it was narrowed to.
      comparison: view
        ? view.comparison
        : (state.commitRange?.comparison ?? state.reviewComparison),
      // Nulled deliberately: this is the no-persistence gate, not a side
      // effect of clearing the diff. Reloaded from disk on the way out.
      reviewState: null,
      // Whether the branch has a checkout to act against is not something a
      // peek changes, so it survives the reset above rather than being
      // recomputed as false on the way back.
      readOnlyPreview: state.readOnlyPreview,
    });
  },
});
