import {
  allSidebarRows,
  buildSidebarTree,
  type RepoNode,
  type SidebarRow,
} from "../../utils/sidebar-tree";
import type {
  GlobalReviewSummary,
  RepoLocalActivity,
  ViewerPr,
  ViewerPrSnapshot,
} from "../../types";

/** Everything `buildSidebarTree` needs that lives in the store. */
export interface SidebarTreeState {
  localActivity: RepoLocalActivity[];
  globalReviews: GlobalReviewSummary[];
  globalReviewsByKey: Record<string, GlobalReviewSummary>;
  viewerPrs: ViewerPrSnapshot | null;
}

/**
 * Stands in for "no snapshot yet" — a shared identity, because the cache keys
 * on input identity and a fresh `[]` per call would miss it every time.
 */
const NO_PRS: ViewerPr[] = [];

interface CacheEntry {
  /** Compared positionally against a freshly built list — see `deps` below. */
  deps: readonly unknown[];
  output: RepoNode[];
}

let cache: CacheEntry | null = null;

/**
 * The sidebar tree, built from store state.
 *
 * The one place `buildSidebarTree` is called from, so every consumer walks the
 * same tree: the repos layer, work cards resolving their bound refs, the
 * palette's list of reviews, and the freshness check. Two of those used to call
 * the builder themselves and so couldn't see inputs the others had.
 *
 * Cached on input identity (the pattern in `selectors/hunks.ts`) so multiple
 * subscribers share one build per state change rather than one per render. The
 * tree reads no clock, so identity is the whole story: it is rebuilt when git,
 * review state or the PR snapshot changes, and at no other time.
 */
export function getSidebarTree(state: SidebarTreeState): RepoNode[] {
  // `available: false` means `gh` is gone or logged out, and the backend hands
  // back the *last cached* PRs alongside it rather than an empty list. Those
  // have to be dropped here, at the one place the tree reads them: the sidebar
  // deliberately shows no warning in that state, so badges and PR rows built
  // from that cache would be stale indefinitely with nothing on screen saying
  // so — the exact failure this feature exists to avoid.
  const snapshot = state.viewerPrs;
  const viewerPrs =
    snapshot == null || !snapshot.available ? NO_PRS : snapshot.prs;

  // Everything the build reads, in one list: adding an input to the tree means
  // one edit here rather than three matching ones. Compared by identity.
  const deps: readonly unknown[] = [
    state.localActivity,
    state.globalReviews,
    state.globalReviewsByKey,
    viewerPrs,
  ];

  const hit = cache;
  if (hit && deps.every((dep, i) => dep === hit.deps[i])) {
    return hit.output;
  }

  const output = buildSidebarTree(
    state.localActivity,
    state.globalReviews,
    state.globalReviewsByKey,
    viewerPrs,
  );

  cache = { deps, output };
  return output;
}

let rowsCache: { tree: RepoNode[]; rows: Map<string, SidebarRow> } | null =
  null;

/**
 * The tree's rows indexed by review key.
 *
 * `getSidebarTree` is cached but `allSidebarRows` is not, and every caller that
 * wanted a row wanted it by key — so the flatten and the index are cached here
 * together, on the tree's own identity. Work cards, `activateReviewKey` and
 * `activateWorkItem` all read this one map, which is also what keeps them from
 * each answering "does this ref have a row" their own way.
 */
export function sidebarRowsByKey(tree: RepoNode[]): Map<string, SidebarRow> {
  if (rowsCache?.tree === tree) return rowsCache.rows;
  const rows = new Map(allSidebarRows(tree).map((row) => [row.reviewKey, row]));
  rowsCache = { tree, rows };
  return rows;
}

/** The row a review key names, or null when nothing represents it. */
export function findSidebarRow(
  state: SidebarTreeState,
  reviewKey: string,
): SidebarRow | null {
  return sidebarRowsByKey(getSidebarTree(state)).get(reviewKey) ?? null;
}
