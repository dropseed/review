import type { ReviewStore } from "../types";
import type { Comparison } from "../../types";

type CheckoutState = Pick<
  ReviewStore,
  "reviewComparison" | "currentBranch" | "gitStatus" | "worktreePath"
>;

/**
 * The branch this repo has checked out.
 *
 * `gitStatus.currentBranch` first, and the store's `currentBranch` only as a
 * fallback: the latter is loaded by browse mode and the file watcher, while a
 * review gets its branch from the git status it loads anyway.
 */
export function checkedOutBranch(state: CheckoutState): string | null {
  return state.gitStatus?.currentBranch ?? state.currentBranch;
}

/**
 * Whether a comparison's head is a revision that is actually checked out —
 * either the branch checked out in the repo, or the linked worktree this
 * review owns. Mirrors core's `working_tree_dir` (`sources/local_git.rs`),
 * which resolves a working-tree diff against both.
 *
 * A linked worktree counts for the review's *own* head and nothing else. It has
 * one revision checked out — the branch this review is of — so a commit being
 * peeked at inside a materialized review is no more checked out than it would
 * be without one. Asking only whether a worktree exists said otherwise, and
 * the Git tab it enabled would have staged against the branch while the diff
 * on screen was of a commit.
 *
 * Which comparison to ask about is the caller's: the diff on screen decides
 * what can be acted on, while the comparison bar asks the same question of
 * `reviewComparison` instead, because offering "uncommitted changes" is about
 * the branch the review is of rather than whichever slice of it is showing.
 */
export function isCheckedOut(
  state: CheckoutState,
  comparison: Comparison | null,
): boolean {
  const head = comparison?.head;
  if (!head) return false;
  return (
    head === checkedOutBranch(state) ||
    (state.worktreePath !== null && head === state.reviewComparison?.head)
  );
}

/** The same question asked of the diff on screen. */
export function headIsWorkingTree(
  state: CheckoutState & Pick<ReviewStore, "comparison">,
): boolean {
  return isCheckedOut(state, state.comparison);
}
