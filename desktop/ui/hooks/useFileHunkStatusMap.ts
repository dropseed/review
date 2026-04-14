import { useMemo, useRef } from "react";
import { useReviewStore } from "../stores";
import { useAllHunks } from "../stores/selectors/hunks";
import { calculateFileHunkStatus } from "../components/FilesPanel/FileTree.utils";
import type { FileHunkStatus } from "../components/tree/types";

/**
 * Returns a Map<string, FileHunkStatus> for every file that has hunks.
 * Shared between FilesPanel and other views so hunk-status computation
 * lives in one place.
 */
export function useFileHunkStatusMap(): Map<string, FileHunkStatus> {
  const hunks = useAllHunks();
  const reviewState = useReviewStore((s) => s.reviewState);
  const stagedFilePaths = useReviewStore((s) => s.stagedFilePaths);

  const prevMapRef = useRef<Map<string, FileHunkStatus>>(new Map());

  return useMemo(() => {
    const newMap = calculateFileHunkStatus(hunks, reviewState, {
      autoApproveStaged: reviewState?.autoApproveStaged,
      stagedFilePaths,
    });

    if (prevMapRef.current.size === newMap.size) {
      let equal = true;
      for (const [key, newStatus] of newMap) {
        const prev = prevMapRef.current.get(key);
        if (
          !prev ||
          prev.pending !== newStatus.pending ||
          prev.approved !== newStatus.approved ||
          prev.trusted !== newStatus.trusted ||
          prev.rejected !== newStatus.rejected ||
          prev.savedForLater !== newStatus.savedForLater ||
          prev.total !== newStatus.total
        ) {
          equal = false;
          break;
        }
      }
      if (equal) return prevMapRef.current;
    }

    prevMapRef.current = newMap;
    return newMap;
  }, [hunks, reviewState, stagedFilePaths]);
}
