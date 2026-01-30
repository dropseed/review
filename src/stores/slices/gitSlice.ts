import type { ApiClient, RemoteInfo } from "../../api";
import type { SliceCreatorWithClient, GitStatusSummary } from "../types";

export interface GitSlice {
  // Git state
  gitStatus: GitStatusSummary | null;
  stagedFilePaths: Set<string>;
  remoteInfo: RemoteInfo | null;

  // Actions
  loadGitStatus: () => Promise<void>;
  loadRemoteInfo: () => Promise<void>;
}

export const createGitSlice: SliceCreatorWithClient<GitSlice> =
  (client: ApiClient) => (set, get) => ({
    gitStatus: null,
    stagedFilePaths: new Set<string>(),
    remoteInfo: null,

    loadGitStatus: async () => {
      const { repoPath, stagedFilePaths: currentStaged } = get();
      if (!repoPath) return;

      try {
        const status = await client.getGitStatus(repoPath);
        const newStagedPaths = status.staged.map((e) => e.path);
        // Skip update if staged paths haven't changed
        if (
          currentStaged.size === newStagedPaths.length &&
          newStagedPaths.every((p) => currentStaged.has(p))
        ) {
          return;
        }
        const staged = new Set<string>(newStagedPaths);
        set({ gitStatus: status, stagedFilePaths: staged });
      } catch (err) {
        console.error("Failed to load git status:", err);
        set({ gitStatus: null, stagedFilePaths: new Set<string>() });
      }
    },

    loadRemoteInfo: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      try {
        const info = await client.getRemoteInfo(repoPath);
        set({ remoteInfo: info });
      } catch {
        set({ remoteInfo: null });
      }
    },
  });
