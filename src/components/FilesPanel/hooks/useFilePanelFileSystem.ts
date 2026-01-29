import { useMemo } from "react";
import { useReviewStore } from "../../../stores/reviewStore";
import {
  calculateFileHunkStatus,
  processTree,
  processTreeWithSections,
} from "../FileTree.utils";

/**
 * Manages file tree data, sections, and stats for the FilesPanel.
 * Groups: repoPath, allFiles, allFilesLoading, hunks, reviewState (for hunk status)
 */
export function useFilePanelFileSystem() {
  const {
    repoPath,
    allFiles,
    allFilesLoading,
    hunks,
    reviewState,
    stagedFilePaths,
  } = useReviewStore();

  // Calculate hunk status per file
  const hunkStatusMap = useMemo(
    () =>
      calculateFileHunkStatus(hunks, reviewState, {
        autoApproveStaged: reviewState?.autoApproveStaged,
        stagedFilePaths,
      }),
    [hunks, reviewState, stagedFilePaths],
  );

  // Process sectioned tree for Changes sections (Needs Review vs Reviewed)
  const sectionedFiles = useMemo(
    () => processTreeWithSections(allFiles, hunkStatusMap),
    [allFiles, hunkStatusMap],
  );

  // Process tree for All Files section
  const allFilesTree = useMemo(
    () => processTree(allFiles, hunkStatusMap, "all"),
    [allFiles, hunkStatusMap],
  );

  // Overall stats - count FILES not hunks for section badges
  const stats = useMemo(() => {
    let needsReviewFiles = 0;
    let reviewedFiles = 0;
    let totalHunks = 0;
    let pendingHunks = 0;
    let rejectedHunks = 0;

    for (const status of hunkStatusMap.values()) {
      totalHunks += status.total;
      pendingHunks += status.pending;
      rejectedHunks += status.rejected;

      if (status.total > 0) {
        if (status.pending > 0) {
          needsReviewFiles++;
        } else {
          reviewedFiles++;
        }
      }
    }

    return {
      pending: pendingHunks,
      total: totalHunks,
      rejected: rejectedHunks,
      needsReviewFiles,
      reviewedFiles,
    };
  }, [hunkStatusMap]);

  // Collect all directory paths for expand/collapse all
  const allDirPaths = useMemo(() => {
    const paths = new Set<string>();
    function collect(entries: typeof allFilesTree) {
      for (const entry of entries) {
        if (entry.isDirectory && entry.matchesFilter) {
          for (const p of entry.compactedPaths) {
            paths.add(p);
          }
          if (entry.children) {
            collect(entry.children);
          }
        }
      }
    }
    collect(sectionedFiles.needsReview);
    collect(sectionedFiles.reviewed);
    collect(allFilesTree);
    return paths;
  }, [allFilesTree, sectionedFiles]);

  return {
    repoPath,
    allFilesLoading,
    hunkStatusMap,
    sectionedFiles,
    allFilesTree,
    stats,
    allDirPaths,
    hunks,
    reviewState,
  };
}
