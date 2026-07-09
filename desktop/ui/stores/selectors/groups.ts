// Pure reductions of "all hunks" into the Review tab's queue groupings. Each
// grouping (status / commits / guide) produces the same `Group[]` shape so
// the walk bar and the group-list components consume one contract regardless
// of which grouping is active. Scoping to a group (see ../../types/scope)
// is a separate step layered on top by the consumers.

import { effectiveHunkStatus } from "../../types";
import type {
  CommitEntry,
  DiffHunk,
  HunkAttribution,
  HunkGroup,
  ReviewState,
} from "../../types";
import type { ScopeSource } from "../../types/scope";
import { getHunkIdsByStatus } from "./hunks";

export interface Group {
  key: string;
  source: ScopeSource;
  title: string;
  /** Secondary expandable info (commit body, guide description). */
  context?: string;
  hunkIds: string[];
  /** Muted styling for synthetic/catch-all groups ("Uncommitted", "Other changes"). */
  isPlaceholder?: boolean;
  /** The commit this group represents — commit-source groups only. */
  commit?: CommitEntry;
}

/** The scope key the "Uncommitted changes" commit-grouping bucket uses. */
export const UNCOMMITTED_GROUP_KEY = "uncommitted";

/** Count of hunks (by id) still unreviewed — the shared reduction behind
 * `countGroupUnreviewed` and anything that only has a raw hunk-id list (e.g.
 * a scope spanning several groups). */
export function countUnreviewed(
  hunkIds: string[],
  reviewState: ReviewState | null,
): number {
  const trustList = reviewState?.trustList ?? [];
  let n = 0;
  for (const id of hunkIds) {
    if (
      effectiveHunkStatus(reviewState?.hunks[id], trustList) === "unreviewed"
    ) {
      n++;
    }
  }
  return n;
}

/** Count of a group's hunks that are still unreviewed. */
export function countGroupUnreviewed(
  group: Group,
  reviewState: ReviewState | null,
): number {
  return countUnreviewed(group.hunkIds, reviewState);
}

/**
 * Status grouping: the four buckets by effective review status, in display
 * order (Trusted, Reviewed, Needs Review, Saved for Later).
 */
export function computeStatusGroups(
  hunks: DiffHunk[],
  reviewState: ReviewState | null,
): Group[] {
  const { trusted, reviewed, pending, savedForLater } = getHunkIdsByStatus(
    hunks,
    reviewState,
  );
  return [
    { key: "trusted", source: "status", title: "Trusted", hunkIds: trusted },
    { key: "reviewed", source: "status", title: "Reviewed", hunkIds: reviewed },
    {
      key: "unreviewed",
      source: "status",
      title: "Needs Review",
      hunkIds: pending,
    },
    {
      key: "saved",
      source: "status",
      title: "Saved for Later",
      hunkIds: savedForLater,
    },
  ];
}

let commitGroupsCache: {
  hunks: DiffHunk[];
  attribution: HunkAttribution | null;
  output: Group[];
} | null = null;

/**
 * Commit grouping: one group per attribution commit, oldest first, plus a
 * trailing "Uncommitted changes" group for anything attribution couldn't
 * place. Cached on (hunks, attribution) identity so the walk bar, the
 * Commits group list, and the provenance-tag click handler — all mounted
 * together — share one computation.
 */
export function computeCommitGroups(
  hunks: DiffHunk[],
  attribution: HunkAttribution | null,
): Group[] {
  if (
    commitGroupsCache &&
    commitGroupsCache.hunks === hunks &&
    commitGroupsCache.attribution === attribution
  ) {
    return commitGroupsCache.output;
  }
  if (!attribution) {
    commitGroupsCache = { hunks, attribution, output: [] };
    return [];
  }
  const byCommit = new Map<string, string[]>();
  for (const c of attribution.commits) byCommit.set(c.hash, []);
  const uncommitted: string[] = [];
  for (const hunk of hunks) {
    const shas = attribution.hunkCommits[hunk.id];
    if (!shas || shas.length === 0) {
      uncommitted.push(hunk.id);
      continue;
    }
    for (const sha of shas) byCommit.get(sha)?.push(hunk.id);
  }
  const result: Group[] = attribution.commits.map((c) => ({
    key: c.hash,
    source: "commit",
    title: c.message,
    context: c.body,
    hunkIds: byCommit.get(c.hash) ?? [],
    commit: c,
  }));
  if (uncommitted.length > 0) {
    result.push({
      key: UNCOMMITTED_GROUP_KEY,
      source: "uncommitted",
      title: "Uncommitted changes",
      hunkIds: uncommitted,
      isPlaceholder: true,
    });
  }
  commitGroupsCache = { hunks, attribution, output: result };
  return result;
}

let guideGroupsCache: {
  reviewGroups: HunkGroup[];
  hunks: DiffHunk[];
  output: Group[];
} | null = null;

/**
 * Guide grouping: the reconciled guide groups from the active grouping
 * entry, with each group's hunkIds filtered down to hunks that still exist
 * in the loaded diff — a subset of a group's hunks can vanish out from
 * under it (amend/rebase) without the guide itself being reconciled, and an
 * unfiltered phantom id would otherwise strand that group's progress short
 * of complete forever. Cached on (reviewGroups, hunks) identity — see
 * {@link computeCommitGroups}.
 */
export function computeGuideGroups(
  reviewGroups: HunkGroup[],
  hunks: DiffHunk[],
): Group[] {
  if (
    guideGroupsCache &&
    guideGroupsCache.reviewGroups === reviewGroups &&
    guideGroupsCache.hunks === hunks
  ) {
    return guideGroupsCache.output;
  }
  const liveIds = new Set(hunks.map((h) => h.id));
  const output = reviewGroups.map((g) => ({
    key: g.title,
    source: "guide" as const,
    title: g.title,
    context: g.description,
    hunkIds: g.hunkIds.filter((id) => liveIds.has(id)),
    isPlaceholder: g.ungrouped,
  }));
  guideGroupsCache = { reviewGroups, hunks, output };
  return output;
}
