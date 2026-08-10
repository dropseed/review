import type { ViewerPrSnapshot } from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";

export interface ViewerPrsSlice {
  /**
   * The user's open PRs across every repo, as of the last fetch. Null until the
   * first read returns — which is *not* the same as "no open PRs", and the
   * sidebar has to be able to tell those apart.
   */
  viewerPrs: ViewerPrSnapshot | null;
  viewerPrsRefreshing: boolean;

  /** Read the disk cache. Never touches the network — the instant-paint path. */
  loadViewerPrs: () => Promise<void>;
  /** Ask GitHub. Slow (seconds); the snapshot it returns may carry an error. */
  refreshViewerPrs: () => Promise<void>;
}

/**
 * The viewer's open pull requests.
 *
 * One account-wide query, cached on disk by the backend, joined against
 * registered repos there. This slice only holds the last snapshot and offers
 * the two ways to get one — `useViewerPrsSync` owns when they run.
 *
 * A failed refresh is stored, not swallowed: the snapshot keeps the previous
 * PRs and adds an `error`, and the sidebar renders that difference. Dropping
 * the error would make "GitHub is unreachable" look exactly like "you have
 * nothing open", which is the one thing this feature must never do.
 */
export const createViewerPrsSlice: SliceCreatorWithClient<ViewerPrsSlice> =
  (client: ApiClient) => (set, get) => ({
    viewerPrs: null,
    viewerPrsRefreshing: false,

    loadViewerPrs: async () => {
      try {
        set({ viewerPrs: await client.getViewerPrs(false) });
      } catch (err) {
        // The cache read failing is a local problem (no backend, bad JSON), not
        // a GitHub one, so there is no snapshot to attach it to.
        console.error("Failed to read cached viewer PRs:", err);
      }
    },

    refreshViewerPrs: async () => {
      if (get().viewerPrsRefreshing) return;
      set({ viewerPrsRefreshing: true });
      try {
        set({ viewerPrs: await client.getViewerPrs(true) });
      } catch (err) {
        console.error("Failed to refresh viewer PRs:", err);
        // The command itself failed, so no snapshot came back to carry the
        // error. Keep the PRs we have and mark them errored by hand, so the
        // sidebar still shows the indicator rather than silently going stale.
        const previous = get().viewerPrs;
        set({
          viewerPrs: {
            fetchedAt: previous?.fetchedAt ?? new Date(0).toISOString(),
            prs: previous?.prs ?? [],
            truncated: previous?.truncated ?? false,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } finally {
        set({ viewerPrsRefreshing: false });
      }
    },
  });
