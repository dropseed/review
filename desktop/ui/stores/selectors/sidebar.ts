import { selectLiveSessionsByReviewKey } from "../slices/terminalSlice";
import { buildSidebarTree, type RepoNode } from "../../utils/sidebar-tree";
import type { TerminalSlice } from "../slices/terminalSlice";
import type {
  GlobalReviewSummary,
  RepoLocalActivity,
  ViewerPr,
  ViewerPrSnapshot,
} from "../../types";

/** Everything `buildSidebarTree` needs that lives in the store. */
export interface SidebarTreeState extends Pick<
  TerminalSlice,
  "terminalSessions" | "terminalExited" | "terminalCheckouts" | "terminalHomes"
> {
  localActivity: RepoLocalActivity[];
  globalReviews: GlobalReviewSummary[];
  globalReviewsByKey: Record<string, GlobalReviewSummary>;
  sidebarDismissed: string[];
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
  // one edit here rather than three matching ones. Compared by identity, so
  // terminal membership joins as a string — see above for why.
  const deps: readonly unknown[] = [
    state.localActivity,
    state.globalReviews,
    state.globalReviewsByKey,
    state.sidebarDismissed,
    minute,
    terminalKeys.join("\n"),
    viewerPrs,
  ];

  const cacheKey = openRepoPath ?? "";
  const hit = cache.get(cacheKey);
  if (hit && deps.every((dep, i) => dep === hit.deps[i])) {
    return hit.output;
  }

  const output = buildSidebarTree(
    state.localActivity,
    state.globalReviews,
    state.globalReviewsByKey,
    state.sidebarDismissed,
    minute * 60_000,
    openRepoPath,
    terminalKeys,
    viewerPrs,
  );

  cache.set(cacheKey, { deps, output });
  return output;
}
