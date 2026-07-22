// A review scope is a named, exact hunk-ID set carved out of one already-
// computed diff — the selection axis behind guide groups and the walk bar.
//
// Commits are NOT a scope: narrowing to a commit re-diffs rather than
// filtering, so it names a `base..head` instead (see ./commitRange). The
// `commit`/`uncommitted` sources below have no producer left; they remain in
// the union only because `Group.source` still spans them.

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
