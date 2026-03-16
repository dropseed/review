import type { ApiClient } from "../api";
import type { RepoMetadata } from "../stores/slices/tabRailSlice";
import { resolveRepoIdentity } from "./repo-identity";

/**
 * Resolve metadata (route prefix, default branch, avatar URL) for repos
 * not already present in the existing metadata map.
 * Returns the merged metadata map (existing + newly resolved).
 */
export async function resolveNewRepoMetadata(
  repoPaths: string[],
  existingMetadata: Record<string, RepoMetadata>,
  client: ApiClient,
): Promise<Record<string, RepoMetadata>> {
  const toResolve = repoPaths.filter((p) => !existingMetadata[p]);
  if (toResolve.length === 0) return existingMetadata;

  const results = await Promise.allSettled(
    toResolve.map(async (repoPath) => {
      const [identity, defaultBranch] = await Promise.all([
        resolveRepoIdentity(repoPath),
        client.getDefaultBranch(repoPath).catch(() => "main"),
      ]);
      let avatarUrl: string | null = null;
      if (identity.browseUrl) {
        try {
          const url = new URL(identity.browseUrl);
          const org = url.pathname.split("/")[1];
          if (org) avatarUrl = `${url.origin}/${org}.png?size=64`;
        } catch {
          // Invalid URL
        }
      }
      return {
        repoPath,
        routePrefix: identity.routePrefix,
        defaultBranch,
        avatarUrl,
      };
    }),
  );

  const merged = { ...existingMetadata };
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { repoPath, routePrefix, defaultBranch, avatarUrl } = result.value;
      merged[repoPath] = { routePrefix, defaultBranch, avatarUrl };
    }
  }
  return merged;
}
