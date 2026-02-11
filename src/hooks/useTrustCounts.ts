import { useMemo } from "react";
import { useReviewStore } from "../stores";
import { anyLabelMatchesPattern } from "../types";

interface TrustCounts {
  trustedHunkCount: number;
  totalHunks: number;
}

export function useTrustCounts(): TrustCounts {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);

  const trustList = reviewState?.trustList ?? [];

  const trustedHunkCount = useMemo(() => {
    if (trustList.length === 0) return 0;
    return hunks.filter((hunk) => {
      const labels = reviewState?.hunks[hunk.id]?.label ?? [];
      return trustList.some((pattern) =>
        anyLabelMatchesPattern(labels, pattern),
      );
    }).length;
  }, [hunks, reviewState?.hunks, trustList]);

  return {
    trustedHunkCount,
    totalHunks: hunks.length,
  };
}
