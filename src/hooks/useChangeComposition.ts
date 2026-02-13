import { useMemo } from "react";
import { useReviewStore } from "../stores";
import type { DiffHunk, ReviewState } from "../types";

const CATEGORY_NAMES: Record<string, string> = {
  imports: "Imports",
  formatting: "Formatting",
  comments: "Comments",
  types: "Types",
  file: "File",
  hunk: "Hunk",
  generated: "Generated",
  rename: "Rename",
};

export interface CategorySegment {
  categoryId: string;
  categoryName: string;
  count: number;
  percent: number;
}

export interface ChangeComposition {
  segments: CategorySegment[];
  totalClassified: number;
  totalUnclassified: number;
  totalHunks: number;
}

/** Pure computation of change composition from hunks + review state. */
export function computeChangeComposition(
  hunks: DiffHunk[],
  reviewState: ReviewState | null,
): ChangeComposition {
  const totalHunks = hunks.length;
  const categoryCounts: Record<string, number> = {};
  let totalClassified = 0;

  if (reviewState) {
    for (const h of hunks) {
      const state = reviewState.hunks[h.id];
      if (!state?.label || state.label.length === 0) continue;
      totalClassified++;
      const seen = new Set<string>();
      for (const label of state.label) {
        const category = label.split(":")[0];
        if (!seen.has(category) && category in CATEGORY_NAMES) {
          seen.add(category);
          categoryCounts[category] = (categoryCounts[category] || 0) + 1;
        }
      }
    }
  }

  const segments: CategorySegment[] = Object.entries(categoryCounts)
    .map(([categoryId, count]) => ({
      categoryId,
      categoryName: CATEGORY_NAMES[categoryId],
      count,
      percent:
        totalClassified > 0
          ? Math.round((count / totalClassified) * 1000) / 10
          : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    segments,
    totalClassified,
    totalUnclassified: totalHunks - totalClassified,
    totalHunks,
  };
}

export function useChangeComposition(): ChangeComposition {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);

  return useMemo(
    () => computeChangeComposition(hunks, reviewState),
    [hunks, reviewState],
  );
}
