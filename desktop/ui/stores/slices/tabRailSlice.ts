import type {
  DiffShortStat,
  GitHubPrRef,
  GlobalReviewSummary,
  ResolvedReview,
  ReviewFreshnessInput,
} from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import { resolveNewRepoMetadata } from "../../utils/resolve-repo-metadata";
import { jsonEqual } from "../../utils/equality";
import { makeReviewKey } from "./groupingSlice";
import { findFirstUnreviewedHunkId } from "./navigationSlice";
import { forgetEnsuredReview } from "./reviewSlice";

/** Snapshot of navigation state saved when switching away from a review. */
export interface NavigationSnapshot {
  selectedFile: string | null;
}

export interface ActiveReviewKey {
  repoPath: string;
  ref: string;
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
    ref: string,
    baseOverride?: string,
    githubPr?: GitHubPrRef,
  ) => Promise<void>;
  deleteGlobalReview: (repoPath: string, ref: string) => Promise<void>;
  /**
   * Set (or clear, when null) a review's base override in place. Identity is
   * unchanged — no re-key. When the review is active, refreshes the store's
   * resolved comparison, which reloads the diff. Returns the re-resolved review.
   */
  setBaseOverride: (
    repoPath: string,
    ref: string,
    baseOverride: string | null,
  ) => Promise<ResolvedReview | null>;
  checkReviewsFreshness: () => Promise<void>;
  /** Save current navigation state before switching away from a review. */
  saveNavigationSnapshot: () => void;
  /** Restore navigation state when switching back to a review (after files load). */
  restoreNavigationSnapshot: () => void;
}

export const createGlobalReviewsSlice: SliceCreatorWithClient<
  GlobalReviewsSlice
