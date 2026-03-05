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
import { makeReviewKey } from "./groupingSlice";
import {
  type ChangesViewMode,
  findFirstUnreviewedHunkId,
} from "./navigationSlice";

/** Snapshot of navigation state saved when switching away from a review. */
export interface NavigationSnapshot {
  selectedFile: string | null;
  changesViewMode: ChangesViewMode;
}

/** A diff is considered active when it has any changed files, additions, or deletions. */
function isDiffActive(stat: DiffShortStat): boolean {
  return stat.fileCount > 0 || stat.additions > 0 || stat.deletions > 0;
}

/** Build the composite key used to track per-review state (stats, freshness, etc.). */
function reviewKey(review: GlobalReviewSummary): string {
  return `${review.repoPath}:${review.comparison.key}`;
}

/** Build the composite key for per-review navigation snapshots. */
function snapshotKey(repoPath: string, comparisonKey: string): string {
  return `${repoPath}:${comparisonKey}`;
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
  /** Per-review missing refs (deleted branches). Empty array = all refs valid. */
  reviewMissingRefs: Record<string, string[]>;
  /** Per-review navigation snapshots for tab-like restore behavior. */
  navigationSnapshots: Record<string, NavigationSnapshot>;

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
  /** Save current navigation state before switching away from a review. */
  saveNavigationSnapshot: () => void;
  /** Restore navigation state when switching back to a review (after files load). */
  restoreNavigationSnapshot: () => void;
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
  reviewMissingRefs: {},
  navigationSnapshots: {},

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

      // Build diff stats and active state from inline data
      const newStats: Record<string, DiffShortStat> = {};
      const activeState: Record<string, boolean> = {};
      for (const review of reviews) {
        if (review.diffStats) {
          const key = reviewKey(review);
          newStats[key] = review.diffStats;
          activeState[key] = isDiffActive(review.diffStats);
        }
      }

      set({
        globalReviews: reviews,
        globalReviewsLoading: false,
        repoMetadata: newMetadata,
        reviewDiffStats: newStats,
        reviewActiveState: activeState,
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
      // Evict the keyed grouping entry for the deleted review
      get().removeGroupingEntry(makeReviewKey(repoPath, comparison.key));
      // Clean up navigation snapshot
      const key = snapshotKey(repoPath, comparison.key);
      const { [key]: _, ...rest } = get().navigationSnapshots;
      set({ navigationSnapshots: rest });
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

  saveNavigationSnapshot: () => {
    const { repoPath, comparison, selectedFile, changesViewMode } = get();
    if (!repoPath) return;
    const key = snapshotKey(repoPath, comparison.key);
    set({
      navigationSnapshots: {
        ...get().navigationSnapshots,
        [key]: { selectedFile, changesViewMode },
      },
    });
  },

  restoreNavigationSnapshot: () => {
    const state = get();
    const { repoPath, comparison, flatFileList } = state;
    if (!repoPath) return;
    const key = snapshotKey(repoPath, comparison.key);
    const snapshot = state.navigationSnapshots[key];
    if (!snapshot) return;

    // Restore selectedFile only if it still exists in the current file list
    if (snapshot.selectedFile && flatFileList.includes(snapshot.selectedFile)) {
      const hunkId = findFirstUnreviewedHunkId(snapshot.selectedFile, state);
      set({
        changesViewMode: snapshot.changesViewMode,
        selectedFile: snapshot.selectedFile,
        guideContentMode: null,
        focusedHunkId: hunkId,
        scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
      });
    } else {
      set({ changesViewMode: snapshot.changesViewMode });
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
      const newMissingRefs = { ...get().reviewMissingRefs };

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
        if (result.missingRefs && result.missingRefs.length > 0) {
          newMissingRefs[result.key] = result.missingRefs;
        } else {
          delete newMissingRefs[result.key];
        }
      }

      set({
        reviewActiveState: newActiveState,
        reviewCachedShas: newCachedShas,
        reviewDiffStats: newDiffStats,
        reviewMissingRefs: newMissingRefs,
      });
    } catch (err) {
      console.error("Failed to check reviews freshness:", err);
    }
  },
});
