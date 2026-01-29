import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient, GitStatusSummary } from "../types";

export interface GitSlice {
  // Git state
  gitStatus: GitStatusSummary | null;
  stagedFilePaths: Set<string>;

  // Actions
  loadGitStatus: () => Promise<void>;
}

export const createGitSlice: SliceCreatorWithClient<GitSlice> =
  (client: ApiClient) => (set, get) => ({
    gitStatus: null,
    stagedFilePaths: new Set<string>(),

    loadGitStatus: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      try {
        const status = await client.getGitStatus(repoPath);
        const staged = new Set<string>(status.staged.map((e) => e.path));
        set({ gitStatus: status, stagedFilePaths: staged });
      } catch (err) {
        console.error("Failed to load git status:", err);
        set({ gitStatus: null, stagedFilePaths: new Set<string>() });
      }
    },
  });
