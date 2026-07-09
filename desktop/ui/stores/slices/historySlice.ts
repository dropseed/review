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
  (client: ApiClient) => (set) => ({
    attribution: null,
    attributionLoading: false,
    attributionLoaded: false,

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
