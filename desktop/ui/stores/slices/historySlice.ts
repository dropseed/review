import type { ApiClient } from "../../api";
import type { CommitEntry } from "../../types";
import type { SliceCreatorWithClient } from "../types";

export interface HistorySlice {
  commits: CommitEntry[];
  historyLoading: boolean;
  commitsLoaded: boolean;

  loadCommits: (repoPath: string, range?: string) => Promise<void>;
  refreshCommits: (repoPath: string, range?: string) => Promise<void>;
}

export const createHistorySlice: SliceCreatorWithClient<HistorySlice> =
  (client: ApiClient) => (set) => ({
    commits: [],
    historyLoading: false,
    commitsLoaded: false,

    loadCommits: async (repoPath: string, range?: string) => {
      set({ historyLoading: true });
      try {
        const commits = await client.listCommits(
          repoPath,
          undefined,
          undefined,
          range,
        );
        set({ commits, historyLoading: false, commitsLoaded: true });
      } catch (err) {
        console.error("Failed to load commits:", err);
        set({ historyLoading: false, commitsLoaded: true });
      }
    },

    refreshCommits: async (repoPath: string, range?: string) => {
      try {
        const commits = await client.listCommits(
          repoPath,
          undefined,
          undefined,
          range,
        );
        set({ commits, commitsLoaded: true });
      } catch (err) {
        console.error("Failed to refresh commits:", err);
      }
    },
  });
