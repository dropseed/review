import { invoke } from "@tauri-apps/api/core";
import type { SliceCreator, GitStatusSummary } from "../types";

export interface GitSlice {
  // Git state
  gitStatus: GitStatusSummary | null;

  // Actions
  loadGitStatus: () => Promise<void>;
}

export const createGitSlice: SliceCreator<GitSlice> = (set, get) => ({
  gitStatus: null,

  loadGitStatus: async () => {
    const { repoPath } = get();
    if (!repoPath) return;

    try {
      const status = await invoke<GitStatusSummary>("get_git_status", {
        repoPath,
      });
      set({ gitStatus: status });
    } catch (err) {
      console.error("Failed to load git status:", err);
      set({ gitStatus: null });
    }
  },
});
