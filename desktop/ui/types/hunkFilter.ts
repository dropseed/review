// A composable predicate over the hunk axes — the UI counterpart to the
// `review hunks --status/--risk/--label/--file` filters. The data model gives
// each hunk independent attributes on three axes (classification, status,
// risk); this is the shared "select hunks by a predicate" primitive that both
// the filter toggles and the bulk actions sit on, so neither has to special-
// case an individual axis.
//
// Selection by a named hunk *set* (a commit, a status bucket, a guide group —
// anything with no natural predicate) is a separate, orthogonal concern; see
// `./scope`, which composes with these predicates rather than folding into
// them.

import { effectiveHunkStatus } from "./index";
import type { EffectiveStatusValue, HunkRisk, HunkState } from "./index";
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
  /** Glob over the hunk's file path, e.g. "src/*.ts". */
  file?: string;
}

// True when the filter imposes no constraints (everything matches).
export function isEmptyFilter(filter: HunkFilter): boolean {
  return !filter.status?.length && !filter.risk?.length && !filter.file;
}

export function hunkMatchesFilter(args: {
  hunkState: HunkState | undefined;
  filePath: string;
  trustList: string[];
  filter: HunkFilter;
}): boolean {
  const { hunkState, filePath, trustList, filter } = args;

  if (filter.status?.length) {
    if (!filter.status.includes(effectiveHunkStatus(hunkState, trustList))) {
      return false;
    }
  }
  if (filter.risk?.length) {
    const risk = hunkState?.risk?.value;
    if (!risk || !filter.risk.includes(risk)) return false;
  }
  if (filter.file) {
    if (!matchesPathGlob(filePath, filter.file)) return false;
  }
  return true;
}

// Make a risk-typed helper available for callers that only care about risk.
export type { HunkRisk };
