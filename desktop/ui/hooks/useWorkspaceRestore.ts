import { useEffect, useRef, useState } from "react";
import { useReviewStore } from "../stores";
import { useFocusedWorkspace } from "../stores/selectors/workspaces";
import {
  focusWorkspace,
  targetForAttachment,
} from "../commands/workspaceCommands";
import { restoreDecision } from "./workspace-restore";
import type { RepoStatus } from "./useRepositoryInit";
import type { ReviewTarget } from "../stores/selectors/workspaceData";
import type { Workspace } from "../types";

/**
 * How long the restore waits for the sidebar to learn the workspace's repo
 * before showing the workspace anyway.
 *
 * The rows are what turn an attachment into a comparison (`targetForAttachment`
 * asks for one), and they arrive from a different load than the queue does —
 * a git pass over every registered repo, against a JSON file and a socket. The
 * wait exists so a slow disk doesn't cost the diff; the bound exists because
 * the answer may honestly be "that branch is gone", and there is no event for
 * that.
 */
const ROW_WAIT_MS = 10_000;

/**
 * The stage comes back to the workspace it was showing.
 *
 * A relaunch used to keep everything *except* which workspace you were in: the
 * queue, the terminals and the review state are all on disk, but the focus is
 * derived — from the comparison on screen — and a cold start has no comparison
 * to derive it from. So the app came up with no workspace on the stage: a repo
 * tab bar with no tabs in it, and a terminal strip showing none of the shells
 * still running in the daemon. Switching to any other workspace and back fixed
 * it, which is exactly the shape of a thing that was never restored.
 *
 * Both halves live here because they are one sentence: the focused workspace is
 * remembered as it changes, and read back once on launch. The memory is a
 * preference — a fact about this window's last session, like the panel widths
 * beside it — and never `work.json`, which says what the work *is*.
 *
 * The restore is deliberately timid. Anything else that reaches the stage first
 * wins outright, and a comparison already open — a URL, a `review` invocation,
 * the directory the app was launched from — keeps the screen it asked for; the
 * restore then only takes the focus back, so the tabs are the workspace's own.
 */
export function useWorkspaceRestore(repoStatus: RepoStatus): void {
  const workspaces = useReviewStore((s) => s.workspaces);
  const focused = useFocusedWorkspace();
  const activeReviewKey = useReviewStore((s) => s.activeReviewKey);
  const lastWorkspaceId = useReviewStore((s) => s.lastWorkspaceId);
  const rememberLastWorkspace = useReviewStore((s) => s.rememberLastWorkspace);
  // A tick from the two loads that build the sidebar's rows, not the rows
  // themselves — what they carry is asked for through `targetForAttachment`,
  // and this only has to re-ask once either of them lands. Counted rather than
  // subscribed to whole: this hook is mounted on the app shell, and holding
  // either list would re-render it on every working-tree delta for a value the
  // restore stops reading a second after launch.
  const rowSources = useReviewStore(
    (s) => s.localActivity.length + s.globalReviews.length,
  );

  // Never null: a workspace closing is not the app forgetting where it was, and
  // the id is checked against the queue on the way back in anyway.
  useEffect(() => {
    if (focused) rememberLastWorkspace(focused.id);
  }, [focused, rememberLastWorkspace]);

  const settled = useRef(false);
  // The one tick nothing else produces — see `ROW_WAIT_MS`.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => {
      // Nothing to wake for once the restore has run: this is the app shell.
      if (!settled.current) setExpired(true);
    }, ROW_WAIT_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (settled.current) return;

    const decision = restoreDecision({
      lastWorkspaceId,
      workspaces,
      focused,
      hasComparison: activeReviewKey !== null,
      initSettled: repoStatus !== "loading",
      target: openableTarget(workspaces, lastWorkspaceId),
      expired,
    });

    if (decision.kind === "wait") return;
    settled.current = true;
    if (decision.kind === "done") return;

    if (decision.kind === "focus") {
      const store = useReviewStore.getState();
      store.setFocusedWorkspace(decision.workspace.id);
      store.selectWorkspaceTab(decision.workspace.id);
      return;
    }

    // `focusWorkspace` resolves its own target when none is given, which is the
    // right fallback for a workspace with nothing openable: it lands on the
    // empty state rather than leaving the stage on nobody's workspace.
    focusWorkspace(decision.workspace, decision.target ?? undefined);
  }, [
    repoStatus,
    lastWorkspaceId,
    workspaces,
    focused,
    activeReviewKey,
    expired,
    rowSources,
  ]);
}

/**
 * The comparison a restored workspace opens: its first attachment the sidebar
 * can resolve.
 *
 * The *first resolvable* one, where a click on the workspace takes the first
 * one flat — a relaunch is the moment when half the tabs may not have rows yet,
 * and falling through to the empty stage because tab one is still loading would
 * hide a workspace whose second repo was ready all along.
 */
function openableTarget(
  workspaces: readonly Workspace[],
  id: string | null,
): ReviewTarget | null {
  const workspace = workspaces.find((entry) => entry.id === id);
  if (!workspace) return null;
  for (const attachment of workspace.attachments) {
    const target = targetForAttachment(attachment);
    if (target) return target;
  }
  return null;
}
