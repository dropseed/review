import { useMemo, useState, useEffect } from "react";
import { useReviewStore } from "../stores";
import { anyLabelMatchesPattern } from "../types";
import { getApiClient } from "../api";

let cachedKnownPatternIds: Set<string> | null = null;
let cachedPromise: Promise<Set<string>> | null = null;

function loadKnownPatternIds(): Promise<Set<string>> {
  if (cachedKnownPatternIds) return Promise.resolve(cachedKnownPatternIds);
  if (cachedPromise) return cachedPromise;
  cachedPromise = getApiClient()
    .getTrustTaxonomy()
    .then((categories) => {
      const ids = new Set<string>();
      for (const cat of categories) {
        for (const p of cat.patterns) {
          ids.add(p.id);
        }
      }
      cachedKnownPatternIds = ids;
      return ids;
    });
  return cachedPromise;
}

export function useKnownPatternIds(): Set<string> | undefined {
  const [ids, setIds] = useState<Set<string> | undefined>(
    cachedKnownPatternIds ?? undefined,
  );

  useEffect(() => {
    loadKnownPatternIds()
      .then(setIds)
      .catch((err) => console.error("Failed to load taxonomy:", err));
  }, []);

  return ids;
}

interface TrustCounts {
  trustedHunkCount: number;
  totalHunks: number;
  trustableHunkCount: number;
}

export function useTrustCounts(knownPatternIds?: Set<string>): TrustCounts {
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

  const trustableHunkCount = useMemo(() => {
    if (!knownPatternIds || knownPatternIds.size === 0) return 0;
    return hunks.filter((hunk) => {
      const labels = reviewState?.hunks[hunk.id]?.label ?? [];
      return labels.some((label) => knownPatternIds.has(label));
    }).length;
  }, [hunks, reviewState?.hunks, knownPatternIds]);

  return {
    trustedHunkCount,
    totalHunks: hunks.length,
    trustableHunkCount,
  };
}
