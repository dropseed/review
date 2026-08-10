import { toast } from "sonner";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { getSidebarTree } from "../stores/selectors/sidebar";
import { flattenSidebarTree, openPrRowRef } from "../utils/sidebar-tree";
import { getErrorMessage } from "../utils/errors";
import type { Command } from "./types";

/** Only the first nine get a positional shortcut; the rest are typed for. */
const SHORTCUT_LIMIT = 9;

/**
 * One command per review visible in the sidebar.
 *
 * A dynamic source rather than nine positional bindings. ⌘1–9 used to be
 * handled by its own keydown branch, which meant the app's most-used
 * navigation could not be reached by typing a review's name into ⌘K — and,
 * because it read `event.key`, the digits did not resolve on layouts where the
 * top row is not digits.
 */
export function reviewCommands(): Command[] {
  const state = useReviewStore.getState();
  const tree = getSidebarTree(state, Date.now(), state.repoPath);
  const rows = flattenSidebarTree(
    tree,
    state.collapsedRepos,
    state.expandedRepoRest,
    state.showInactiveRepos,
  );

  return rows.map((row, index) => {
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
      shortcut:
        index < SHORTCUT_LIMIT
          ? { code: `Digit${index + 1}`, mod: true }
          : undefined,
      run: ({ ui }) => {
        if (openPr) {
          ui.activateReviewKey(row.repoPath, openPrRowRef(openPr));
          return;
        }
        state.saveNavigationSnapshot();
        // The palette calls `run` and drops the promise, so a rejection here
        // would surface as an unhandled one and the command as a silent no-op.
        return (async () => {
          try {
            const resolved = await getApiClient().resolveReview(
              row.repoPath,
              row.ref,
              baseOverride,
            );
            state.setActiveReviewKey({ repoPath: row.repoPath, ref: row.ref });
            if (row.repoPath !== useReviewStore.getState().repoPath) {
              state.switchReview(row.repoPath, resolved);
            } else {
              state.setComparison(resolved);
            }
          } catch (err) {
            console.error("Failed to switch review:", err);
            toast.error(`Couldn't open ${row.ref}: ${getErrorMessage(err)}`);
          }
        })();
      },
    };
  });
}
