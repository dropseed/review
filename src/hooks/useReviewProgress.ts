import { useMemo } from "react";
import { useReviewStore } from "../stores/reviewStore";
import { isHunkTrusted } from "../types";

export interface ReviewProgress {
  totalHunks: number;
  trustedHunks: number;
  approvedHunks: number;
  reviewedHunks: number;
  pendingHunks: number;
  reviewedPercent: number;
}

export function useReviewProgress(): ReviewProgress {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);

  return useMemo(() => {
    const totalHunks = hunks.length;
    const trustedHunks = reviewState
      ? hunks.filter((h) => {
          const state = reviewState.hunks[h.id];
          return !state?.status && isHunkTrusted(state, reviewState.trustList);
        }).length
      : 0;
    const approvedHunks = reviewState
      ? hunks.filter((h) => reviewState.hunks[h.id]?.status === "approved")
          .length
      : 0;
    const reviewedHunks = trustedHunks + approvedHunks;
    const pendingHunks = totalHunks - reviewedHunks;
    const reviewedPercent =
      totalHunks > 0 ? Math.round((reviewedHunks / totalHunks) * 100) : 0;

    return {
      totalHunks,
      trustedHunks,
      approvedHunks,
      reviewedHunks,
      pendingHunks,
      reviewedPercent,
    };
  }, [hunks, reviewState]);
}
