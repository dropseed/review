import { useSpurStore } from "../stores";
import { getSidebarTree } from "../stores/selectors/sidebar";
import { type RepoNode } from "../utils/sidebar-tree";

/**
 * The sidebar tree — every registered repo in alphabetical order, each
 * carrying its own rows.
 *
 * Recomputed only when its inputs change; there is no clock in it. The build
 * itself is cached in `getSidebarTree`, so the repos layer and the work cards
 * subscribing at the same time cost one tree, not two.
 */
export function useSidebarTree(): RepoNode[] {
  return useSpurStore(getSidebarTree);
}
