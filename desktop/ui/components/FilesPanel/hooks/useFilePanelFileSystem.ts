import { useMemo } from "react";
import { useReviewStore } from "../../../stores";
import { useFileHunkStatusMap } from "../../../hooks/useFileHunkStatusMap";
import {
  hasChangeStatus,
  processTree,
  processTreeWithSections,
} from "../FileTree.utils";

/**
 * Manages file tree data, sections, and stats for the FilesPanel.
 * Groups: repoPath, allFiles, allFilesLoading, hunks, reviewState (for hunk status)
 */
export function useFilePanelFileSystem() {
  const repoPath = useReviewStore((s) => s.repoPath);
  const allFiles = useReviewStore((s) => s.allFiles);
  const allFilesLoading = useReviewStore((s) => s.allFilesLoading);
  const hunks = useReviewStore((s) => s.hunks);
  const reviewState = useReviewStore((s) => s.reviewState);

  const hunkStatusMap = useFileHunkStatusMap();

  const movedFilePaths = useMemo(() => {
    const allPaths = new Set<string>();
    const hasNonMoved = new Set<string>();
    for (const h of hunks) {
      allPaths.add(h.filePath);
      if (!h.movePairId) hasNonMoved.add(h.filePath);
    }
    for (const p of hasNonMoved) {
      allPaths.delete(p);
    }
    return allPaths;
  }, [hunks]);

  const sectionedFiles = useMemo(
    () => processTreeWithSections(allFiles, hunkStatusMap),
    [allFiles, hunkStatusMap],
  );

  const allFilesTree = useMemo(
    () => processTree(allFiles, hunkStatusMap, "browse"),
    [allFiles, hunkStatusMap],
  );

  const stats = useMemo(() => {
    let needsReviewFiles = 0;
    let reviewedFiles = 0;
    let totalHunks = 0;
    let pendingHunks = 0;
    let reviewedHunks = 0;
    let rejectedHunks = 0;
    let savedForLaterHunks = 0;

    for (const status of hunkStatusMap.values()) {
      totalHunks += status.total;
      pendingHunks += status.pending;
      reviewedHunks += status.approved + status.trusted;
      rejectedHunks += status.rejected;
      savedForLaterHunks += status.savedForLater;

      if (status.total > 0) {
        if (status.pending > 0 || status.savedForLater > 0) {
          needsReviewFiles++;
        } else {
          reviewedFiles++;
        }
      }
    }

    return {
      pending: pendingHunks,
      reviewed: reviewedHunks,
      total: totalHunks,
      rejected: rejectedHunks,
      savedForLater: savedForLaterHunks,
      needsReviewFiles,
      reviewedFiles,
    };
  }, [hunkStatusMap]);

  const flatSectionedFiles = useMemo(() => {
    const needsReview: string[] = [];
    const savedForLater: string[] = [];
    const reviewed: string[] = [];
    const seenPaths = new Set<string>();

    // First, add files with hunks
    for (const [filePath, status] of hunkStatusMap.entries()) {
      if (status.total === 0) continue;
      seenPaths.add(filePath);
      if (status.pending > 0) needsReview.push(filePath);
      if (status.savedForLater > 0) savedForLater.push(filePath);
      if (status.approved + status.trusted + status.rejected > 0)
        reviewed.push(filePath);
    }

    // Also add entries with status changes but no hunks (e.g., symlink directories)
    function collectStatusChanges(entries: typeof allFiles) {
      for (const e of entries) {
        if (
          hasChangeStatus(e.status) &&
          !seenPaths.has(e.path) &&
          (!e.isDirectory || e.isSymlink)
        ) {
          needsReview.push(e.path);
          seenPaths.add(e.path);
        }
        if (e.children) collectStatusChanges(e.children);
      }
    }
    collectStatusChanges(allFiles);

    needsReview.sort((a, b) => a.localeCompare(b));
    savedForLater.sort((a, b) => a.localeCompare(b));
    reviewed.sort((a, b) => a.localeCompare(b));
    return { needsReview, savedForLater, reviewed };
  }, [hunkStatusMap, allFiles]);

  const fileStatusMap = useMemo(() => {
    const map = new Map<string, string>();
    function collect(entries: typeof allFiles) {
      for (const e of entries) {
        // Include files and symlink directories with status
        if (e.status && (!e.isDirectory || e.isSymlink)) {
          map.set(e.path, e.status);
        }
        if (e.children) collect(e.children);
      }
    }
    collect(allFiles);
    return map;
  }, [allFiles]);

  const allDirPaths = useMemo(() => {
    const paths = new Set<string>();
    function collect(entries: typeof allFilesTree) {
      for (const entry of entries) {
        if (
          entry.isDirectory &&
          entry.matchesFilter &&
          entry.status !== "gitignored"
        ) {
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
    collect(sectionedFiles.savedForLater);
    collect(sectionedFiles.reviewed);
    collect(allFilesTree);
    return paths;
  }, [allFilesTree, sectionedFiles]);

  return {
    repoPath,
    allFilesLoading,
    hunkStatusMap,
    movedFilePaths,
    sectionedFiles,
    flatSectionedFiles,
    fileStatusMap,
    allFilesTree,
    stats,
    allDirPaths,
    hunks,
    reviewState,
  };
}
