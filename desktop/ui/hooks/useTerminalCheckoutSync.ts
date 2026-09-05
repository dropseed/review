import { useEffect, useMemo } from "react";
import { useSpurStore } from "../stores";
import { isWorktreeTab } from "../stores/selectors/workspaceData";
import type { AttachedCheckout } from "../stores/slices/terminalSlice";

/**
 * Keep the terminal checkout index in step with the branch and review listings.
 *
 * These are the only things that say a worktree appeared or vanished, so this
 * is also when a terminal whose row is gone gets rescued to one that exists.
 * The queue is in here for the same reason: a checkout a workspace has attached
 * is a place shells are started, whether or not any branch listing mentions it.
 *
 * Only the worktree tabs of it, and only their two paths — the index cares
 * about nothing else the queue holds. Subscribed as the serialized form for the
 * reason `jsonEqual` exists: the queue's array identity changes on every
 * rename, reorder and terminal landing, none of which this has an answer to.
 *
 * Mounted at the AppShell level, like `useRepoActivitySync`: the sidebar draws
 * its terminal badges on every route, and they read this index — so a repo not
 * currently on screen still has to be in it.
 */
export function useTerminalCheckoutSync() {
  const localActivity = useSpurStore((s) => s.localActivity);
  const globalReviews = useSpurStore((s) => s.globalReviews);
  const setTerminalCheckouts = useSpurStore((s) => s.setTerminalCheckouts);
  const attachedJson = useSpurStore((s) =>
    JSON.stringify(
      s.workspaces
        .flatMap((workspace) => workspace.attachments)
        .filter(
          (attachment) => isWorktreeTab(attachment) && attachment.isGitRepo,
        )
        .map(({ repoRoot, path }): AttachedCheckout => ({ repoRoot, path })),
    ),
  );

  const attached = useMemo(
    () => JSON.parse(attachedJson) as AttachedCheckout[],
    [attachedJson],
  );

  useEffect(() => {
    setTerminalCheckouts(localActivity, globalReviews, attached);
  }, [localActivity, globalReviews, attached, setTerminalCheckouts]);
}
