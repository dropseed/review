import type {
  Comparison,
  DiffShortStat,
  GitHubPrRef,
  GlobalReviewSummary,
  ReviewFreshnessInput,
} from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import { resolveRepoIdentity } from "../../utils/repo-identity";

/** A diff is considered active when it has any changed files, additions, or deletions. */
function isDiffActive(stat: DiffShortStat): boolean {
  return stat.fileCount > 0 || stat.additions > 0 || stat.deletions > 0;
}

/** Build the composite key used to track per-review state (stats, freshness, etc.). */
function reviewKey(review: GlobalReviewSummary): string {
  return `${review.repoPath}:${review.comparison.key}`;
}

export interface ActiveReviewKey {
  repoPath: string;
  comparisonKey: string;
}

export interface RepoMetadata {
  routePrefix: string;
  defaultBranch: string;
  avatarUrl: string | null;
}

export interface GlobalReviewsSlice {
  globalReviews: GlobalReviewSummary[];
  globalReviewsLoading: boolean;
  activeReviewKey: ActiveReviewKey | null;
  repoMetadata: Record<string, RepoMetadata>;
  reviewDiffStats: Record<string, DiffShortStat>;
  reviewActiveState: Record<string, boolean>;
  reviewCachedShas: Record<
    string,
    { oldSha: string | null; newSha: string | null }
  >;

  loadGlobalReviews: () => Promise<void>;
  setActiveReviewKey: (key: ActiveReviewKey | null) => void;
  ensureReviewExists: (
    repoPath: string,
    comparison: Comparison,
    githubPr?: GitHubPrRef,
  ) => Promise<void>;
  deleteGlobalReview: (
    repoPath: string,
    comparison: Comparison,
  ) => Promise<void>;
  checkReviewsFreshness: () => Promise<void>;
}

export const createGlobalReviewsSlice: SliceCreatorWithClient<
  GlobalReviewsSlice
> = (client: ApiClient) => (set, get) => ({
  globalReviews: [],
  globalReviewsLoading: false,
  activeReviewKey: null,
  repoMetadata: {},
  reviewDiffStats: {},
  reviewActiveState: {},
  reviewCachedShas: {},

  loadGlobalReviews: async () => {
    set({ globalReviewsLoading: true });
    try {
      const reviews = await client.listAllReviewsGlobal();
      // Sort by updatedAt descending
      reviews.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );

      // Resolve metadata for any new repos
      const { repoMetadata } = get();
      const uniqueRepoPaths = [...new Set(reviews.map((r) => r.repoPath))];
      const newMetadata = { ...repoMetadata };
      const toResolve = uniqueRepoPaths.filter((p) => !newMetadata[p]);

      if (toResolve.length > 0) {
        const results = await Promise.allSettled(
          toResolve.map(async (repoPath) => {
            const [identity, defaultBranch] = await Promise.all([
              resolveRepoIdentity(repoPath),
              client.getDefaultBranch(repoPath).catch(() => "main"),
            ]);
            // Derive org avatar from browse URL (e.g. https://github.com/org/repo → https://github.com/org.png)
            let avatarUrl: string | null = null;
            if (identity.browseUrl) {
              try {
                const url = new URL(identity.browseUrl);
                const org = url.pathname.split("/")[1];
                if (org) {
                  avatarUrl = `${url.origin}/${org}.png?size=64`;
                }
              } catch {
                // Invalid URL, skip avatar
              }
            }
            return {
              repoPath,
              routePrefix: identity.routePrefix,
              defaultBranch,
              avatarUrl,
            };
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled") {
            const { repoPath, routePrefix, defaultBranch, avatarUrl } =
              result.value;
            newMetadata[repoPath] = { routePrefix, defaultBranch, avatarUrl };
          }
        }
      }

      set({
        globalReviews: reviews,
        globalReviewsLoading: false,
        repoMetadata: newMetadata,
      });

      // Fetch diff stats in background (fire-and-forget, non-blocking)
      Promise.allSettled(
        reviews.map(async (review) => {
          const stat = await client.getDiffShortStat(
            review.repoPath,
            review.comparison,
          );
          return { key: reviewKey(review), stat };
        }),
      ).then((statsResults) => {
        const newStats: Record<string, DiffShortStat> = {};
        const activeState: Record<string, boolean> = {};
        for (const result of statsResults) {
          if (result.status === "fulfilled") {
            const { key, stat } = result.value;
            newStats[key] = stat;
            activeState[key] = isDiffActive(stat);
          }
        }
        set({ reviewDiffStats: newStats, reviewActiveState: activeState });
      });
    } catch (err) {
      console.error("Failed to load global reviews:", err);
      set({ globalReviewsLoading: false });
    }
  },

  setActiveReviewKey: (key) => {
    set({ activeReviewKey: key });
  },

  ensureReviewExists: async (repoPath, comparison, githubPr) => {
    try {
      await client.ensureReviewExists(repoPath, comparison, githubPr);
    } catch (err) {
      console.error("Failed to ensure review exists:", err);
    }
  },

  deleteGlobalReview: async (repoPath, comparison) => {
    try {
      await client.deleteReview(repoPath, comparison);
      // If the deleted review was active, clear the active key
      const { activeReviewKey } = get();
      if (
        activeReviewKey?.repoPath === repoPath &&
        activeReviewKey?.comparisonKey === comparison.key
      ) {
        set({ activeReviewKey: null });
      }
      // Refresh sidebar
      await get().loadGlobalReviews();
    } catch (err) {
      console.error("Failed to delete review:", err);
    }
  },

  checkReviewsFreshness: async () => {
    const { globalReviews, reviewCachedShas } = get();
    if (globalReviews.length === 0) return;

    const inputs: ReviewFreshnessInput[] = globalReviews.map((review) => {
      const key = reviewKey(review);
      const cached = reviewCachedShas[key];
      return {
        repoPath: review.repoPath,
        comparison: review.comparison,
        cachedOldSha: cached?.oldSha ?? null,
        cachedNewSha: cached?.newSha ?? null,
      };
    });

    try {
      const results = await client.checkReviewsFreshness(inputs);
      const newActiveState = { ...get().reviewActiveState };
      const newCachedShas = { ...get().reviewCachedShas };
      const newDiffStats = { ...get().reviewDiffStats };

      for (const result of results) {
        newActiveState[result.key] = result.isActive;
        if (result.oldSha !== null || result.newSha !== null) {
          newCachedShas[result.key] = {
            oldSha: result.oldSha,
            newSha: result.newSha,
          };
        }
        if (result.diffStats) {
          newDiffStats[result.key] = result.diffStats;
        }
      }

      set({
        reviewActiveState: newActiveState,
        reviewCachedShas: newCachedShas,
        reviewDiffStats: newDiffStats,
      });
    } catch (err) {
      console.error("Failed to check reviews freshness:", err);
    }
  },
});
