import { useMemo } from "react";
import { useReviewStore } from "../stores";
import { useAllHunks } from "../stores/selectors/hunks";
import type { DiffHunk, ReviewState } from "../types";
import { effectiveHunkStatus } from "../types";

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
      switch (effectiveHunkStatus(state, reviewState.trustList)) {
        case "approved":
          approvedHunks++;
          break;
        case "rejected":
          rejectedHunks++;
          break;
        case "saved":
          savedForLaterHunks++;
          break;
        case "trusted":
          trustedHunks++;
          break;
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
  const hunks = useAllHunks();
  const reviewState = useReviewStore((s) => s.reviewState);

  return useMemo(
    () => computeReviewProgress(hunks, reviewState),
    [hunks, reviewState],
  );
}
