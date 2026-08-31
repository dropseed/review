import { toast } from "sonner";
import { getApiClient } from "../../api";
import { useSpurStore } from "../../stores";
import { getErrorMessage } from "../../utils/errors";

/**
 * Look at one commit in the tab that's open, without reviewing it.
 *
 * The verb behind every "view this commit" row — the Browse tab's history and
 * the Review tab's commit list both call this, so a commit opens the same way
 * whichever list it was clicked in. Resolving `parent..sha` is the backend's
 * job (`commit_comparison`): a merge and a root commit are the two cases where
 * "the parent" isn't a thing the frontend can name.
 *
 * Nothing is written — see `setViewpoint` for why that holds.
 */
export async function openCommitView(hash: string): Promise<void> {
  const { repoPath, comparison, setViewpoint, setFilesPanelTab } =
    useSpurStore.getState();
  // A peek borrows the tab's comparison and gives it back. Without one there
  // is nothing to borrow, and nothing would load in its place.
  if (!repoPath || !comparison) return;

  try {
    const resolved = await getApiClient().getCommitComparison(repoPath, hash);
    setViewpoint({
      kind: "commit",
      view: {
        hash: resolved.hash,
        shortHash: resolved.shortHash,
        subject: resolved.subject,
        comparison: resolved.comparison,
        isMerge: resolved.parentCount > 1,
      },
    });
    // What a commit *is* is the files it changed, and that is the Review tab's
    // list — landing on Browse would show the whole repo and none of the point.
    setFilesPanelTab("changes");
  } catch (err) {
    // The click is otherwise indistinguishable from nothing having happened.
    toast.error(`Couldn't open ${hash.slice(0, 7)}: ${getErrorMessage(err)}`);
  }
}