> = (client: ApiClient) => {
  // De-dup overlapping freshness calls. Both the post-`loadGlobalReviews` kick
  // and the watcher-debounced trigger can fire at the same time; without this
  // we'd run two concurrent passes, each fanning N git subprocesses across
  // every saved review.
  let freshnessInFlight: Promise<void> | null = null;

  return (set, get) => ({
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

        // Skip state update if the review list is unchanged (avoids re-renders
        // of every sidebar subscriber on no-op refreshes from the watcher).
        const prev = get().globalReviews;
        if (prev.length === reviews.length && jsonEqual(prev, reviews)) {
          set({ globalReviewsLoading: false });
          get()
            .checkReviewsFreshness()
            .catch(() => {});
          return;
        }

        // Resolve metadata for any new repos
        const uniqueRepoPaths = [...new Set(reviews.map((r) => r.repoPath))];
        const newMetadata = await resolveNewRepoMetadata(
          uniqueRepoPaths,
          get().repoMetadata,
          client,
        );

        // Build indexed map for O(1) lookup by key
        const reviewsByKey: Record<string, GlobalReviewSummary> = {};
        for (const review of reviews) {
          const key = makeReviewKey(review.repoPath, review.ref);
          reviewsByKey[key] = review;
        }

        // diffStats / active state are populated asynchronously by
        // checkReviewsFreshness; the backend does not ship them inline (each
        // shortstat fans out to ~5 git spawns).
        set({
          globalReviews: reviews,
          globalReviewsByKey: reviewsByKey,
          globalReviewsLoading: false,
          repoMetadata: newMetadata,
        });

        // Fire-and-forget so diff stats fill in promptly without making callers
        // wait. Freshness short-circuits when SHAs match the cache, so this is
        // cheap on subsequent loads.
        get()
          .checkReviewsFreshness()
          .catch(() => {});
      } catch (err) {
        console.error("Failed to load global reviews:", err);
        set({ globalReviewsLoading: false });
      }
    },

    setActiveReviewKey: (key) => {
      set({ activeReviewKey: key });
    },

    ensureReviewExists: async (repoPath, ref, baseOverride, githubPr) => {
      try {
        await client.ensureReviewExists(repoPath, ref, baseOverride, githubPr);
      } catch (err) {
        console.error("Failed to ensure review exists:", err);
      }
    },

    deleteGlobalReview: async (repoPath, ref) => {
      try {
        await client.deleteReview(repoPath, ref);
        // Evict the keyed grouping entry for the deleted review
        get().removeGroupingEntry(makeReviewKey(repoPath, ref));
        // Clean up navigation snapshot
        const key = makeReviewKey(repoPath, ref);
        const { [key]: _, ...rest } = get().navigationSnapshots;
        set({ navigationSnapshots: rest });
        // Forget the on-disk marker so a stray save (e.g. classification after
        // a refresh) can't silently re-create the file we just deleted.
        forgetEnsuredReview(key);
        // Drop the cached missing-refs entry. checkReviewsFreshness only
        // revisits reviews still in the global list, so without this a deleted
        // deleted-branch review would keep its stale entry and flash the
        // "branch deleted" notice if the same comparison is re-opened later.
        if (key in get().reviewMissingRefs) {
          const { [key]: _missing, ...remainingMissing } =
            get().reviewMissingRefs;
          set({ reviewMissingRefs: remainingMissing });
        }
        // If the deleted review was active, clear the active key
        const { activeReviewKey } = get();
        if (
          activeReviewKey?.repoPath === repoPath &&
          activeReviewKey?.ref === ref
        ) {
          set({ activeReviewKey: null });
        }
        // Refresh sidebar
        await get().loadGlobalReviews();
      } catch (err) {
        console.error("Failed to delete review:", err);
      }
    },

    setBaseOverride: async (repoPath, ref, baseOverride) => {
      try {
        const resolved = await client.setBaseOverride(
          repoPath,
          ref,
          baseOverride,
        );

        // Identity is unchanged — no re-key. When this is the active review,
        // swap in the newly-resolved comparison, which re-runs the loader
        // (keyed on comparison.key) and reloads the diff.
        const { activeReviewKey } = get();
        if (
          activeReviewKey?.repoPath === repoPath &&
          activeReviewKey?.ref === ref
        ) {
          get().setComparison(resolved);
        }

        // Refresh sidebar
        await get().loadGlobalReviews();

        return resolved;
      } catch (err) {
        console.error("Failed to set base override:", err);
        return null;
      }
    },

    saveNavigationSnapshot: () => {
      const { repoPath, reviewRef, selectedFile } = get();
      if (!repoPath || !reviewRef) return;
      const key = makeReviewKey(repoPath, reviewRef);
      set({
        navigationSnapshots: {
          ...get().navigationSnapshots,
          [key]: { selectedFile },
        },
      });
    },

    restoreNavigationSnapshot: () => {
      const state = get();
      const { repoPath, reviewRef, flatFileList } = state;
      if (!repoPath || !reviewRef) return;
      const key = makeReviewKey(repoPath, reviewRef);
      const snapshot = state.navigationSnapshots[key];
      if (!snapshot) return;

      // Restore selectedFile only if it still exists in the current file list
      if (
        snapshot.selectedFile &&
        flatFileList.includes(snapshot.selectedFile)
      ) {
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
      if (freshnessInFlight) return freshnessInFlight;

      freshnessInFlight = (async () => {
        const { globalReviews, reviewCachedShas } = get();
        if (globalReviews.length === 0) return;

        // Summaries carry the review identity; the backend resolves each ref
        // (honoring baseOverride) into the comparison it diffs, and flags any
        // ref that no longer resolves via missingRefs.
        const inputs: ReviewFreshnessInput[] = globalReviews.map((review) => {
          const cached =
            reviewCachedShas[makeReviewKey(review.repoPath, review.ref)];
          return {
            repoPath: review.repoPath,
            ref: review.ref,
            baseOverride: review.baseOverride,
            githubPr: review.githubPr,
            cachedOldSha: cached?.oldSha ?? null,
            cachedNewSha: cached?.newSha ?? null,
          };
        });

        try {
          const results = await client.checkReviewsFreshness(inputs);
          const prev = get();
          // Lazy clone — only allocate a new record when the first real
          // change for that field is found. On the common no-change path
          // (most edits) all four references stay identical to `prev` and
          // the patch is empty.
          let activeState = prev.reviewActiveState;
          let cachedShas = prev.reviewCachedShas;
          let diffStats = prev.reviewDiffStats;
          let missingRefs = prev.reviewMissingRefs;

          for (const result of results) {
            if (activeState[result.key] !== result.isActive) {
              if (activeState === prev.reviewActiveState) {
                activeState = { ...activeState };
              }
              activeState[result.key] = result.isActive;
            }
            if (result.oldSha !== null || result.newSha !== null) {
              const cur = cachedShas[result.key];
              if (
                !cur ||
                cur.oldSha !== result.oldSha ||
                cur.newSha !== result.newSha
              ) {
                if (cachedShas === prev.reviewCachedShas) {
                  cachedShas = { ...cachedShas };
                }
                cachedShas[result.key] = {
                  oldSha: result.oldSha,
                  newSha: result.newSha,
                };
              }
            }
            if (result.diffStats) {
              const cur = diffStats[result.key];
              if (
                !cur ||
                cur.fileCount !== result.diffStats.fileCount ||
                cur.additions !== result.diffStats.additions ||
                cur.deletions !== result.diffStats.deletions
              ) {
                if (diffStats === prev.reviewDiffStats) {
                  diffStats = { ...diffStats };
                }
                diffStats[result.key] = result.diffStats;
              }
            }
            const nextMissing =
              result.missingRefs && result.missingRefs.length > 0
                ? result.missingRefs
                : null;
            const curMissing = missingRefs[result.key];
            if (nextMissing) {
              if (
                !curMissing ||
                curMissing.length !== nextMissing.length ||
                curMissing.some((v, i) => v !== nextMissing[i])
              ) {
                if (missingRefs === prev.reviewMissingRefs) {
                  missingRefs = { ...missingRefs };
                }
                missingRefs[result.key] = nextMissing;
              }
            } else if (curMissing) {
              if (missingRefs === prev.reviewMissingRefs) {
                missingRefs = { ...missingRefs };
              }
              delete missingRefs[result.key];
            }
          }

          // Only set fields that changed — replacing a record reference
          // re-renders every subscriber even when the contents match.
          const patch: Partial<
            Pick<
              GlobalReviewsSlice,
              | "reviewActiveState"
              | "reviewCachedShas"
              | "reviewDiffStats"
              | "reviewMissingRefs"
            >
          > = {};
          if (activeState !== prev.reviewActiveState) {
            patch.reviewActiveState = activeState;
          }
          if (cachedShas !== prev.reviewCachedShas) {
            patch.reviewCachedShas = cachedShas;
          }
          if (diffStats !== prev.reviewDiffStats) {
            patch.reviewDiffStats = diffStats;
          }
          if (missingRefs !== prev.reviewMissingRefs) {
            patch.reviewMissingRefs = missingRefs;
          }
          if (Object.keys(patch).length > 0) {
            set(patch);
          }
        } catch (err) {
          console.error("Failed to check reviews freshness:", err);
        }
      })().finally(() => {
        freshnessInFlight = null;
      });

      return freshnessInFlight;
    },
  });
};
