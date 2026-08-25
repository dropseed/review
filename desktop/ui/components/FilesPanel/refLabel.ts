/** A PR is fetched to `refs/review/pr/N`; nobody calls it that out loud. */
const PR_REF = /^refs\/review\/pr\/(\d+)$/;
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * A revision as the app says it: a PR by its number, a resolved commit by its
 * short hash, everything else by the ref it already is.
 *
 * Shared by the comparison bar and the tab strip's disabled-Git tooltip,
 * because the two are naming the same head and a tooltip reading "…isn't
 * checked out" about a forty-character sha is the bar's plumbing leaking out
 * beside the bar's own words for it.
 */
export function refLabel(ref: string): string {
  const pr = PR_REF.exec(ref);
  if (pr) return `#${pr[1]}`;
  return FULL_SHA.test(ref) ? ref.slice(0, 7) : ref;
}
