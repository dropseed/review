import { useMemo } from "react";
import { useReviewStore } from "../stores";
import type { DiffHunk, ReviewState } from "../types";
import { isHunkTrusted } from "../types";

export type ReviewStateValue = "approved" | "changes_requested" | null;

export interface ReviewProgress {
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  rejectedHunks: number;
  savedForLaterHunks: number;
  reviewedHunks: number;
  pendingHunks: number;
  reviewedPercent: number;
  state: ReviewStateValue;
}

/** Pure computation of review progress from hunks + review state. */
export function computeReviewProgress(
  hunks: DiffHunk[],
  reviewState: ReviewState | null,
): ReviewProgress {
  const totalHunks = hunks.length;

  // Single pass over hunks to count all status categories
  let trustedHunks = 0;
  let approvedHunks = 0;
  let rejectedHunks = 0;
  let savedForLaterHunks = 0;

  if (reviewState) {
    for (const h of hunks) {
      const state = reviewState.hunks[h.id];
      if (state?.status === "approved") {
        approvedHunks++;
      } else if (state?.status === "rejected") {
        rejectedHunks++;
      } else if (state?.status === "saved_for_later") {
        savedForLaterHunks++;
      } else if (isHunkTrusted(state, reviewState.trustList)) {
        trustedHunks++;
      }
    }
  }

  const reviewedHunks = trustedHunks + approvedHunks + rejectedHunks;
  const pendingHunks = totalHunks - reviewedHunks - savedForLaterHunks;
  const reviewedPercent =
    totalHunks > 0 ? Math.round((reviewedHunks / totalHunks) * 100) : 0;

  let state: ReviewStateValue = null;
  if (rejectedHunks > 0) {
    state = "changes_requested";
  } else if (reviewedHunks === totalHunks && totalHunks > 0) {
    state = "approved";
  }

  return {
    totalHunks,
    trustedHunks,
    approvedHunks,
    rejectedHunks,
    savedForLaterHunks,
    reviewedHunks,
    pendingHunks,
    reviewedPercent,
    state,
  };
}

export function useReviewProgress(): ReviewProgress {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);

  return useMemo(
    () => computeReviewProgress(hunks, reviewState),
    [hunks, reviewState],
  );
}
