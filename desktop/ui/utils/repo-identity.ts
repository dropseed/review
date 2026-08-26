import { getApiClient } from "../api";

/**
 * Build the review route URL for a ref. The single place review URLs are
 * constructed. The ref is `encodeURIComponent`-encoded because refs (branch
 * names) contain "/", which must not split the `:ref` path segment.
 * `routePrefix` is "owner/repo" (or "local/dirname").
 */
export function reviewUrl(routePrefix: string, ref: string): string {
  return `/${routePrefix}/review/${encodeURIComponent(ref)}`;
}

/**
 * The org an unresolvable repo belongs to — the trailing group in the sidebar,
 * and the org half `splitRoutePrefix` invents for a `local/dirname` prefix.
 */
const LOCAL_ORG = "local";

/**
 * Split a route prefix ("owner/repo" or "local/dirname") into its org and repo
 * segments. Used by sidebar grouping and repo header display.
 */
export function splitRoutePrefix(routePrefix: string): {
  org: string;
  repo: string;
} {
  const slash = routePrefix.indexOf("/");
  if (slash <= 0) return { org: LOCAL_ORG, repo: routePrefix };
  return {
    org: routePrefix.slice(0, slash),
    repo: routePrefix.slice(slash + 1),
  };
}

/**
 * The org's avatar, from any URL on its forge: `https://host/org.png?size=64`.
 *
 * Derived from a URL rather than fetched, so a repo row and a PR in a repo that
 * was never cloned here land on the same image for the same org — a PR carries
 * its repo's browse URL and nothing else.
 */
export function orgAvatarUrl(
  browseUrl: string | null | undefined,
): string | null {
  if (!browseUrl) return null;
  try {
    const url = new URL(browseUrl);
    const org = url.pathname.split("/")[1];
    return org ? `${url.origin}/${org}.png?size=64` : null;
  } catch {
    return null;
  }
}

/**
 * The name to show for a repo: the `owner/repo` remote's repo half when the
 * metadata has resolved, else whatever git listing named it.
 *
 * One rule, so the repo row and a work card can't call the same repo two
 * things — they used to derive this separately from the same two inputs.
 */
export function repoDisplayName(
  routePrefix: string | undefined,
  fallback: string,
): string {
  return routePrefix
    ? splitRoutePrefix(routePrefix).repo || fallback
    : fallback;
}

/**
 * Resolve the route prefix, display name, and browse URL for a repo.
 * Uses the git remote to get "owner/repo", falls back to "local/dirname".
 */
export async function resolveRepoIdentity(repoPath: string): Promise<{
  routePrefix: string;
  repoName: string;
  browseUrl: string | null;
}> {
  try {
    const apiClient = getApiClient();
    const info = await apiClient.getRemoteInfo(repoPath);
    if (info?.name) {
      return {
        routePrefix: info.name,
        repoName: info.name,
        browseUrl: info.browseUrl ?? null,
      };
    }
  } catch {
    // Fall through to local fallback
  }
  const dirname = repoDirname(repoPath);
  return {
    routePrefix: `local/${dirname}`,
    repoName: dirname,
    browseUrl: null,
  };
}

/**
 * The last segment of a path, as a repo or folder would be named on a tab.
 *
 * The fallback whenever nothing has told us what this checkout is called —
 * a repo the backend has no identity for, and a folder just picked out of a
 * dialog, which by definition the app has never seen.
 */
export function repoDirname(path: string): string {
  return path.replace(/\/+$/, "").split("/").pop() || "repo";
}
