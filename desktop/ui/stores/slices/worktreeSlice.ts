import type { SliceCreator } from "../types";

export interface WorktreeSlice {
  worktreePath: string | null;
  worktreeStale: boolean;
  readOnlyPreview: boolean;
  setWorktreePath: (path: string | null) => void;
  setWorktreeStale: (stale: boolean) => void;
  setReadOnlyPreview: (readOnly: boolean) => void;
  /** On-disk path for working-tree git ops — the linked worktree if one is
   *  active, else the main repo. */
  getWorkingTreePath: () => string | null;
}

/**
 * Where the active review's checkout is, once it has one.
 *
 * Creating that checkout lives in `tierSlice.ensureMaterialized`, not here —
 * this slice only tracks the result. There used to be a `checkoutWorktree`
 * action alongside it that named worktrees by comparison key while the backend
 * named them by ref, so one review could end up with two checkouts depending
 * on which button you pressed.
 */
export const createWorktreeSlice: SliceCreator<WorktreeSlice> = (set, get) => ({
  worktreePath: null,
  worktreeStale: false,
  readOnlyPreview: false,

  setWorktreePath: (path) => set({ worktreePath: path }),
  setWorktreeStale: (stale) => set({ worktreeStale: stale }),
  setReadOnlyPreview: (readOnly) => set({ readOnlyPreview: readOnly }),
  getWorkingTreePath: () => get().worktreePath ?? get().repoPath,
});
