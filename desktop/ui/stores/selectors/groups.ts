// Pure reductions of "all hunks" into the Review tab's queue grouping. Commit
// grouping used to live here too; narrowing to a commit now re-diffs instead
// of filtering an existing diff (see ../../types/commitRange), so the guide is
// the only grouping left. Scoping to a group (see ../../types/scope) is a
// separate step layered on top by the consumers.

import { effectiveHunkStatus } from "../../types";
import type { DiffHunk, HunkGroup, ReviewState } from "../../types";
import type { ScopeSource } from "../../types/scope";

export interface Group {
  key: string;
  source: ScopeSource;
  title: string;
  /** Secondary expandable info (commit body, guide description). */
  context?: string;
  hunkIds: string[];
  /** Muted styling for synthetic/catch-all groups ("Other changes"). */
  isPlaceholder?: boolean;
}

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
 * of complete forever. Cached on (reviewGroups, hunks) identity.
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
