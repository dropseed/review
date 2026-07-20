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
 * Split a route prefix ("owner/repo" or "local/dirname") into its org and repo
 * segments. Used by sidebar grouping and repo header display.
 */
export function splitRoutePrefix(routePrefix: string): {
  org: string;
  repo: string;
} {
  const slash = routePrefix.indexOf("/");
  if (slash <= 0) return { org: "local", repo: routePrefix };
  return {
    org: routePrefix.slice(0, slash),
    repo: routePrefix.slice(slash + 1),
  };
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
  const dirname = repoPath.replace(/\/+$/, "").split("/").pop() || "repo";
  return {
    routePrefix: `local/${dirname}`,
    repoName: dirname,
    browseUrl: null,
  };
}
