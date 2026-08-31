import { useCallback } from "react";
import { useSpurStore } from "../../../stores";

/** Provides unified approve/unapprove/reject handlers for files and directories. */
export function useFilePanelApproval() {
  const {
    approveAllFileHunks,
    unapproveAllFileHunks,
    rejectAllFileHunks,
    approveAllDirHunks,
    unapproveAllDirHunks,
    rejectAllDirHunks,
  } = useSpurStore();

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

  const handleRejectAll = useCallback(
    (path: string, isDir: boolean) => {
      if (isDir) {
        rejectAllDirHunks(path);
      } else {
        rejectAllFileHunks(path);
      }
    },
    [rejectAllFileHunks, rejectAllDirHunks],
  );

  return {
    handleApproveAll,
    handleUnapproveAll,
    handleRejectAll,
  };
}
