// A composable predicate over the hunk axes — the UI counterpart to the
// `review hunks --status/--risk/--label/--file` filters. The data model gives
// each hunk independent attributes on three axes (classification, status,
// risk); this is the shared "select hunks by a predicate" primitive that both
// the filter toggles and the bulk actions sit on, so neither has to special-
// case an individual axis.

import { anyLabelMatchesPattern, effectiveHunkStatus } from "./index";
import type {
  DiffHunk,
  EffectiveStatusValue,
  HunkRisk,
  HunkState,
  ReviewState,
} from "./index";
import { matchesPathGlob } from "../utils/glob";

// `effectiveHunkStatus` / `EffectiveStatusValue` live in `index` (the canonical
// status home); re-exported here so filter consumers can import them alongside
// the predicate.
export { effectiveHunkStatus };
export type { EffectiveStatusValue };

// A predicate over the three hunk axes plus file path. An absent axis means "no
// constraint"; the axes that are present AND together, and the values within an
// axis OR together (e.g. `risk: ["low", "high"]` matches either).
export interface HunkFilter {
  status?: EffectiveStatusValue[];
  risk?: HunkRisk[];
  /** Glob over classification labels, e.g. "imports:*". */
  label?: string;
  /** Glob over the hunk's file path, e.g. "src/*.ts". */
  file?: string;
  /**
   * Full commit SHAs — matches hunks the commit-attribution map credits to
   * any of them. Also accepts the {@link UNCOMMITTED_COMMIT} sentinel, which
   * matches hunks with no attribution at all (empty/missing shas).
   */
  commits?: string[];
}

/** Sentinel `filter.commits` entry standing in for "not yet part of any commit". */
export const UNCOMMITTED_COMMIT = "uncommitted";

// True when the filter imposes no constraints (everything matches).
export function isEmptyFilter(filter: HunkFilter): boolean {
  return (
    !filter.status?.length &&
    !filter.risk?.length &&
    !filter.label &&
    !filter.file &&
    !filter.commits?.length
  );
}

export function hunkMatchesFilter(args: {
  hunkId?: string;
  hunkState: HunkState | undefined;
  filePath: string;
  trustList: string[];
  filter: HunkFilter;
  /** Hunk id -> attributed commit SHAs, needed only when `filter.commits` is set. */
  hunkCommits?: Record<string, string[]>;
}): boolean {
  const { hunkId, hunkState, filePath, trustList, filter, hunkCommits } = args;

  if (filter.status?.length) {
    if (!filter.status.includes(effectiveHunkStatus(hunkState, trustList))) {
      return false;
    }
  }
  if (filter.risk?.length) {
    const risk = hunkState?.risk?.value;
    if (!risk || !filter.risk.includes(risk)) return false;
  }
  if (filter.label) {
    if (
      !anyLabelMatchesPattern(
        hunkState?.classification?.value ?? [],
        filter.label,
      )
    ) {
      return false;
    }
  }
  if (filter.file) {
    if (!matchesPathGlob(filePath, filter.file)) return false;
  }
  if (filter.commits?.length) {
    const shas = hunkId ? hunkCommits?.[hunkId] : undefined;
    const matchesUncommitted =
      filter.commits.includes(UNCOMMITTED_COMMIT) && !shas?.length;
    const matchesSha = shas?.some((sha) => filter.commits!.includes(sha));
    if (!matchesUncommitted && !matchesSha) return false;
  }
  return true;
}

// Select the IDs of every hunk matching a filter, in input order. The single
// entry point bulk actions use: "act on the current filter" = approve/reject/
// save over `selectHunkIds(hunks, reviewState, filter)`.
export function selectHunkIds(
  hunks: DiffHunk[],
  reviewState: ReviewState | null,
  filter: HunkFilter,
  hunkCommits?: Record<string, string[]>,
): string[] {
  const trustList = reviewState?.trustList ?? [];
  return hunks
    .filter((h) =>
      hunkMatchesFilter({
        hunkId: h.id,
        hunkState: reviewState?.hunks[h.id],
        filePath: h.filePath,
        trustList,
        filter,
        hunkCommits,
      }),
    )
    .map((h) => h.id);
}

// Make a risk-typed helper available for callers that only care about risk.
export type { HunkRisk };
