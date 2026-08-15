import type { ReviewStore } from "../types";
import { reviewScopeKey } from "../../utils/review-key";

type BrowseState = Pick<
  ReviewStore,
  "repoPath" | "reviewRef" | "browseRefByReview"
>;

/** The ref Browse is pinned to right now, or null for the working tree. */
export function browseRef(state: BrowseState): string | null {
  const key = reviewScopeKey(state);
  return key === null ? null : (state.browseRefByReview[key] ?? null);
}

/**
 * The pin as an *active surface*: the ref Browse is showing, but only while
 * Browse is the tab on screen.
 *
 * The pin belongs to the Browse tab — it is set there and the banner explaining
 * it is drawn there — so it must not reach into what the Review tab shows,
 * which is a diff of the working tree. Every surface that asks "can this be
 * acted on" wants the pin *and* the tab condition together, so they are asked
 * for together.
 */
export function activeBrowseRef(
  state: BrowseState & Pick<ReviewStore, "filesPanelTab">,
): string | null {
  return state.filesPanelTab === "browse" ? browseRef(state) : null;
}
