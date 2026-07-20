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
