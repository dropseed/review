import type { GitHubPrRef, ReviewTierInfo } from "../../types";
import { getPlatformServices } from "../../platform";
import type { SliceCreatorWithClient } from "../types";

/**
 * Review tiers — how much of a review is present locally.
 *
 * The tiers are nested, and every one of them reads its diff through the same
 * local git path, so hunk hashes are identical at each. Promoting a review
 * mid-review never disturbs its state.
 *
 * A promotion is driven by *intent*, not by a mode switch: opening a review
 * fetches it, and asking for something that needs files on disk (a terminal,
 * LSP, staging) materializes it.
 */
export interface TierSlice {
  /** Tier of the active review, or null before it has been probed. */
  reviewTier: ReviewTierInfo | null;
  /** Probe the active review's tier and cache it. */
  loadReviewTier: () => Promise<void>;

  /** Listed -> Fetched. Idempotent; also picks up new commits on the PR. */
  fetchPullRequestRef: (repoPath: string, pr: GitHubPrRef) => Promise<boolean>;

  /**
   * Ensure the active review has a worktree, asking first.
   *
   * Materializing creates a directory and a git worktree, which is a real
   * filesystem mutation to take on behalf of an action as innocuous as opening
   * a terminal — so it is confirmed rather than silent. `reason` completes the
   * sentence "… needs a checkout to <reason>".
   *
   * Resolves to the worktree path, or null if the user declined or it failed.
   */
  ensureMaterialized: (reason: string) => Promise<string | null>;

  /**
   * Materialized -> Fetched: drop a row's checkout, keeping its review record.
   *
   * Lives beside `ensureMaterialized` rather than in the menu item that calls
   * it, so both directions of the transition refresh the same listings and a
   * second entry point doesn't have to re-derive which.
   */
  releaseCheckout: (repoPath: string, ref: string) => Promise<void>;
}

export const createTierSlice: SliceCreatorWithClient<TierSlice> =
  (client) => (set, get) => ({
    reviewTier: null,

    loadReviewTier: async () => {
      const { repoPath, reviewRef } = get();
      if (!repoPath || !reviewRef) {
        set({ reviewTier: null });
        return;
      }
      try {
        const tier = await client.getReviewTier(repoPath, reviewRef);
        // Guard against a slower probe landing after the user switched rows.
        const now = get();
        if (now.repoPath !== repoPath || now.reviewRef !== reviewRef) return;
        set({ reviewTier: tier });
      } catch (err) {
        console.warn("[tier] Failed to probe review tier:", err);
      }
    },

    fetchPullRequestRef: async (repoPath, pr) => {
      try {
        // No tier probe here: this runs before the store switches to the review
        // being opened, so it would probe the outgoing one and throw the result
        // away. `useReviewTier`'s effect covers the new review a moment later.
        await client.fetchPullRequest(repoPath, pr);
        return true;
      } catch (err) {
        console.error("[tier] Failed to fetch PR:", err);
        return false;
      }
    },

    ensureMaterialized: async (reason) => {
      const { repoPath, reviewRef } = get();
      if (!repoPath || !reviewRef) return null;

      // Trust a cached `materialized` tier, but re-probe anything else: the
      // worktree may have been released in another window since we last looked.
      let tier = get().reviewTier;
      if (tier?.tier !== "materialized") {
        await get().loadReviewTier();
        tier = get().reviewTier;
      }
      if (tier?.tier === "materialized" && tier.worktreePath) {
        return tier.worktreePath;
      }

      const { dialogs } = getPlatformServices();
      const confirmed = await dialogs.confirm(
        `Reviewing "${reviewRef}" needs a checkout to ${reason}. ` +
          `Create a worktree for it?`,
        "Check out this review",
      );
      if (!confirmed) return null;

      try {
        const worktreePath = await client.materializeReview(
          repoPath,
          reviewRef,
        );
        set({
          reviewTier: { tier: "materialized", worktreePath },
          worktreePath,
        });

        // The row's tier and worktree badge are driven by these listings.
        const state = get();
        await Promise.all([
          state.loadLocalActivity(),
          state.loadGlobalReviews(),
        ]);

        // Re-read state so the in-memory review carries the worktree path the
        // backend just persisted, rather than a stale copy without it.
        const reviewState = get().reviewState;
        if (reviewState && !reviewState.worktreePath) {
          set({ reviewState: { ...reviewState, worktreePath } });
        }

        return worktreePath;
      } catch (err) {
        console.error("[tier] Failed to materialize review:", err);
        await dialogs.alert(
          `Could not create a worktree for "${reviewRef}": ${String(err)}`,
          "Checkout failed",
        );
        return null;
      }
    },

    releaseCheckout: async (repoPath, ref) => {
      try {
        await client.releaseReviewWorktree(repoPath, ref);
      } catch (err) {
        console.error("[tier] Failed to release worktree:", err);
        return;
      }
      const state = get();
      await Promise.all([state.loadLocalActivity(), state.loadGlobalReviews()]);
      if (
        state.activeReviewKey?.repoPath === repoPath &&
        state.activeReviewKey?.ref === ref
      ) {
        set({ worktreePath: null });
        await get().loadReviewTier();
      }
    },
  });
