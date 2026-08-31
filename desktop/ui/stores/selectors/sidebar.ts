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
import { makeReviewKey } from "../../utils/review-key";

import { memoOnIdentity } from "./memo";
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

/**
 * The PRs a snapshot may actually be read for.
 *
 * `available: false` means `gh` is gone or logged out, and the backend hands
 * back the *last cached* PRs alongside it rather than an empty list. Every
 * reader has to drop those: the sidebar deliberately shows no warning in that
 * state, so anything built from that cache would be stale indefinitely with
 * nothing on screen saying so — the exact failure this feature exists to avoid.
 *
 * One accessor rather than the same two-line guard at each call site, because
 * the guard being applied in three places and forgotten in a fourth is how a
 * card ends up badging a PR the row beneath it has already discarded.
 */
export function availablePrs(snapshot: ViewerPrSnapshot | null): ViewerPr[] {
  return snapshot == null || !snapshot.available ? NO_PRS : snapshot.prs;
}

const treeMemo = memoOnIdentity<RepoNode[]>();

/**
 * The sidebar tree, built from store state.
 *
 * The one place `buildSidebarTree` is called from, so every consumer walks the
 * same tree: the repos layer, work cards resolving their bound refs, the
 * palette's list of reviews, and the freshness check. Two of those used to call
 * the builder themselves and so couldn't see inputs the others had.
 *
 * Cached on input identity (see `selectors/memo.ts`) so multiple
 * subscribers share one build per state change rather than one per render. The
 * tree reads no clock, so identity is the whole story: it is rebuilt when git,
 * review state or the PR snapshot changes, and at no other time.
 */
export function getSidebarTree(state: SidebarTreeState): RepoNode[] {
  const viewerPrs = availablePrs(state.viewerPrs);

  // Everything the build reads, in one list: adding an input to the tree means
  // one edit here rather than three matching ones. Compared by identity.
  const deps: readonly unknown[] = [
    state.localActivity,
    state.globalReviews,
    state.globalReviewsByKey,
    viewerPrs,
  ];

  return treeMemo(deps, () =>
    buildSidebarTree(
      state.localActivity,
      state.globalReviews,
      state.globalReviewsByKey,
      viewerPrs,
    ),
  );
}

const rowsMemo = memoOnIdentity<Map<string, SidebarRow>>();

/**
 * The tree's rows indexed by review key.
 *
 * `getSidebarTree` is cached but `allSidebarRows` is not, and every caller that
 * wanted a row wanted it by key — so the flatten and the index are cached here
 * together, on the tree's own identity. Workspace cards, `activateReviewKey` and
 * `focusWorkspace` all read this one map, which is also what keeps them from
 * each answering "does this ref have a row" their own way.
 */
export function sidebarRowsByKey(tree: RepoNode[]): Map<string, SidebarRow> {
  return rowsMemo(
    [tree],
    () => new Map(allSidebarRows(tree).map((row) => [row.reviewKey, row])),
  );
}

const byRefMemo = memoOnIdentity<Map<string, SidebarRow>>();

/**
 * The tree's rows indexed by repo path and **branch**, which is not the same
 * index as [`sidebarRowsByKey`].
 *
 * A row's review key and its ref agree for everything except an `open-pr` row,
 * which is keyed `pr/N` (two PRs can share a head branch) while naming the head
 * branch as its ref. So this is the index that answers "is there anything at
 * this repo and branch" for a PR whose head has never been fetched — the state
 * a PR just picked up out of the drawer is in, and the reason its workspace
 * must not be told its branch is gone.
 *
 * Going through the tree rather than through the PR snapshot is what keeps the
 * answer honest: it inherits the availability gate, and it inherits the tree's
 * claim-once join, so a card can only badge the PR the row beneath it badges.
 * On the one collision the tree allows — two open PRs on one head branch, with
 * no local branch to claim either — the more recently updated wins, matching
 * the order the tree hands the rows out in.
 */
export function sidebarRowsByRepoRef(
  tree: RepoNode[],
): Map<string, SidebarRow> {
  return byRefMemo([tree], () => {
    const rows = new Map<string, SidebarRow>();
    for (const row of allSidebarRows(tree)) {
      const key = makeReviewKey(row.repoPath, row.ref);
      const held = rows.get(key);
      if (!held || newerPr(row, held)) rows.set(key, row);
    }
    return rows;
  });
}

/** Whether `row` carries a more recently updated PR than `held` does. */
function newerPr(row: SidebarRow, held: SidebarRow): boolean {
  if (!row.openPr) return false;
  if (!held.openPr) return true;
  return Date.parse(row.openPr.updatedAt) > Date.parse(held.openPr.updatedAt);
}

const byPrMemo = memoOnIdentity<Map<string, SidebarRow>>();

/**
 * The tree's rows indexed by the PR they stand for, `repoPath#number`.
 *
 * The tree decides which row a PR belongs to — by number when a review was
 * started from it, by head branch otherwise, and a synthesized `pr/N` row when
 * nothing local knows it at all — and then throws the mapping away. Anything
 * that starts from a PR and needs its row (the pull-requests drawer) would
 * otherwise re-derive that join and get a third answer.
 */
export function sidebarRowsByPr(tree: RepoNode[]): Map<string, SidebarRow> {
  return byPrMemo([tree], () => {
    const rows = new Map<string, SidebarRow>();
    for (const row of allSidebarRows(tree)) {
      if (row.openPr) rows.set(`${row.repoPath}#${row.openPr.number}`, row);
    }
    return rows;
  });
}

/** The row a review key names, or null when nothing represents it. */
export function findSidebarRow(
  state: SidebarTreeState,
  reviewKey: string,
): SidebarRow | null {
  return sidebarRowsByKey(getSidebarTree(state)).get(reviewKey) ?? null;
}
