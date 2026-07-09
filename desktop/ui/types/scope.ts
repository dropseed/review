// A review scope is a named, exact hunk-ID set — the selection axis behind
// the Review tab's groupings (a status bucket, a commit, the "Uncommitted
// changes" bucket, or a guide group), the walk bar, and the provenance-tag
// click-to-scope affordance in the diff viewer. It composes with `HunkFilter`
// (the predicate axes in ./hunkFilter) rather than folding into it:
// predicates AND together, and scope further narrows the result to an exact
// membership that has no natural predicate of its own.

import { isHunkTrusted } from "./index";
import type { DiffHunk, HunkState, ReviewState } from "./index";
import {
  hunkMatchesFilter,
  isEmptyFilter,
  type HunkFilter,
} from "./hunkFilter";

export type ScopeSource = "status" | "commit" | "uncommitted" | "guide";

export interface ReviewScope {
  source: ScopeSource;
  /** Stable identity within `source` — a commit sha, a status key, a guide group title. */
  key: string;
  /** Human-readable name for the scope chip / walk bar. */
  title: string;
  /** Exact hunk-ID membership, computed when the scope was set. */
  hunkIds: string[];
  /**
   * Commit-group keys this scope spans — a single commit, a contiguous
   * range, or a non-contiguous cmd/ctrl-click set (see
   * ../components/FilesPanel/commitScope). Only set for `source: "commit"`.
   * Structured membership instead of parsing it back out of `key`.
   */
  commitKeys?: string[];
}

// Cached on `scope` reference identity so a navigation scan — which holds the
// same scope object across many hunks — builds the Set once, not once per
// hunk.
let scopeSetCache: { scope: ReviewScope; set: Set<string> } | null = null;
function scopeHunkIdSet(scope: ReviewScope): Set<string> {
  if (scopeSetCache?.scope === scope) return scopeSetCache.set;
  const set = new Set(scope.hunkIds);
  scopeSetCache = { scope, set };
  return set;
}

/**
 * Click-to-scope toggle: clear `current` if `next` is already the active
 * scope (same source + key), otherwise set `next`. Shared by every group
 * header's click handler so they agree on what "already scoped" means.
 */
export function toggleScope(
  current: ReviewScope | null,
  next: ReviewScope,
): ReviewScope | null {
  if (current?.source === next.source && current.key === next.key) {
    return null;
  }
  return next;
}

export function hunkInScope(
  scope: ReviewScope | null,
  hunkId: string,
): boolean {
  return scope === null || scopeHunkIdSet(scope).has(hunkId);
}

/** The combined predicate: matches the axis filter AND falls inside scope (if any). */
export function hunkMatches(args: {
  hunkId: string;
  hunkState: HunkState | undefined;
  filePath: string;
  trustList: string[];
  filter: HunkFilter;
  scope: ReviewScope | null;
}): boolean {
  const { hunkId, scope, ...predicateArgs } = args;
  return hunkMatchesFilter(predicateArgs) && hunkInScope(scope, hunkId);
}

// Select the IDs of every hunk matching the predicate filter and scope, in
// input order — the entry point bulk actions use: "act on the current
// filter/scope" = approve/reject/save over this.
export function selectHunkIds(
  hunks: DiffHunk[],
  reviewState: ReviewState | null,
  filter: HunkFilter,
  scope: ReviewScope | null = null,
): string[] {
  const trustList = reviewState?.trustList ?? [];
  return hunks
    .filter((h) =>
      hunkMatches({
        hunkId: h.id,
        hunkState: reviewState?.hunks[h.id],
        filePath: h.filePath,
        trustList,
        filter,
        scope,
      }),
    )
    .map((h) => h.id);
}

/**
 * Whether hunk-to-hunk navigation (next/prev/nextInFile) should step over a
 * hunk: either it's trusted with no explicit user action (existing
 * behavior), or — once a filter or scope is active — it falls outside it.
 *
 * The trusted auto-skip is suppressed for a hunk that's inside an active
 * *status* scope (e.g. the Trusted or Reviewed section itself): the bucket
 * IS the user's selection, so walking it must actually visit its members
 * instead of skipping every one of them for being trusted/reviewed.
 */
export function shouldSkipHunkForNavigation(args: {
  hunkId: string;
  filePath: string;
  hunkState: HunkState | undefined;
  trustList: string[];
  filter: HunkFilter;
  scope: ReviewScope | null;
}): boolean {
  const { hunkState, trustList, filter, scope } = args;
  if (isEmptyFilter(filter) && !scope) {
    return !hunkState?.status && isHunkTrusted(hunkState, trustList);
  }
  if (!hunkMatches(args)) return true;
  if (scope?.source === "status") return false;
  return !hunkState?.status && isHunkTrusted(hunkState, trustList);
}
