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
  const trustedHunks = reviewState
    ? hunks.filter((h) => {
        const state = reviewState.hunks[h.id];
        return !state?.status && isHunkTrusted(state, reviewState.trustList);
      }).length
    : 0;
  const approvedHunks = reviewState
    ? hunks.filter((h) => reviewState.hunks[h.id]?.status === "approved").length
    : 0;
  const rejectedHunks = reviewState
    ? hunks.filter((h) => reviewState.hunks[h.id]?.status === "rejected").length
    : 0;
  const reviewedHunks = trustedHunks + approvedHunks + rejectedHunks;
  const pendingHunks = totalHunks - reviewedHunks;
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
