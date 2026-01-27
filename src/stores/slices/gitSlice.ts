import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient, GitStatusSummary } from "../types";

export interface GitSlice {
  // Git state
  gitStatus: GitStatusSummary | null;

  // Actions
  loadGitStatus: () => Promise<void>;
}

export const createGitSlice: SliceCreatorWithClient<GitSlice> =
  (client: ApiClient) => (set, get) => ({
    gitStatus: null,

    loadGitStatus: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      try {
        const status = await client.getGitStatus(repoPath);
        set({ gitStatus: status });
      } catch (err) {
        console.error("Failed to load git status:", err);
        set({ gitStatus: null });
      }
    },
  });
