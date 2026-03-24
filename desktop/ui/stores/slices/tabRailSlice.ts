import type {
  Comparison,
  DiffShortStat,
  GitHubPrRef,
  GlobalReviewSummary,
  ReviewFreshnessInput,
} from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import { resolveNewRepoMetadata } from "../../utils/resolve-repo-metadata";
import { makeReviewKey } from "./groupingSlice";
import { findFirstUnreviewedHunkId } from "./navigationSlice";

/** Snapshot of navigation state saved when switching away from a review. */
export interface NavigationSnapshot {
  selectedFile: string | null;
}

/** A diff is considered active when it has any changed files, additions, or deletions. */
function isDiffActive(stat: DiffShortStat): boolean {
  return stat.fileCount > 0 || stat.additions > 0 || stat.deletions > 0;
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
  globalReviewsByKey: Record<string, GlobalReviewSummary>;
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
  changeReviewBase: (
    repoPath: string,
    oldComparison: Comparison,
    newBase: string,
  ) => Promise<Comparison | null>;
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
  globalReviewsByKey: {},
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
      const uniqueRepoPaths = [...new Set(reviews.map((r) => r.repoPath))];
      const newMetadata = await resolveNewRepoMetadata(
        uniqueRepoPaths,
        get().repoMetadata,
        client,
      );

      // Build diff stats and active state from inline data
      const newStats: Record<string, DiffShortStat> = {};
      const activeState: Record<string, boolean> = {};
      for (const review of reviews) {
        if (review.diffStats) {
          const key = makeReviewKey(review.repoPath, review.comparison.key);
          newStats[key] = review.diffStats;
          activeState[key] = isDiffActive(review.diffStats);
        }
      }

      // Build indexed map for O(1) lookup by key
      const reviewsByKey: Record<string, GlobalReviewSummary> = {};
      for (const review of reviews) {
        const key = makeReviewKey(review.repoPath, review.comparison.key);
        reviewsByKey[key] = review;
      }

      set({
        globalReviews: reviews,
        globalReviewsByKey: reviewsByKey,
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
      const key = makeReviewKey(repoPath, comparison.key);
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

  changeReviewBase: async (repoPath, oldComparison, newBase) => {
    try {
      // Ensure the review file exists (for local branches that haven't been opened yet)
      await client.ensureReviewExists(repoPath, oldComparison);

      const newComparison = await client.changeReviewBase(
        repoPath,
        oldComparison,
        newBase,
      );

      const oldKey = makeReviewKey(repoPath, oldComparison.key);
      const newKey = makeReviewKey(repoPath, newComparison.key);

      // Migrate grouping entry
      get().migrateGroupingEntry(oldKey, newKey);

      // Migrate navigation snapshot
      const snapshots = { ...get().navigationSnapshots };
      if (snapshots[oldKey]) {
        snapshots[newKey] = snapshots[oldKey];
        delete snapshots[oldKey];
      }
      set({ navigationSnapshots: snapshots });

      // Update active review key if this was the active review
      const { activeReviewKey } = get();
      if (
        activeReviewKey?.repoPath === repoPath &&
        activeReviewKey?.comparisonKey === oldComparison.key
      ) {
        set({
          activeReviewKey: {
            repoPath,
            comparisonKey: newComparison.key,
          },
        });
      }

      // Refresh sidebar
      await get().loadGlobalReviews();

      return newComparison;
    } catch (err) {
      console.error("Failed to change review base:", err);
      return null;
    }
  },

  saveNavigationSnapshot: () => {
    const { repoPath, comparison, selectedFile } = get();
    if (!repoPath || !comparison) return;
    const key = makeReviewKey(repoPath, comparison.key);
    set({
      navigationSnapshots: {
        ...get().navigationSnapshots,
        [key]: { selectedFile },
      },
    });
  },

  restoreNavigationSnapshot: () => {
    const state = get();
    const { repoPath, comparison, flatFileList } = state;
    if (!repoPath || !comparison) return;
    const key = makeReviewKey(repoPath, comparison.key);
    const snapshot = state.navigationSnapshots[key];
    if (!snapshot) return;

    // Restore selectedFile only if it still exists in the current file list
    if (snapshot.selectedFile && flatFileList.includes(snapshot.selectedFile)) {
      const hunkId = findFirstUnreviewedHunkId(snapshot.selectedFile, state);
      set({
        selectedFile: snapshot.selectedFile,
        guideContentMode: null,
        focusedHunkId: hunkId,
        scrollTarget: hunkId ? { type: "hunk", hunkId } : null,
      });
    }
  },

  checkReviewsFreshness: async () => {
    const { globalReviews, reviewCachedShas } = get();
    if (globalReviews.length === 0) return;

    const inputs: ReviewFreshnessInput[] = globalReviews.map((review) => {
      const key = makeReviewKey(review.repoPath, review.comparison.key);
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
