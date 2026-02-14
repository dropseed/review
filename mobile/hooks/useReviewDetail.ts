import { useCallback, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { useFiles, useAllHunks, useReviewState } from "../api/hooks";
import { decodeReviewKey } from "../lib/utils";
import { isHunkTrusted, getHunkReviewStatus } from "../lib/trust";
import { compactTree, getTopLevelDirPaths } from "../lib/tree-utils";
import type { FileEntry, DiffHunk, ReviewState, Comparison } from "../api/types";

function hasChangeStatus(status: FileEntry["status"]): boolean {
  return (
    status === "added" ||
    status === "modified" ||
    status === "deleted" ||
    status === "renamed" ||
    status === "untracked"
  );
}

function flattenFiles(entries: FileEntry[]): FileEntry[] {
  const result: FileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory && entry.children) {
      result.push(...flattenFiles(entry.children));
    } else if (!entry.isDirectory) {
      result.push(entry);
    }
  }
  return result;
}

function countFileHunks(filePath: string, hunks: DiffHunk[]): number {
  return hunks.filter((h) => h.filePath === filePath).length;
}

function countReviewedHunks(
  filePath: string,
  hunks: DiffHunk[],
  reviewState: ReviewState | undefined,
): number {
  if (!reviewState) return 0;
  let count = 0;
  for (const hunk of hunks) {
    if (hunk.filePath !== filePath) continue;
    const status = getHunkReviewStatus(
      reviewState.hunks[hunk.id],
      reviewState.trustList,
    );
    if (status !== "pending") count++;
  }
  return count;
}

function countTrustedHunks(
  filePath: string,
  hunks: DiffHunk[],
  reviewState: ReviewState | undefined,
): number {
  if (!reviewState) return 0;
  let count = 0;
  for (const hunk of hunks) {
    if (hunk.filePath !== filePath) continue;
    const state = reviewState.hunks[hunk.id];
    if (!state?.status && isHunkTrusted(state, reviewState.trustList)) {
      count++;
    }
  }
  return count;
}

export interface ReviewDetailStats {
  fileCount: number;
  totalHunks: number;
  reviewedHunkCount: number;
  trustedHunkCount: number;
}

export interface ReviewDetailSection {
  title: string;
  data: FileEntry[];
}

export function useReviewDetail(key: string) {
  const router = useRouter();

  const params = useMemo(() => {
    try {
      return decodeReviewKey(key);
    } catch {
      return null;
    }
  }, [key]);

  const comparison = useMemo(
    (): Comparison | undefined =>
      params
        ? {
            base: params.base,
            head: params.head,
            key: `${params.base}..${params.head}`,
          }
        : undefined,
    [params],
  );

  const {
    data: files,
    isLoading: filesLoading,
    refetch: refetchFiles,
    isRefetching: isRefetchingFiles,
  } = useFiles(params?.repo, comparison);
  const {
    data: reviewState,
    refetch: refetchState,
    isRefetching: isRefetchingState,
  } = useReviewState(params?.repo, comparison);

  const flatFiles = useMemo(() => (files ? flattenFiles(files) : []), [files]);
  const changedFiles = useMemo(
    () => flatFiles.filter((f) => hasChangeStatus(f.status)),
    [flatFiles],
  );
  const changedPaths = useMemo(
    () => changedFiles.map((f) => f.path),
    [changedFiles],
  );

  const {
    data: allHunks,
    refetch: refetchHunks,
    isRefetching: isRefetchingHunks,
  } = useAllHunks(params?.repo, comparison, changedPaths);
  const hunks = allHunks ?? [];

  // Compacted tree for Browse tab
  const browseTree = useMemo(
    () => (files ? compactTree(files) : []),
    [files],
  );

  // Expanded paths for tree view
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set<string>(),
  );
  const [expandedInited, setExpandedInited] = useState(false);
  if (files && !expandedInited) {
    setExpandedPaths(new Set(getTopLevelDirPaths(browseTree)));
    setExpandedInited(true);
  }

  const toggleExpand = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  // Hunk counts map for tree view
  const hunkCountsMap = useMemo(() => {
    const map = new Map<string, { total: number; reviewed: number }>();
    for (const file of changedFiles) {
      map.set(file.path, {
        total: countFileHunks(file.path, hunks),
        reviewed: countReviewedHunks(file.path, hunks, reviewState),
      });
    }
    return map;
  }, [changedFiles, hunks, reviewState]);

  // Sections for "Changes" tab
  const sections = useMemo((): ReviewDetailSection[] => {
    const needsReview: FileEntry[] = [];
    const trusted: FileEntry[] = [];
    const reviewed: FileEntry[] = [];

    for (const file of changedFiles) {
      const totalHunks = countFileHunks(file.path, hunks);
      const reviewedHunks = countReviewedHunks(file.path, hunks, reviewState);
      const trustedHunks = countTrustedHunks(file.path, hunks, reviewState);
      if (totalHunks > 0 && reviewedHunks >= totalHunks) {
        if (trustedHunks === totalHunks) {
          trusted.push(file);
        } else {
          reviewed.push(file);
        }
      } else {
        needsReview.push(file);
      }
    }

    const result: ReviewDetailSection[] = [];
    if (needsReview.length > 0) {
      result.push({ title: "Needs Review", data: needsReview });
    }
    if (trusted.length > 0) {
      result.push({ title: "Trusted", data: trusted });
    }
    if (reviewed.length > 0) {
      result.push({ title: "Reviewed", data: reviewed });
    }
    return result;
  }, [changedFiles, hunks, reviewState]);

  // Stats
  const stats = useMemo((): ReviewDetailStats => {
    let reviewedHunkCount = 0;
    let trustedHunkCount = 0;
    if (reviewState) {
      for (const hunk of hunks) {
        const status = getHunkReviewStatus(
          reviewState.hunks[hunk.id],
          reviewState.trustList,
        );
        if (status === "trusted") {
          trustedHunkCount++;
          reviewedHunkCount++;
        } else if (status !== "pending") {
          reviewedHunkCount++;
        }
      }
    }
    return {
      fileCount: changedFiles.length,
      totalHunks: hunks.length,
      reviewedHunkCount,
      trustedHunkCount,
    };
  }, [hunks, reviewState, changedFiles.length]);

  const handleFilePress = useCallback(
    (file: FileEntry, mode?: "browse") => {
      const queryParams = mode
        ? `?reviewKey=${key}&mode=${mode}`
        : `?reviewKey=${key}`;
      router.push(`/review/file/${file.path}${queryParams}`);
    },
    [key, router],
  );

  const handleRefresh = useCallback(() => {
    refetchFiles();
    refetchState();
    refetchHunks();
  }, [refetchFiles, refetchState, refetchHunks]);

  const isRefreshing =
    isRefetchingFiles || isRefetchingState || isRefetchingHunks;

  const repoName = params?.repo?.split("/").pop() ?? "Review";

  return {
    sections,
    flatFiles,
    changedFiles,
    browseTree,
    expandedPaths,
    toggleExpand,
    hunkCountsMap,
    stats,
    isLoading: filesLoading,
    isRefreshing,
    handleRefresh,
    handleFilePress,
    comparison,
    reviewState,
    repoName,
    hunks,
    countFileHunks,
    countReviewedHunks,
  };
}

// Re-export the count functions for use in renderItem callbacks
export { countFileHunks, countReviewedHunks };
