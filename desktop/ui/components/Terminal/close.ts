/**
 * Closing a terminal, from every entrance that can do it: the pane ×, the tab
 * ×, and ⌘W. They share one implementation so the confirmation for a running
 * command can't be attached to some of them and not the others.
 */

import { getPlatformServices } from "../../platform";
import { useReviewStore } from "../../stores";
import { findTabForTerminal } from "../../stores/slices/terminalSlice";
import { collectLeafIds, type TerminalTab } from "./pane-tree";
import { disposeTerminal } from "./registry";

/**
 * The terminal pane that currently has keyboard focus, if any.
 *
 * Found through the `data-terminal-id` each pane carries rather than a ref the
 * panel would have to publish — the panes are the things that can be focused,
 * so they're the thing to ask.
 */
export function focusedTerminalId(): string | null {
  const pane =
    document.activeElement?.closest<HTMLElement>("[data-terminal-id]");
  return pane?.dataset.terminalId ?? null;
}

/** The tab holding the focused pane. */
export function focusedTerminalTab(): {
  terminalId: string;
  tab: TerminalTab;
} | null {
  const terminalId = focusedTerminalId();
  if (!terminalId) return null;
  const tab = findTabForTerminal(
    useReviewStore.getState().terminalTabs,
    terminalId,
  );
  return tab ? { terminalId, tab } : null;
}

/**
 * The commands running in `ids`, named. A session sitting at its prompt has no
 * running command, which is what keeps the confirmation off the common path.
 */
function runningCommands(ids: string[]): { title: string; command: string }[] {
  const { terminalStatuses, terminalSessions, terminalExited } =
    useReviewStore.getState();
  const out: { title: string; command: string }[] = [];
  for (const id of ids) {
    if (id in terminalExited) continue;
    const command = terminalStatuses[id]?.runningCommand;
    if (!command) continue;
    const session = terminalSessions[id];
    out.push({
      title: terminalStatuses[id]?.title || session?.title || "shell",
      command,
    });
  }
  return out;
}

/**
 * Ask before killing shells that are mid-command. Naming the command is the
 * whole point — "close this terminal?" is a question the user can't answer, and
 * "zsh is running `npm test`" is one they can.
 */
async function confirmKill(ids: string[]): Promise<boolean> {
  const running = runningCommands(ids);
  if (running.length === 0) return true;
  const { dialogs } = getPlatformServices();
  const lines = running.map((r) => `${r.title} is running \`${r.command}\``);
  // A dialog that fails to open answers false and says so itself — see
  // DialogService.confirm. Declining is right either way: closing would kill
  // the running command without ever asking.
  return dialogs.confirm(
    `${lines.join("\n")}\n\nClosing ${
      running.length === 1 ? "it" : "them"
    } will kill the command. Close anyway?`,
    running.length === 1 ? "Terminal is busy" : "Terminals are busy",
  );
}

/**
 * Drop a workspace whose last terminal just went away, when there is nothing
 * in it a person authored.
 *
 * "Nothing authored" is precisely: no typed title, and at most one attachment.
 * Such a workspace says only what its own repo already says, so re-opening that
 * repo — or starting another shell in it — mints an identical one, and leaving
 * it behind turns the queue into a list of finished things. A typed title or a
 * second repo is a person having built something here, and neither is ever
 * reaped: removal stays theirs.
 *
 * This is the *event* half of cleanup, and deliberately not a rule
 * `work::cleanup` could carry — a passive sweep with this predicate would also
 * reap the branch a person queued up to read later and never ran anything in.
 * Closing the terminal is what says the workspace is spent.
 *
 * `closing` is what is on its way out, named rather than waited for: "is
 * anything left in here" answered by excluding those ids holds whether or not
 * the teardown has reached the store yet, so this never rests on `killTerminal`
 * happening to drop its session before it resolves.
 */
async function reapSpentWorkspace(
  workspaceId: string,
  closing: readonly string[],
): Promise<void> {
  const state = useReviewStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return;
  if (workspace.title !== null || workspace.attachments.length > 1) return;
  const survivor = Object.values(state.terminalSessions).some(
    (session) =>
      session.workspaceId === workspaceId && !closing.includes(session.id),
  );
  if (survivor) return;
  await state.removeWorkspace(workspaceId);
}

/** Tear down one pane locally, killing its PTY unless it is already dead. */
function teardown(id: string): void {
  const { terminalExited, removeTerminal, killTerminal } =
    useReviewStore.getState();
  // Update store state first so the pane unmounts (and unsubscribes from
  // output), THEN dispose the xterm — deferred to the next macrotask so the
  // React unmount has committed. Disposing synchronously here would tear down
  // the terminal while the pane is still mounted and PTY output could still
  // arrive at it (the pane's write is also guarded, defense in depth).
  const scheduleDispose = () => setTimeout(() => disposeTerminal(id), 0);
  if (id in terminalExited) {
    removeTerminal(id);
    scheduleDispose();
  } else {
    void killTerminal(id).finally(scheduleDispose);
  }
}

