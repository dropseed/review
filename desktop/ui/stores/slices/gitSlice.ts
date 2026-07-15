import type { ApiClient } from "../../api";
import type {
  CommitOutputLine,
  CommitResult,
  GitStatusSummary,
  RemoteInfo,
} from "../../types";
import type { SliceCreatorWithClient } from "../types";
import { jsonEqual } from "../../utils/equality";

/** Singleton empty set -- preserves reference equality to avoid spurious re-renders. */
export const EMPTY_STAGED_SET = new Set<string>();

let commitNonce = 0;

export interface GitSlice {
  // Git state
  gitStatus: GitStatusSummary | null;
  stagedFilePaths: Set<string>;
  remoteInfo: RemoteInfo | null;
  gitUser: string | null;

  // Commit state
  commitMessage: string;
  commitInProgress: boolean;
  commitOutput: CommitOutputLine[];
  commitResult: CommitResult | null;
  commitMessageGenerating: boolean;

  // Actions
  loadGitStatus: () => Promise<void>;
  loadRemoteInfo: () => Promise<void>;
  loadGitUser: () => Promise<void>;
  stageFile: (path: string) => Promise<void>;
  unstageFile: (path: string) => Promise<void>;
  unstageAll: () => Promise<void>;
  stageHunks: (filePath: string, contentHashes: string[]) => Promise<void>;
  unstageHunks: (filePath: string, contentHashes: string[]) => Promise<void>;
  setCommitMessage: (msg: string) => void;
  commitStaged: () => Promise<void>;
  clearCommitResult: () => void;
  generateCommitMessage: () => Promise<void>;
}

