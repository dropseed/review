import type { SpurStore } from "../types";
import type { EphemeralView } from "../../types/viewpoint";
import { headIsWorkingTree } from "./checkout";

type ViewpointState = Pick<SpurStore, "viewpoint">;

/**
 * The commit being peeked at right now, or null when the tab is showing a
 * comparison the review is of.
 *
 * A read adapter over `viewpoint`, kept because every consumer asks this
 * narrower question — "is this a peek" — rather than wanting the union.
 */
export function ephemeralView(state: ViewpointState): EphemeralView | null {
  return state.viewpoint.kind === "commit" ? state.viewpoint.view : null;
}

type WorkingTreeState = Pick<
  SpurStore,
  | "comparison"
  | "reviewComparison"
  | "currentBranch"
  | "gitStatus"
  | "worktreePath"
>;

/**
 * The revision Browse reads at, or null for the working tree.
 *
 * Browse used to carry its own pin, set from a ref picker of its own, which
 * meant the panel could be reading one revision while the diff beside it was of
 * another. It reads whatever is on screen instead: with no checkout of the head
 * to read from, the tree and the files under it come out of the object database
 * at that revision.
 */
export function historicRef(
  state: WorkingTreeState & ViewpointState,
): string | null {
  if (headIsWorkingTree(state)) return null;
  return state.comparison?.head ?? null;
}

/**
 * The same, as an *active surface*: only while Browse is the tab on screen.
 *
 * Reading an old revision belongs to the Browse tab — it is what that tab
 * shows and where it is explained — so it must not reach into the Review tab,
 * whose diff is acted on. Every surface asking "can this be acted on" wants the
 * revision *and* the tab condition together, so they are asked for together.
 */
export function activeHistoricRef(
  state: WorkingTreeState & ViewpointState & Pick<SpurStore, "filesPanelTab">,
): string | null {
  return state.filesPanelTab === "browse" ? historicRef(state) : null;
}

/**
 * The content on screen can't be decided on or annotated. Three ways to get
 * there, one consequence: a read-only branch preview has no worktree to act
 * against, a commit peek renders a comparison this review isn't of, and Browse
 * at a historic revision renders one it isn't of either — either of the last
 * two would file a comment against a line the review's own revision may not
 * have.
 *
 * One predicate, because every surface that hides an approve button or a
 * comment gutter wants the same answer from all three.
 */
export function viewOnly(
  state: WorkingTreeState &
    ViewpointState &
    Pick<SpurStore, "readOnlyPreview" | "filesPanelTab">,
): boolean {
  return (
    state.readOnlyPreview ||
    ephemeralView(state) !== null ||
    activeHistoricRef(state) !== null
  );
}
