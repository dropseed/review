import { useReviewStore } from "../../stores";
import { panelReviewKey } from "../../stores/slices/terminalSlice";

/**
 * Open a terminal in a new tab, in the directory this review is about: its own
 * checkout. There's no cwd picker — a shell that landed somewhere else than you
 * wanted is one `cd` away.
 *
 * Read off the store rather than taking the panel's props, because the panel is
 * not the only thing that opens a tab: ⌘T does too, from wherever the focus is,
 * and it must land the same shell in the same place.
 *
 * Resolves to the new session's id, or null when there was nothing to open one
 * for (no repo, or a materialize prompt the user declined).
 */
export async function openTerminalTab(): Promise<string | null> {
  const store = useReviewStore.getState();
  const { repoPath, reviewRef, reviewTier, terminalCheckouts } = store;
  if (!repoPath) return null;

  const reviewKey = panelReviewKey(terminalCheckouts, repoPath, reviewRef);

  const worktree =
    reviewTier?.tier === "materialized" ? reviewTier.worktreePath : null;
  if (worktree) {
    return store.startTerminal(reviewKey, repoPath, worktree, 80, 24);
  }

  // No review open (or a repo-level view) — the repo root is the only
  // directory there is.
  if (!reviewRef) {
    return store.startTerminal(reviewKey, repoPath, repoPath, 80, 24);
  }

  // This review has no checkout yet. Materializing asks first, so a declined
  // prompt simply starts no terminal.
  const worktreePath = await store.ensureMaterialized("run a terminal in it");
  if (!worktreePath) return null;
  return store.startTerminal(reviewKey, repoPath, worktreePath, 80, 24);
}