/** One pane. */
export async function closeTerminalPane(id: string): Promise<boolean> {
  return closeTerminals([id]);
}

/**
 * Close a set of panes, asking once for all of them — what a menu verb aimed
 * at a noun holding several terminals runs.
 */
export async function closeTerminals(ids: string[]): Promise<boolean> {
  if (!(await confirmKill(ids))) return false;
  // Read the attributions before the teardown drops the sessions that carry
  // them: after this, nothing left in the store can say where these ran.
  const { terminalSessions } = useReviewStore.getState();
  const workspaceIds = new Set(
    ids
      .map((id) => terminalSessions[id]?.workspaceId)
      .filter((id): id is string => id != null),
  );
  for (const id of ids) teardown(id);
  // Serially, and not because it is slow: `removeWorkspace` takes the backend's
  // whole-queue answer as truth, so two in flight at once each return a
  // snapshot missing only their own removal and the loser resurrects the other.
  for (const workspaceId of workspaceIds) {
    await reapSpentWorkspace(workspaceId, ids);
  }
  return true;
}

/** Close every pane in a tab, asking once for all of them. */
export async function closeTerminalTab(tab: TerminalTab): Promise<boolean> {
  return closeTerminals(collectLeafIds(tab.root));
}

/**
 * ⌘W inside a terminal closes that pane — and the tab with it, when it was the
 * last one. Returns whether it handled the keystroke, so the caller can fall
 * through to closing the split, the file, or the window.
 */
export async function closeFocusedTerminal(): Promise<boolean> {
  const focused = focusedTerminalTab();
  if (!focused) return false;
  await closeTerminalPane(focused.terminalId);
  // Handled either way: a declined confirmation means "don't close this", not
  // "close my window instead".
  return true;
}

/**
 * Remove a workspace, killing the terminals in it — the "Remove" verb on a
 * card, from every entrance that offers it.
 *
 * The mirror of `reapSpentWorkspace`: there the last terminal going away takes
 * the workspace with it, here the workspace going away takes its terminals. A
 * card is the only place its shells are reachable from — the strip, the card's
 * rows and the overview all group by the daemon's `workspaceId` — so a removal
 * that left them running would leave them running *invisibly*, still holding
 * whatever they were doing, findable only from the CLI.
 *
 * Which is why this asks first, and asks with the terminals named: the card
 * says how many shells are in it, but not that removing it ends them.
 * Confirmation is skipped when there is nothing live to lose, so removing a
 * dormant card stays the single click it is today.
 */
export async function removeWorkspaceAndTerminals(
  workspaceId: string,
): Promise<boolean> {
  const state = useReviewStore.getState();
  // The daemon's attribution, not the tab list's: a session the store knows
  // about but no tab is drawing is still a shell this card is responsible for.
  const ids = Object.values(state.terminalSessions)
    .filter((session) => session.workspaceId === workspaceId)
    .map((session) => session.id);
  const title =
    state.workspaces.find((entry) => entry.id === workspaceId)?.displayTitle ??
    "this workspace";
  if (!(await confirmRemove(title, ids))) return false;
  for (const id of ids) teardown(id);
  await state.removeWorkspace(workspaceId);
  return true;
}

/**
 * Ask before a removal that ends running shells, naming what it would end.
 *
 * Sessions that have already exited are torn down without a word — their panes
 * are a dead terminal's remains, and a dialog about closing them is a question
 * with one answer. A card with nothing live in it is removed silently.
 */
async function confirmRemove(title: string, ids: string[]): Promise<boolean> {
  const { terminalStatuses, terminalSessions, terminalExited } =
    useReviewStore.getState();
  const live = ids.filter((id) => !(id in terminalExited));
  if (live.length === 0) return true;
  const lines = live.map((id) => {
    const name =
      terminalStatuses[id]?.title || terminalSessions[id]?.title || "shell";
    const command = terminalStatuses[id]?.runningCommand;
    return command ? `${name} is running \`${command}\`` : name;
  });
  const { dialogs } = getPlatformServices();
  // A dialog that fails to open answers false and says so itself — see
  // DialogService.confirm. Declining is right either way: removing would kill
  // these shells without ever asking.
  return dialogs.confirm(
    `Removing ${title} will kill ${
      live.length === 1 ? "its terminal" : `its ${live.length} terminals`
    }:\n${lines.join("\n")}\n\nRemove it?`,
    live.length === 1 ? "Terminal is still open" : "Terminals are still open",
  );
}
