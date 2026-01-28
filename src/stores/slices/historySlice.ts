import type { ApiClient } from "../../api";
import type { CommitEntry } from "../../types";
import type { SliceCreatorWithClient } from "../types";

export interface HistorySlice {
  commits: CommitEntry[];
  historyLoading: boolean;

  loadCommits: (repoPath: string, limit?: number) => Promise<void>;
}

export const createHistorySlice: SliceCreatorWithClient<HistorySlice> =
  (client: ApiClient) => (set) => ({
    commits: [],
    historyLoading: false,

    loadCommits: async (repoPath: string, limit?: number) => {
      set({ historyLoading: true });
      try {
        const commits = await client.listCommits(repoPath, limit);
        set({ commits, historyLoading: false });
      } catch (err) {
        console.error("Failed to load commits:", err);
        set({ historyLoading: false });
      }
    },
  });
