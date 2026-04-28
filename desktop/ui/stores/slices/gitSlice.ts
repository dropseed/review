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

  // Commit state
  commitMessage: string;
  commitInProgress: boolean;
  commitOutput: CommitOutputLine[];
  commitResult: CommitResult | null;
  commitMessageGenerating: boolean;

  // Actions
  loadGitStatus: () => Promise<void>;
  loadRemoteInfo: () => Promise<void>;
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

    commitMessage: "",
    commitInProgress: false,
    commitOutput: [],
    commitResult: null,
    commitMessageGenerating: false,

    loadGitStatus: async () => {
      const { repoPath } = get();
      if (!repoPath) return;

      try {
        const status = await client.getGitStatus(repoPath);
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
        set({ remoteInfo: info });
      } catch {
        set({ remoteInfo: null });
      }
    },

    stageFile: async (path: string) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.stageFile(repoPath, path);
      await get().loadGitStatus();
    },

    unstageFile: async (path: string) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.unstageFile(repoPath, path);
      await get().loadGitStatus();
    },

    unstageAll: async () => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.unstageAll(repoPath);
      await get().loadGitStatus();
    },

    stageHunks: async (filePath: string, contentHashes: string[]) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.stageHunks(repoPath, filePath, contentHashes);
      await get().loadGitStatus();
    },

    unstageHunks: async (filePath: string, contentHashes: string[]) => {
      const { repoPath } = get();
      if (!repoPath) return;
      await client.unstageHunks(repoPath, filePath, contentHashes);
      await get().loadGitStatus();
    },

    setCommitMessage: (msg: string) => {
      set({ commitMessage: msg });
    },

    commitStaged: async () => {
      const { repoPath, commitMessage } = get();
      if (!repoPath || !commitMessage.trim()) return;

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
          repoPath,
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
      const { repoPath } = get();
      if (!repoPath) return;

      const requestId = `commit-msg-${++commitNonce}`;

      set({ commitMessageGenerating: true, commitMessage: "" });

      const unsubscribe = client.onCommitMessageChunk(requestId, (chunk) => {
        set((state) => ({
          commitMessage: state.commitMessage + chunk,
        }));
      });

      get().startActivity(requestId, "Generating commit message...", 60);

      try {
        const finalMessage = await client.generateCommitMessage(
          repoPath,
          requestId,
        );
        set({ commitMessage: finalMessage });
      } catch (err) {
        console.error("Failed to generate commit message:", err);
      } finally {
        unsubscribe();
        get().endActivity(requestId);
        set({ commitMessageGenerating: false });
      }
    },
  });
