import type { ApiClient } from "../api";
import type { RepoMetadata } from "../stores/slices/tabRailSlice";
import { orgAvatarUrl, resolveRepoIdentity } from "./repo-identity";

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
      return {
        repoPath,
        routePrefix: identity.routePrefix,
        defaultBranch,
        avatarUrl: orgAvatarUrl(identity.browseUrl),
        browseUrl: identity.browseUrl,
      };
    }),
  );

  const merged = { ...existingMetadata };
  for (const result of results) {
    if (result.status === "fulfilled") {
      const { repoPath, ...metadata } = result.value;
      merged[repoPath] = metadata;
    }
  }
  return merged;
}
