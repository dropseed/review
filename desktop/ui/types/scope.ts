// A review scope is a named, exact hunk-ID set — the selection axis behind
// the Review tab's groupings (a commit, the "Uncommitted changes" bucket, or
// a guide group), the walk bar, and the provenance-tag click-to-scope
// affordance in the diff viewer. It is the one way hunks get narrowed: an
// exact membership set that has no natural predicate of its own.

import { isHunkTrusted } from "./index";
import type { HunkState } from "./index";

export type ScopeSource = "commit" | "uncommitted" | "guide";

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

/**
 * Whether hunk-to-hunk navigation (next/prev/nextInFile) should step over a
 * hunk: either it's trusted with no explicit user action (existing
 * behavior), or — once a scope is active — it falls outside it.
 */
export function shouldSkipHunkForNavigation(args: {
  hunkId: string;
  hunkState: HunkState | undefined;
  trustList: string[];
  scope: ReviewScope | null;
}): boolean {
  const { hunkId, hunkState, trustList, scope } = args;
  if (scope && !hunkInScope(scope, hunkId)) return true;
  return !hunkState?.status && isHunkTrusted(hunkState, trustList);
}
