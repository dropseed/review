import { useCallback } from "react";
import { useReviewStore } from "../../../stores";

/**
 * Provides unified approval handlers for files and directories.
 * Groups: approveAllFileHunks, unapproveAllFileHunks, approveAllDirHunks, unapproveAllDirHunks
 */
export function useFilePanelApproval() {
  const {
    approveAllFileHunks,
    unapproveAllFileHunks,
    approveAllDirHunks,
    unapproveAllDirHunks,
  } = useReviewStore();

  const handleApproveAll = useCallback(
    (path: string, isDir: boolean) => {
      if (isDir) {
        approveAllDirHunks(path);
      } else {
        approveAllFileHunks(path);
      }
    },
    [approveAllFileHunks, approveAllDirHunks],
  );

  const handleUnapproveAll = useCallback(
    (path: string, isDir: boolean) => {
      if (isDir) {
        unapproveAllDirHunks(path);
      } else {
        unapproveAllFileHunks(path);
      }
    },
    [unapproveAllFileHunks, unapproveAllDirHunks],
  );

  return {
    handleApproveAll,
    handleUnapproveAll,
  };
}
