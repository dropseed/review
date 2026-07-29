import { selectLiveSessionsByReviewKey } from "../slices/terminalSlice";
import { buildSidebarTree, type RepoNode } from "../../utils/sidebar-tree";
import type { TerminalSlice } from "../slices/terminalSlice";
import type { GlobalReviewSummary, RepoLocalActivity } from "../../types";

/** Everything `buildSidebarTree` needs that lives in the store. */
export interface SidebarTreeState extends Pick<
  TerminalSlice,
  "terminalSessions" | "terminalExited" | "terminalCheckouts"
> {
  localActivity: RepoLocalActivity[];
  globalReviews: GlobalReviewSummary[];
  globalReviewsByKey: Record<string, GlobalReviewSummary>;
  sidebarPinned: string[];
  sidebarDismissed: string[];
}

interface CacheEntry {
  localActivity: RepoLocalActivity[];
  globalReviews: GlobalReviewSummary[];
  globalReviewsByKey: Record<string, GlobalReviewSummary>;
  sidebarPinned: string[];
  sidebarDismissed: string[];
  minute: number;
  terminalKeys: string;
  output: RepoNode[];
}

/**
 * One entry per `openRepoPath`, so a caller that asks about a different repo
 * than the window is showing — the freshness check does — can't evict the
 * entry every render path depends on.
 */
const cache = new Map<string, CacheEntry>();

/**
 * The sidebar tree, built from store state.
 *
 * The one place `buildSidebarTree` is called from, so every consumer walks the
 * same tree: the sidebar, the collapsed rail, ⌘1–9's positional jump, and the
 * freshness check. Two of those used to call the builder themselves and so
 * couldn't see inputs the others had — a row could be live in the rendered
 * list and absent from the list ⌘3 counted through.
 *
 * Cached on input identity (the pattern in `selectors/hunks.ts`) so multiple
 * subscribers share one build per state change rather than one per render.
 * Terminal membership is keyed on the *keys themselves* rather than the
 * grouping's identity: the checkout index is rebuilt from scratch on every git
 * refresh, and rebuilding the tree because an identical answer arrived in a
 * new object is the kind of work that's invisible until it isn't.
 */
export function getSidebarTree(
  state: SidebarTreeState,
  now: number,
  openRepoPath: string | null,
): RepoNode[] {
  // Bucketed to the minute: the liveness windows are 7 and 14 days, so finer
  // granularity buys nothing and costs everything — an exact `Date.now()` from
  // any one caller would miss the cache and hand every subscriber a new tree.
  const minute = Math.floor(now / 60_000);
  const terminalKeys = Object.keys(selectLiveSessionsByReviewKey(state)).sort();
  const terminalKeysId = terminalKeys.join("\n");

  const cacheKey = openRepoPath ?? "";
  const hit = cache.get(cacheKey);
  if (
    hit &&
    hit.localActivity === state.localActivity &&
    hit.globalReviews === state.globalReviews &&
    hit.globalReviewsByKey === state.globalReviewsByKey &&
    hit.sidebarPinned === state.sidebarPinned &&
    hit.sidebarDismissed === state.sidebarDismissed &&
    hit.minute === minute &&
    hit.terminalKeys === terminalKeysId
  ) {
    return hit.output;
  }

  const output = buildSidebarTree(
    state.localActivity,
    state.globalReviews,
    state.globalReviewsByKey,
    state.sidebarPinned,
    state.sidebarDismissed,
    minute * 60_000,
    openRepoPath,
    terminalKeys,
  );

  cache.set(cacheKey, {
    localActivity: state.localActivity,
    globalReviews: state.globalReviews,
    globalReviewsByKey: state.globalReviewsByKey,
    sidebarPinned: state.sidebarPinned,
    sidebarDismissed: state.sidebarDismissed,
    minute,
    terminalKeys: terminalKeysId,
    output,
  });
  return output;
}
