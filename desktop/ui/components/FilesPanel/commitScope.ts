// Helpers for building and reading the "commit" scope axis — a single
// commit, a contiguous range, or a non-contiguous cmd/ctrl-click set —
// shared by CommitScopePicker (writes it) and CommitScopeHeader (reads it
// back to render commit context). Membership is structured data
// (`ReviewScope.commitKeys`), not something consumers parse back out of
// `key`; `key` stays an opaque unique string for scope identity/toggling.

import type { CommitEntry, HunkAttribution } from "../../types";
import type { ReviewScope } from "../../types/scope";
import type { Group } from "../../stores/selectors/groups";

/** Whether `scope` scopes the queue to a commit, a range/set of commits, or the uncommitted bucket. */
export function isCommitScope(scope: ReviewScope | null): boolean {
  return scope?.source === "commit" || scope?.source === "uncommitted";
}

export function singleCommitScope(group: Group): ReviewScope {
  return {
    source: "commit",
    key: group.key,
    title: group.title,
    hunkIds: group.hunkIds,
    commitKeys: [group.key],
  };
}

/** `commits` must be the contiguous, oldest-first slice the range spans. */
export function commitRangeScope(
  commits: Group[],
  loOrdinal: number,
  hiOrdinal: number,
): ReviewScope {
  const hunkIds = Array.from(new Set(commits.flatMap((g) => g.hunkIds)));
  return {
    source: "commit",
    key: `range:${commits[0].key}..${commits[commits.length - 1].key}`,
    title: `Commits #${loOrdinal}–#${hiOrdinal}`,
    hunkIds,
    commitKeys: commits.map((g) => g.key),
  };
}

/**
 * A cmd/ctrl-click toggle set: possibly non-contiguous commits, in whatever
 * order `commits` is given (callers pass them in commit order for a stable
 * key). Use {@link singleCommitScope} instead once the set is down to one
 * commit — this always reads as "N commits" regardless of size.
 */
export function commitSetScope(commits: Group[]): ReviewScope {
  const commitKeys = commits.map((g) => g.key);
  const hunkIds = Array.from(new Set(commits.flatMap((g) => g.hunkIds)));
  return {
    source: "commit",
    key: `commits:${commitKeys.join(",")}`,
    title: `${commits.length} commits`,
    hunkIds,
    commitKeys,
  };
}

/** Commit-group keys included by a commit scope; empty for any other scope. */
export function scopeCommitKeys(scope: ReviewScope | null): Set<string> {
  if (!scope || scope.source !== "commit") return new Set();
  return new Set(scope.commitKeys ?? [scope.key]);
}

/** The CommitEntry[] a commit scope spans, oldest first — for the context header. */
export function commitsInScope(
  scope: ReviewScope | null,
  attribution: HunkAttribution | null,
): CommitEntry[] {
  if (!scope || !attribution || scope.source !== "commit") return [];
  const keys = scopeCommitKeys(scope);
  return attribution.commits.filter((c) => keys.has(c.hash));
}
