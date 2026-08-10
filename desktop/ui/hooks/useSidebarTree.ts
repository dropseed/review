import { useReviewStore } from "../stores";
import { getSidebarTree } from "../stores/selectors/sidebar";
import { type RepoNode } from "../utils/sidebar-tree";

/**
 * The sidebar tree — repos in terminal/activity order, each carrying its own
 * rows.
 *
 * Recomputed at most once per minute (the 7/14-day liveness windows don't need
 * finer granularity) and whenever its inputs change. The build itself is
 * cached in `getSidebarTree`, so the expanded sidebar and the collapsed rail
 * subscribing at the same time cost one tree, not two.
 */
export function useSidebarTree(): RepoNode[] {
  // The repo this window has open. It counts as live on its own, so browsing a
  // quiet repo can't file it under "quiet repos" while you're looking at it.
  const openRepoPath = useReviewStore((s) => s.repoPath);
  const now = Date.now();

  return useReviewStore((s) => getSidebarTree(s, now, openRepoPath));
}
