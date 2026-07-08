import type { ApiClient } from "../../api";
import type { CommitEntry, HunkAttribution } from "../../types";
import type { SliceCreatorWithClient } from "../types";

export interface HistorySlice {
  commits: CommitEntry[];
  historyLoading: boolean;
  commitsLoaded: boolean;
  attribution: HunkAttribution | null;
  attributionLoading: boolean;
  attributionLoaded: boolean;

  loadCommits: (repoPath: string, range?: string) => Promise<void>;
  refreshCommits: (repoPath: string, range?: string) => Promise<void>;
  loadAttribution: (
    repoPath: string,
    base: string,
    head: string,
  ) => Promise<void>;
}

export const createHistorySlice: SliceCreatorWithClient<HistorySlice> =
  (client: ApiClient) => (set) => ({
    commits: [],
    historyLoading: false,
    commitsLoaded: false,
    attribution: null,
    attributionLoading: false,
    attributionLoaded: false,

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

    loadAttribution: async (repoPath: string, base: string, head: string) => {
      set({ attributionLoading: true });
      try {
        const attribution = await client.getHunkAttribution(
          repoPath,
          base,
          head,
        );
        set({
          attribution,
          attributionLoading: false,
          attributionLoaded: true,
        });
      } catch (err) {
        console.error("Failed to load hunk attribution:", err);
        set({ attributionLoading: false, attributionLoaded: true });
      }
    },
  });
