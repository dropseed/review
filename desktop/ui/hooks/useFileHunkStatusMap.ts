import { useMemo } from "react";
import { useReviewStore } from "../stores";
import { calculateFileHunkStatus } from "../components/FilesPanel/FileTree.utils";
import type { FileHunkStatus } from "../components/tree/types";

/**
 * Returns a Map<string, FileHunkStatus> for every file that has hunks.
 * Shared between FilesPanel and RepoSymbolsView so hunk-status computation
 * lives in one place.
 */
export function useFileHunkStatusMap(): Map<string, FileHunkStatus> {
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);

  return useMemo(
    () =>
      calculateFileHunkStatus(hunks, reviewState, {
        autoApproveStaged: reviewState?.autoApproveStaged,
        stagedFilePaths,
      }),
    [hunks, reviewState, stagedFilePaths],
  );
}
