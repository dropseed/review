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
// Separate from commitNonce: an unrelated commitStaged() call must not mark
// an in-flight generateCommitMessage() as superseded.
let generateCommitNonce = 0;

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

/**
 * The commit box belongs to one working tree. Cleared whenever the working
 * tree shown could change (repo switch, comparison switch, or entering a
 * different review's worktree) so a draft or an in-flight generation from
 * the previous one never lingers into the next -- see comparisonResetState
 * in filesSlice.ts, which spreads this in.
 */
export const gitCommitResetState = {
  commitMessage: "",
  commitInProgress: false,
  commitOutput: [] as CommitOutputLine[],
  commitResult: null as CommitResult | null,
  commitMessageGenerating: false,
} satisfies Partial<GitSlice>;

export const createGitSlice: SliceCreatorWithClient<GitSlice> =
  (client: ApiClient) => (set, get) => ({
    gitStatus: null,
    stagedFilePaths: EMPTY_STAGED_SET,
    remoteInfo: null,
    gitUser: null,

    ...gitCommitResetState,

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

      const nonce = ++generateCommitNonce;
      const requestId = `commit-msg-${nonce}`;
      const previousMessage = get().commitMessage;
      // Guards every content write below: a repo/worktree switch, or a
      // second generate call superseding this one, must not clobber state
      // that no longer belongs to this request (same race class as
      // loadGitStatus/loadRemoteInfo above).
      const isStale = () =>
        get().getWorkingTreePath() !== workingPath ||
        generateCommitNonce !== nonce;
      // Narrower than isStale(): only true when a *newer generate call*
      // has taken over commitMessageGenerating. A plain repo switch means
      // nothing is generating there, so the flag still needs to come back
      // down -- leaving it stuck true would disable Generate/Commit for
      // every repo visited afterward.
      const supersededByNewerGenerate = () => generateCommitNonce !== nonce;

      set({ commitMessageGenerating: true, commitMessage: "" });

      const unsubscribe = client.onCommitMessageChunk(requestId, (chunk) => {
        if (isStale()) return;
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
        if (isStale()) return;
        set({ commitMessage: finalMessage });
      } catch (err) {
        if (isStale()) return;
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
        if (!supersededByNewerGenerate()) {
          set({ commitMessageGenerating: false });
        }
      }
    },
  });
