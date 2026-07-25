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
  /**
   * Drop memoized attributions for a repo (or all of them, with no argument).
   * Called when the diff moves under us — the live view keeps what it has, but
   * the next review that asks re-derives.
   */
  invalidateAttribution: (repoPath?: string) => void;
}

/**
 * Attribution is memoized here rather than in the store, which resets per
 * review: blaming every changed file costs seconds, and ping-ponging between
 * two tabs shouldn't re-pay it. Entries are dropped wholesale whenever the
 * watcher sees the working tree or git state move, so a cached entry never
 * outlives the diff it describes.
 */
const CACHE_LIMIT = 8;
const attributionCache = new Map<string, HunkAttribution>();

const cacheKey = (repoPath: string, base: string, head: string): string =>
  `${repoPath} ${base} ${head}`;

export const createHistorySlice: SliceCreatorWithClient<HistorySlice> =
  (client: ApiClient) => (set, get) => ({
    attribution: null,
    attributionLoading: false,
    attributionLoaded: false,

    loadAttribution: async (repoPath: string, base: string, head: string) => {
      const key = cacheKey(repoPath, base, head);
      const cached = attributionCache.get(key);
      if (cached) {
        set({
          attribution: cached,
          attributionLoading: false,
          attributionLoaded: true,
        });
        return;
      }

      const comparisonKey = get().comparison?.key;
      // Discard a stale response: if the repo/comparison changed while
      // this request was in flight, don't clobber the new one's state
      // (same race fixed for loadGitStatus/loadRemoteInfo/loadGitUser).
      const isStale = () =>
        get().repoPath !== repoPath || get().comparison?.key !== comparisonKey;
      set({ attributionLoading: true });
      try {
        // Concurrent callers share one request via the API client's coalescer.
        const attribution = await client.getHunkAttribution(
          repoPath,
          base,
          head,
        );

        attributionCache.set(key, attribution);
        if (attributionCache.size > CACHE_LIMIT) {
          const oldest = attributionCache.keys().next().value;
          if (oldest !== undefined) attributionCache.delete(oldest);
        }

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

    invalidateAttribution: (repoPath?: string) => {
      if (repoPath === undefined) {
        attributionCache.clear();
        return;
      }
      // Scoped to the repo whose diff moved — a working-tree edit in one repo
      // says nothing about the reviews open against another.
      for (const key of attributionCache.keys()) {
        if (key.startsWith(`${repoPath} `)) attributionCache.delete(key);
      }
    },
  });
