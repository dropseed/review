/**
 * Build a unique key for a review (repo + ref). Matches the backend's
 * freshness key `${repo_path}:${ref}`.
 *
 * Kept in a leaf module (no store/api imports) so pure helpers and their unit
 * tests can use it without pulling in the Zustand store graph.
 */
export function makeReviewKey(repoPath: string, ref: string): string {
  return `${repoPath}:${ref}`;
}

/**
 * Which review's per-tab session state is in play, or null when no repo is
 * open.
 *
 * Keyed by repo *and* ref — the two halves of an attachment — so state set in
 * one tab follows that tab rather than the repo as a whole. Both the Browse
 * ref pin and the commit peek are scoped this way, which is why the key is
 * built here rather than twice over.
 */
export function reviewScopeKey(state: {
  repoPath: string | null;
  reviewRef: string | null;
}): string | null {
  if (!state.repoPath) return null;
  return makeReviewKey(state.repoPath, state.reviewRef ?? "");
}

/**
 * The ref back out of a key, or null when the key isn't that repo's. Needs the
 * repo path to split on: a path may itself contain `:`, so the separator can
 * only be found from the end that is already known.
 */
export function refFromReviewKey(key: string, repoPath: string): string | null {
  const prefix = `${repoPath}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}
