import type { ApiClient } from "../../api";
import type { GitStatusSummary, RemoteInfo } from "../../types";
import type { SliceCreatorWithClient } from "../types";

/** Singleton empty set -- preserves reference equality to avoid spurious re-renders. */
export const EMPTY_STAGED_SET = new Set<string>();

export interface GitSlice {
  // Git state
  gitStatus: GitStatusSummary | null;
  stagedFilePaths: Set<string>;
  remoteInfo: RemoteInfo | null;

  // Actions
  loadGitStatus: () => Promise<void>;
  loadRemoteInfo: () => Promise<void>;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  stageAll: () => Promise<void>;
  unstageAll: () => Promise<void>;
  stageHunks: (filePath: string, contentHashes: string[]) => Promise<void>;
  unstageHunks: (filePath: string, contentHashes: string[]) => Promise<void>;
}

export const createGitSlice: SliceCreatorWithClient<GitSlice> =
  (client: ApiClient) => (set, get) => ({
    gitStatus: null,
    stagedFilePaths: EMPTY_STAGED_SET,
    remoteInfo: null,

    loadGitStatus: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      try {
        const status = await client.getGitStatus(repoPath);
        const staged = new Set<string>(status.staged.map((e) => e.path));
        set({ gitStatus: status, stagedFilePaths: staged });
      } catch (err) {
        console.error("Failed to load git status:", err);
        set({ gitStatus: null, stagedFilePaths: EMPTY_STAGED_SET });
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

    stageFile: async (path: string) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.stageFile(repoPath, path);
      await get().loadGitStatus();
    },

    unstageFile: async (path: string) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.unstageFile(repoPath, path);
      await get().loadGitStatus();
    },

    stageAll: async () => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.stageAll(repoPath);
      await get().loadGitStatus();
    },

    unstageAll: async () => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.unstageAll(repoPath);
      await get().loadGitStatus();
    },

    stageHunks: async (filePath: string, contentHashes: string[]) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.stageHunks(repoPath, filePath, contentHashes);
      await get().loadGitStatus();
    },

    unstageHunks: async (filePath: string, contentHashes: string[]) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.unstageHunks(repoPath, filePath, contentHashes);
      await get().loadGitStatus();
    },
  });
