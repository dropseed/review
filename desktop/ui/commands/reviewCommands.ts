import { toast } from "sonner";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { getSidebarTree } from "../stores/selectors/sidebar";
import {
  allSidebarRows,
  openPrRowRef,
  type RepoNode,
} from "../utils/sidebar-tree";
import { getErrorMessage } from "../utils/errors";
import type { Command } from "./types";

/**
 * One command per row in the repos layer.
 *
 * Every row, not just the ones currently on screen: the digits belong to the
 * "Working on" queue now (see `workCommands`), so this list exists purely to be
 * typed at, and a review you have to expand a repo to find is exactly the one
 * worth being able to find by name.
 */
let cache: { tree: RepoNode[]; commands: Command[] } | null = null;

export function reviewCommands(): Command[] {
  const tree = getSidebarTree(useReviewStore.getState());
  // Every keystroke in the palette re-resolves every dynamic source, and this
  // one allocates a command, a keywords array and a closure per row in every
  // repo. The tree is already cached on its own inputs, so its identity is what
  // says whether any of that could have changed.
  if (cache?.tree === tree) return cache.commands;

  const commands: Command[] = allSidebarRows(tree).map((row) => {
    const baseOverride =
      row.entry.kind === "review" ? row.entry.review.baseOverride : undefined;
    // An open-PR row has no ref on disk yet, so resolving it would fail. It
    // activates the way a click on it does — fetch the head, write the review —
    // which is `activateReviewKey`'s job, reached by the row's own key.
    const openPr = row.entry.kind === "open-pr" ? row.entry.pr : null;

    return {
      id: `review.switch.${row.reviewKey}`,
      title: openPr ? `#${openPr.number} ${openPr.title}` : row.ref,
      category: "Reviews",
      keywords: [row.repoPath.split("/").pop() ?? ""],
      run: ({ ui }) => {
        if (openPr) {
          ui.activateReviewKey(row.repoPath, openPrRowRef(openPr));
          return;
        }
        // Read at press time, not at build time — these commands outlive the
        // render that produced them now.
        const store = useReviewStore.getState();
        store.saveNavigationSnapshot();
        // The palette calls `run` and drops the promise, so a rejection here
        // would surface as an unhandled one and the command as a silent no-op.
        return (async () => {
          try {
            const resolved = await getApiClient().resolveReview(
              row.repoPath,
              row.ref,
              baseOverride,
            );
            store.setActiveReviewKey({ repoPath: row.repoPath, ref: row.ref });
            if (row.repoPath !== useReviewStore.getState().repoPath) {
              store.switchReview(row.repoPath, resolved);
            } else {
              store.setComparison(resolved);
            }
          } catch (err) {
            console.error("Failed to switch review:", err);
            toast.error(`Couldn't open ${row.ref}: ${getErrorMessage(err)}`);
          }
        })();
      },
    };
  });

  cache = { tree, commands };
  return commands;
}