export const createGitSlice: SliceCreatorWithClient<GitSlice> =
  (client: ApiClient) => (set, get) => ({
    gitStatus: null,
    stagedFilePaths: EMPTY_STAGED_SET,
    remoteInfo: null,
    gitUser: null,

    commitMessage: "",
    commitInProgress: false,
    commitOutput: [],
    commitResult: null,
    commitMessageGenerating: false,

    loadGitStatus: async () => {
      const workingPath = get().getWorkingTreePath();
      if (!workingPath) return;

      try {
        const status = await client.getGitStatus(workingPath);
        // Guard against a stale response: if the repo/worktree changed
        // while this request was in flight, don't clobber the new one's
        // status (same race fixed for loadRemoteInfo/loadGitUser, keyed
        // on getWorkingTreePath() here since status is worktree-scoped
        // rather than repo-scoped).
        if (get().getWorkingTreePath() !== workingPath) return;
        // Skip the set() when nothing changed — replacing references
        // re-renders every component selecting `gitStatus` or
        // `stagedFilePaths`, even when the data is identical. Cheap O(1)
        // length checks short-circuit before the stringify.
        const prev = get().gitStatus;
        if (
          prev &&
          prev.currentBranch === status.currentBranch &&
          prev.staged.length === status.staged.length &&
          prev.unstaged.length === status.unstaged.length &&
          prev.untracked.length === status.untracked.length &&
          jsonEqual(prev, status)
        ) {
          return;
        }
        const stagedPaths = status.staged.map((e) => e.path);
        const staged =
          stagedPaths.length === 0
            ? EMPTY_STAGED_SET
            : new Set<string>(stagedPaths);
        set({ gitStatus: status, stagedFilePaths: staged });
      } catch (err) {
        console.error("Failed to load git status:", err);
        if (get().getWorkingTreePath() !== workingPath) return;
        if (get().gitStatus !== null) {
          set({ gitStatus: null, stagedFilePaths: EMPTY_STAGED_SET });
        }
      }
    },

    loadRemoteInfo: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      try {
        const info = await client.getRemoteInfo(repoPath);
        // Guard against a stale response: if the repo changed while this
        // request was in flight, don't clobber the new repo's remote info.
        if (get().repoPath !== repoPath) return;
        set({ remoteInfo: info });
      } catch (err) {
        console.error("Failed to load remote info:", err);
        if (get().repoPath !== repoPath) return;
        set({ remoteInfo: null });
      }
    },

    loadGitUser: async () => {
      const { repoPath } = get();
      if (!repoPath) return;
      try {
        // Bound the wait: `git config user.name` is a local config read,
        // but a hung git process must not block whoever awaits this.
        const user = await Promise.race([
          client.getGitUser(repoPath),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
        ]);
        // Guard against a stale response: if the repo changed while this
        // request was in flight, don't clobber the new repo's identity.
        if (get().repoPath !== repoPath) return;
        set({ gitUser: user });
      } catch (err) {
        console.error("Failed to load git user:", err);
        if (get().repoPath !== repoPath) return;
        set({ gitUser: null });
      }
    },

    stageFile: async (path: string) => {
      const workingPath = get().getWorkingTreePath();
      if (!workingPath) return;
      await client.stageFile(workingPath, path);
      await get().loadGitStatus();
    },

    unstageFile: async (path: string) => {
      const workingPath = get().getWorkingTreePath();
      if (!workingPath) return;
      await client.unstageFile(workingPath, path);
      await get().loadGitStatus();
    },

    unstageAll: async () => {
      const workingPath = get().getWorkingTreePath();
      if (!workingPath) return;
      await client.unstageAll(workingPath);
      await get().loadGitStatus();
    },

    stageHunks: async (filePath: string, contentHashes: string[]) => {
      const workingPath = get().getWorkingTreePath();
      if (!workingPath) return;
      await client.stageHunks(workingPath, filePath, contentHashes);
      await get().loadGitStatus();
    },

    unstageHunks: async (filePath: string, contentHashes: string[]) => {
      const workingPath = get().getWorkingTreePath();
      if (!workingPath) return;
      await client.unstageHunks(workingPath, filePath, contentHashes);
      await get().loadGitStatus();
    },

    setCommitMessage: (msg: string) => {
      set({ commitMessage: msg });
    },

    commitStaged: async () => {
      const workingPath = get().getWorkingTreePath();
      const { commitMessage } = get();
      if (!workingPath || !commitMessage.trim()) return;

      const requestId = `commit-${++commitNonce}`;

      // Subscribe to output events before starting.
      // Lines arrive in order from the channel, so append without sorting.
      const unsubscribe = client.onCommitOutput(requestId, (line) => {
        set((state) => ({
          commitOutput: [...state.commitOutput, line],
        }));
      });

      set({
        commitInProgress: true,
        commitOutput: [],
        commitResult: null,
      });

      get().startActivity(requestId, "Committing...", 60);

      try {
        const result = await client.gitCommit(
          workingPath,
          commitMessage,
          requestId,
        );

        set({ commitResult: result, commitInProgress: false });

        if (result.success) {
          // Clear message on success, reload git status
          set({ commitMessage: "" });
          await get().loadGitStatus();
        }
        // On failure, preserve commitMessage for retry
      } catch (err) {
        set({
          commitResult: {
            success: false,
            commitHash: null,
            summary: String(err),
          },
          commitInProgress: false,
        });
      } finally {
        unsubscribe();
        get().endActivity(requestId);
      }
    },

    clearCommitResult: () => {
      set({ commitResult: null, commitOutput: [] });
    },

    generateCommitMessage: async () => {
      const workingPath = get().getWorkingTreePath();
      if (!workingPath) return;

      const requestId = `commit-msg-${++commitNonce}`;
      const previousMessage = get().commitMessage;

      set({ commitMessageGenerating: true, commitMessage: "" });

      const unsubscribe = client.onCommitMessageChunk(requestId, (chunk) => {
        set((state) => ({
          commitMessage: state.commitMessage + chunk,
        }));
      });

      get().startActivity(requestId, "Generating commit message...", 60);

      try {
        const finalMessage = await client.generateCommitMessage(
          workingPath,
          requestId,
        );
        set({ commitMessage: finalMessage });
      } catch (err) {
        console.error("Failed to generate commit message:", err);
        // Restore the user's draft rather than leaving the box empty with
        // no explanation of what went wrong.
        set({
          commitMessage: previousMessage,
          commitResult: {
            success: false,
            commitHash: null,
            summary: `Failed to generate commit message: ${String(err)}`,
          },
        });
      } finally {
        unsubscribe();
        get().endActivity(requestId);
        set({ commitMessageGenerating: false });
      }
    },
  });
