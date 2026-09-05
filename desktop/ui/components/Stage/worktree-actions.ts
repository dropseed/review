import { toast } from "sonner";
import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";
import { useSpurStore } from "../../stores";
import type { WorktreeStatus } from "../../types";
import type { RepoChoice } from "./repo-choices";
import { sessionsUnder } from "./worktree-facts";

/**
 * Give a branch a checkout in `repo`, and answer with the row that opens it.
 *
 * A branch that already has a worktree is routed to rather than refused: git
 * will not check one branch out twice, and being sent to the checkout that
 * exists is what the request meant either way. The backend decides that (it is
 * the only side that can, without racing), and says so in `created` — which is
 * worth a word on screen, because "New worktree…" quietly opening an old one
 * would otherwise look like the create silently failed.
 *
 * Throws with the backend's own sentence, for the form to show.
 */
export async function createWorktreeIn(
  repo: RepoChoice,
  branch: string,
): Promise<RepoChoice> {
  const checkout = await getApiClient().createWorktree(repo.path, branch);
  if (!checkout.created) {
    toast.info(`"${checkout.branch}" already has a worktree — opening it.`);
  }
  await useSpurStore.getState().loadLocalActivity();
  return {
    // The checkout that now exists, exactly as a worktree row from the sidebar
    // tree — so a worktree made here opens as its own tab, beside whatever the
    // workspace was already showing.
    path: checkout.path,
    repoRoot: repo.path,
    name: repo.name,
    refName: checkout.branch,
  };
}

/**
 * Delete a worktree's directory, after asking.
 *
 * The safety rules are the backend's (`LocalGitSource::remove_worktree`): a
 * path that isn't one of this repo's worktrees, the main checkout, and any
 * uncommitted work are all refused there, at the moment of the delete, because
 * a flag this side read a second ago is not a fact about the disk. There is no
 * force anywhere in the path; a dirty worktree comes back as a sentence saying
 * so, and resolving it is the user's.
 *
 * Nothing is detached afterwards. A tab showing the *repository* at this branch
 * stays valid — the branch outlives its checkout, and `refName` was only ever a
 * view hint — but a workspace that attached the worktree itself is left with a
 * tab naming a directory that is gone, which is the same closable tab a moved
 * folder leaves. That is what `useWorktreeInUse` marks the row with beforehand:
 * a checkout the queue is pointed at says so before the delete, not after.
 *
 * What a delete can otherwise strand is a shell, so terminals started in it are
 * counted into the prompt: a clean worktree with someone working in it passes
 * every check git makes and is still the wrong thing to delete.
 *
 * Returns whether the worktree is gone.
 */
export async function removeWorktreeAt(
  repoPath: string,
  worktree: WorktreeStatus,
): Promise<boolean> {
  const store = useSpurStore.getState();
  const terminals = sessionsUnder(store.terminalSessions, worktree.path).length;

  const label = worktree.branch ?? "a detached HEAD";
  const lines = [`Remove the worktree for ${label}?`, worktree.path];
  if (!worktree.isReviewManaged) {
    lines.push("You made this worktree outside Review.");
  }
  if (terminals > 0) {
    lines.push(
      terminals === 1
        ? "A terminal is running in it."
        : `${terminals} terminals are running in it.`,
    );
  }

  const { dialogs } = getPlatformServices();
  const confirmed = await dialogs.confirm(
    lines.join("\n\n"),
    "Remove worktree",
  );
  if (!confirmed) return false;

  try {
    await getApiClient().removeWorktree(repoPath, worktree.path);
  } catch (err) {
    await dialogs.alert(String(err), "Could not remove worktree");
    return false;
  }

  // The sidebar tree is where the picker's rows come from, and a branch that
  // just lost its checkout is a different row.
  await store.loadLocalActivity();
  return true;
}
