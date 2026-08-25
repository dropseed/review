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
 * The ref back out of a key, or null when the key isn't that repo's. Needs the
 * repo path to split on: a path may itself contain `:`, so the separator can
 * only be found from the end that is already known.
 */
export function refFromReviewKey(key: string, repoPath: string): string | null {
  const prefix = `${repoPath}:`;
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}
