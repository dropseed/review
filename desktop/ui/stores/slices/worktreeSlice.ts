import type { Comparison } from "../../types";
import { getApiClient } from "../../api";
import type { SliceCreator } from "../types";

export interface WorktreeSlice {
  worktreePath: string | null;
  worktreeStale: boolean;
  readOnlyPreview: boolean;
  setWorktreePath: (path: string | null) => void;
  setWorktreeStale: (stale: boolean) => void;
  setReadOnlyPreview: (readOnly: boolean) => void;
  checkoutWorktree: (repoPath: string, comparison: Comparison) => Promise<void>;
}

export const createWorktreeSlice: SliceCreator<WorktreeSlice> = (set, get) => ({
  worktreePath: null,
  worktreeStale: false,
  readOnlyPreview: false,

  setWorktreePath: (path) => set({ worktreePath: path }),
  setWorktreeStale: (stale) => set({ worktreeStale: stale }),
  setReadOnlyPreview: (readOnly) => set({ readOnlyPreview: readOnly }),

  checkoutWorktree: async (repoPath, comparison) => {
    const apiClient = getApiClient();

    let worktreePath: string;
    try {
      const wt = await apiClient.createReviewWorktree(
        repoPath,
        comparison.key,
        comparison.head,
      );
      worktreePath = wt.path;
    } catch (err) {
      const msg = String(err);
      if (msg.startsWith("WORKTREE_EXISTS:")) {
        // Path is encoded in the error message after the prefix
        worktreePath = msg.slice("WORKTREE_EXISTS:".length);
      } else {
        throw err;
      }
    }

    // Persist worktreePath into review state
    try {
      const reviewState = get().reviewState;
      if (reviewState && !reviewState.worktreePath) {
        await apiClient.saveReviewState(repoPath, {
          ...reviewState,
          worktreePath,
          updatedAt: new Date().toISOString(),
        });
      }
    } catch {
      // Non-fatal
    }

    set({ worktreePath, worktreeStale: false });
  },
});
