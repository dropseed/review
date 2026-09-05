import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiClient } from "../../api";
import { useSpurStore } from "../../stores";
import type { WorktreeStatus } from "../../types";
import { repoHosts } from "../../stores/selectors/workspaceData";
import { repoChoiceKey } from "./repo-choices";

/**
 * What the picker knows about the checkouts on disk, keyed by path.
 *
 * Asked of every repo the picker lists, in one call, when the picker opens —
 * `git worktree list` per repo plus a `git status` per linked worktree, which
 * is why it is batched and why the main checkouts are left out of the status
 * half. Refetched after a create or a remove rather than polled: nothing else
 * in the app makes worktrees.
 *
 * A repo git can't answer for contributes nothing. Orientation is the row's
 * second column, never its identity — a repo whose status read failed still
 * lists and still opens.
 */
export function useWorktreeStatus(repoPaths: readonly string[]): {
  byPath: ReadonlyMap<string, WorktreeStatus>;
  refresh: () => Promise<void>;
} {
  // A joined key rather than the array, so a reusable hook doesn't depend on
  // its callers memoizing the list they pass — today's one does, and the next
  // one would only find out through a refetch on every render. Joined on a NUL
  // for the reason `repoChoiceKey` gives: it is the one byte a path cannot
  // hold, so the key is unambiguous and splits back exactly.
  const key = repoPaths.join("\u0000");
  const [byPath, setByPath] = useState<ReadonlyMap<string, WorktreeStatus>>(
    new Map(),
  );

  const load = useCallback(async () => {
    const paths = key ? key.split("\u0000") : [];
    if (paths.length === 0) {
      setByPath(new Map());
      return;
    }
    try {
      const repos = await getApiClient().listWorktreeStatus(paths);
      setByPath(
        new Map(
          repos.flatMap((repo) =>
            repo.worktrees.map((wt) => [wt.path, wt] as const),
          ),
        ),
      );
    } catch (err) {
      console.warn("[worktrees] Failed to read worktree status:", err);
    }
  }, [key]);

  useEffect(() => {
    void load();
  }, [load]);

  return { byPath, refresh: load };
}

/**
 * Whether anything in the app is pointed at a checkout.
 *
 * Three ways to be in use, because a worktree is reached by more than one name.
 * A workspace may attach it as its own path — a checkout is a tab — or as *the
 * repo at that branch*, which is what an attachment made before there were two
 * tabs of one repository says and what the main tree says when that branch is
 * what it has checked out. So the queue is joined on both. A terminal names the
 * directory itself, and is the loudest form of "someone is working here": a
 * worktree the queue has forgotten but a shell is sitting in is not unused.
 *
 * Only ever a hint on a row. What stops a delete is the backend's dirty check,
 * which is a fact about the files rather than about the app.
 */
export function useWorktreeInUse(): (
  repoPath: string,
  worktree: WorktreeStatus,
) => boolean {
  const workspaces = useSpurStore((s) => s.workspaces);
  const sessions = useSpurStore((s) => s.terminalSessions);

  return useMemo(() => {
    const { byPath } = repoHosts(workspaces);
    const attachedRefs = new Set<string>();
    for (const workspace of workspaces) {
      for (const attachment of workspace.attachments) {
        if (attachment.refName) {
          attachedRefs.add(
            repoChoiceKey(attachment.repoRoot, attachment.refName),
          );
        }
      }
    }

    return (repoPath, worktree) => {
      if (byPath.has(worktree.path)) return true;
      if (
        worktree.branch &&
        attachedRefs.has(repoChoiceKey(repoPath, worktree.branch))
      ) {
        return true;
      }
      return sessionsUnder(sessions, worktree.path).length > 0;
    };
  }, [workspaces, sessions]);
}

/**
 * The terminal sessions running inside `worktreePath` — the directory itself or
 * anything beneath it.
 *
 * The prefix needs its trailing separator, or `.../feature` would claim
 * `.../feature-2` as its own.
 */
export function sessionsUnder<T extends { cwd: string }>(
  sessions: Record<string, T>,
  worktreePath: string,
): T[] {
  return Object.values(sessions).filter(
    (session) =>
      session.cwd === worktreePath ||
      session.cwd.startsWith(`${worktreePath}/`),
  );
}
