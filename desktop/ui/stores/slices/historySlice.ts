import type { ApiClient } from "../../api";
import type { HunkAttribution } from "../../types";
import type { SliceCreatorWithClient } from "../types";

export interface HistorySlice {
  attribution: HunkAttribution | null;
  attributionLoading: boolean;
  attributionLoaded: boolean;

  loadAttribution: (
    repoPath: string,
    base: string,
    head: string,
  ) => Promise<void>;
}

export const createHistorySlice: SliceCreatorWithClient<HistorySlice> =
  (client: ApiClient) => (set, get) => ({
    attribution: null,
    attributionLoading: false,
    attributionLoaded: false,

    loadAttribution: async (repoPath: string, base: string, head: string) => {
      const comparisonKey = get().comparison?.key;
      // Discard a stale response: if the repo/comparison changed while
      // this request was in flight, don't clobber the new one's state
      // (same race fixed for loadGitStatus/loadRemoteInfo/loadGitUser).
      const isStale = () =>
        get().repoPath !== repoPath || get().comparison?.key !== comparisonKey;
      set({ attributionLoading: true });
      try {
        const attribution = await client.getHunkAttribution(
          repoPath,
          base,
          head,
        );
        if (isStale()) return;
        set({
          attribution,
          attributionLoading: false,
          attributionLoaded: true,
        });
      } catch (err) {
        console.error("Failed to load hunk attribution:", err);
        if (isStale()) return;
        set({ attributionLoading: false, attributionLoaded: true });
      }
    },
  });
