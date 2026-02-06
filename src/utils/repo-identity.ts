import { getApiClient } from "../api";

/**
 * Resolve the route prefix and display name for a repo.
 * Uses the git remote to get "owner/repo", falls back to "local/dirname".
 */
export async function resolveRepoIdentity(
  repoPath: string,
): Promise<{ routePrefix: string; repoName: string }> {
  try {
    const apiClient = getApiClient();
    const info = await apiClient.getRemoteInfo(repoPath);
    if (info?.name) {
      return { routePrefix: info.name, repoName: info.name };
    }
  } catch {
    // Fall through to local fallback
  }
  const dirname = repoPath.replace(/\/+$/, "").split("/").pop() || "repo";
  return { routePrefix: `local/${dirname}`, repoName: dirname };
}
