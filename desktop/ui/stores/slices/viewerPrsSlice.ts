import type { ViewerPrSnapshot } from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";

/**
 * How long a refresh may take before the UI stops waiting on it.
 *
 * The backend has its own subprocess timeouts; this is the backstop for the
 * case they can't cover — an invoke that never settles at all. Without it the
 * in-flight guard below never clears and the sidebar's PRs freeze for the life
 * of the window, which is a worse failure than a slow fetch.
 */
const REFRESH_DEADLINE_MS = 60_000;

function withDeadline<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(
            `Timed out after ${Math.round(REFRESH_DEADLINE_MS / 1000)}s`,
          ),
        ),
      REFRESH_DEADLINE_MS,
    );
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

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
export const createViewerPrsSlice: SliceCreatorWithClient<ViewerPrsSlice> = (
  client: ApiClient,
) => {
  /**
   * Ordering token. Every read takes a number and the store only accepts a
   * result at least as new as the last one it accepted, so a refresh that comes
   * back after the deadline gave up — or after a later refresh already
   * landed — can't overwrite fresher PRs with its stale ones.
   */
  let nextToken = 0;
  let appliedToken = -1;

  return (set, get) => {
    const apply = (token: number, snapshot: ViewerPrSnapshot): void => {
      if (token < appliedToken) return;
      appliedToken = token;
      set({ viewerPrs: snapshot });
    };

    return {
      viewerPrs: null,
      viewerPrsRefreshing: false,

      loadViewerPrs: async () => {
        const token = nextToken++;
        try {
          apply(token, await client.getViewerPrs(false));
        } catch (err) {
          // The cache read failing is a local problem (no backend, bad JSON),
          // not a GitHub one, so there is no snapshot to attach it to.
          console.error("Failed to read cached viewer PRs:", err);
        }
      },

      refreshViewerPrs: async () => {
        if (get().viewerPrsRefreshing) return;
        const token = nextToken++;
        set({ viewerPrsRefreshing: true });
        try {
          apply(token, await withDeadline(client.getViewerPrs(true)));
        } catch (err) {
          console.error("Failed to refresh viewer PRs:", err);
          // The command itself failed, so no snapshot came back to carry the
          // error. Keep the PRs we have and mark them errored by hand, so the
          // sidebar still shows the indicator rather than silently going stale.
          const previous = get().viewerPrs;
          apply(token, {
            fetchedAt: previous?.fetchedAt ?? new Date(0).toISOString(),
            prs: previous?.prs ?? [],
            truncated: previous?.truncated ?? false,
            error: err instanceof Error ? err.message : String(err),
            // Nothing here says GitHub tooling is absent — the call never got
            // far enough to find out — so keep the last answer, or assume the
            // feature exists and let the warning speak.
            available: previous?.available ?? true,
          });
        } finally {
          set({ viewerPrsRefreshing: false });
        }
      },
    };
  };
};
