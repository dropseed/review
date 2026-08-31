import { useCallback, useEffect, useRef, useState } from "react";
import { useSpurStore } from "../stores";
import {
  getTerminalsByWorkspaceId,
  type WorkspaceTerminals,
} from "../stores/selectors/terminals";
import { useFocusedWorkspace } from "../stores/selectors/workspaces";
import { ackAttention, publishBadgeCount } from "../utils/attention";
import type { Workspace } from "../types";

/**
 * The workspaces whose attention nobody has answered yet.
 *
 * The one rule the dock badge and the auto-acknowledge below both read, so it
 * is a plain function over the two things that decide it: when a workspace last
 * raised an attention, and when its owner last looked at it. A workspace with no
 * entry in `seenAt` has never been looked at, which is exactly what a fresh
 * signal on a new card means.
 */
export function unansweredWorkspaceIds(
  workspaces: Workspace[],
  terminals: Record<string, WorkspaceTerminals>,
  seenAt: Record<string, number>,
): string[] {
  return workspaces
    .filter((workspace) => {
      const since = terminals[workspace.id]?.needsAttentionSince;
      return since != null && since > (seenAt[workspace.id] ?? 0);
    })
    .map((workspace) => workspace.id);
}

/**
 * Publish the unanswered count to the OS, and let looking at the app answer it.
 *
 * Two halves of the same rule `focusWorkspace` states for a click: looking at a
 * workspace *is* the acknowledgement. A workspace already on the stage gets no
 * second click, so a signal raised while the window is focused would otherwise
 * sit unanswered until it escalated to a phone the user is not holding. The
 * window's `focus` event is listened for as well as read, because returning to
 * the app is the other moment "I am looking at this" becomes true, and nothing
 * in the store changes when it does.
 *
 * Mounted once, at the shell.
 */
export function useAttentionBadge(): void {
  const workspaces = useSpurStore((s) => s.workspaces);
  const terminals = useSpurStore(getTerminalsByWorkspaceId);
  const seenAt = useSpurStore((s) => s.workspaceSeenAt);
  // The derived answer, not the raw id: a workspace reached by opening its repo
  // is on screen without ever having been named, and that is looking at it.
  const focused = useFocusedWorkspace();

  // The window's own focus, which no store subscription reports.
  const [focusTick, setFocusTick] = useState(0);
  const bumpFocus = useCallback(() => setFocusTick((tick) => tick + 1), []);

  useEffect(() => {
    window.addEventListener("focus", bumpFocus);
    return () => window.removeEventListener("focus", bumpFocus);
  }, [bumpFocus]);

  const unanswered = unansweredWorkspaceIds(workspaces, terminals, seenAt);
  const count = unanswered.length;
  const answerable =
    focused && unanswered.includes(focused.id) ? focused.id : null;

  useEffect(() => {
    if (!answerable || !document.hasFocus()) return;
    const store = useSpurStore.getState();
    store.markWorkspaceSeen(
      answerable,
      store.workspaces.map((entry) => entry.id),
    );
    ackAttention(answerable);
    // `focusTick` is a dependency, not a value: it is what re-runs this when
    // the window is clicked back into with the signal already standing.
  }, [answerable, focusTick]);

  // Only on a change: the badge is an OS call, and the roll-up behind `count`
  // is rebuilt on every status tick in every workspace.
  const published = useRef<number | null>(null);
  useEffect(() => {
    if (published.current === count) return;
    published.current = count;
    publishBadgeCount(count);
  }, [count]);
}
