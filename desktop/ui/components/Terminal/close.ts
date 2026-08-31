/**
 * Closing a terminal, from every entrance that can do it: the pane ×, the tab
 * ×, and ⌘W. They share one implementation so the confirmation for a busy
 * shell can't be attached to some of them and not the others.
 */

import { toast } from "sonner";
import { getPlatformServices } from "../../platform";
import { useSpurStore } from "../../stores";
import {
  findTab,
  findTabForTerminal,
  tabWorkspaceId,
} from "../../stores/slices/terminalSlice";
import { collectLeafIds, type TerminalTab } from "./pane-tree";
import type { Workspace } from "../../types";
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
    useSpurStore.getState().terminalTabs,
    terminalId,
  );
  return tab ? { terminalId, tab } : null;
}

/**
 * Whether the keyboard is anywhere in the terminal panel — a pane, or the
 * chrome around it: a tab in the strip, the "+", the focus toggle.
 *
 * Wider than `focusedTerminalId` on purpose. Clicking a tab or a pane's own
 * buttons is not leaving the terminal, but it does move `document.activeElement`
 * out of the pane, and a rule that read the pane alone made ⌘W stop meaning
 * "close this shell" the moment you touched the panel's own controls.
 */
function focusWithinTerminalPanel(): boolean {
  const active = document.activeElement;
  return (
    active instanceof Element &&
    active.closest("[data-terminal-panel]") !== null
  );
}

/**
 * The pane ⌘W means when nothing inside a terminal holds the keyboard.
 *
 * DOM focus is a poor witness for "what am I working in". It lands on `body`
 * when a dialog closes, when the ⌘K palette dismisses, when a click hits any
 * chrome that isn't focusable — and it sits in the sidebar for as long as it
 * takes to read a workspace card. None of that is the user leaving the shell,
 * yet each one used to send ⌘W past the terminal to close the diff, the file,
 * or — with nothing else left in the cascade — the window itself.
 *
 * So the panel is asked what it is showing, the same way ⌘T asks the focused
 * workspace where to start a shell rather than asking where the caret is. The
 * one thing that still decides against the terminal is the *code* holding the
 * content region: there the diff and its file are the nouns ⌘W is for. In the
 * shared view both are on screen and neither can claim the keystroke on layout
 * alone, so focus arbitrates — the panel's own chrome counts, anything else
 * falls through.
 */
function shownTerminalPane(): string | null {
  const state = useSpurStore.getState();
  // The overview draws every workspace's tabs at once, with a × on each card.
  // "The one the panel is showing" has no answer there, and guessing at one
  // would kill a shell the user never pointed at.
  if (state.terminalOverview) return null;
  if (state.contentFocus === "code") return null;
  if (state.contentFocus === "split" && !focusWithinTerminalPanel())
    return null;

  const tab = state.activeTabId
    ? findTab(state.terminalTabs, state.activeTabId)
    : null;
  if (!tab) return null;
  // The strip shows one workspace's tabs, so an active tab belonging to another
  // one is drawing nothing (see `showingTabId` in TerminalPanel) — closing it
  // would be closing a terminal that is not on screen.
  const workspaceId = tabWorkspaceId(state, tab);
  if (workspaceId !== null && workspaceId !== state.focusedWorkspaceId) {
    return null;
  }
  return tab.focused;
}

/**
 * The sessions in `ids` that still have something going on, said in words.
 *
 * Two ways to look busy, in the order they are worth reporting. A named
 * foreground command is the good answer: the poller resolves one for every
 * session that isn't sitting at its prompt, agents included (`claude` is a
 * running command like any other). A `working` phase with no name is the same
 * fact with the name missing — `ps` didn't report the process group, or the
 * session hasn't been polled yet — and it used to close in silence, which is
 * the one shape of this question you can't afford to get wrong.
 *
 * `waiting_for_input` and `idle` are a prompt, not work, and `needs_attention`
 * on its own is a bell — zsh rings one at every ambiguous completion, so asking
 * on it would put a dialog in front of the common case.
 */
function busyReasons(ids: string[]): string[] {
  const { terminalStatuses, terminalSessions, terminalExited } =
    useSpurStore.getState();
  const reasons: string[] = [];
  for (const id of ids) {
    if (id in terminalExited) continue;
    const status = terminalStatuses[id];
    if (!status) continue;
    const name = status.title || terminalSessions[id]?.title || "shell";
    if (status.runningCommand) {
      reasons.push(`${name} is running \`${status.runningCommand}\``);
    } else if (status.phase === "working") {
      reasons.push(`${name} is still working`);
    }
  }
  return reasons;
}

/**
 * Ask before killing shells that are mid-command. Naming the command is the
 * whole point — "close this terminal?" is a question the user can't answer, and
 * "zsh is running `npm test`" is one they can.
 */
async function confirmKill(ids: string[]): Promise<boolean> {
  const reasons = busyReasons(ids);
  if (reasons.length === 0) return true;
  const { dialogs } = getPlatformServices();
  // A dialog that fails to open answers false and says so itself — see
  // DialogService.confirm. Declining is right either way: closing would kill
  // the running command without ever asking.
  return dialogs.confirm(
    `${reasons.join("\n")}\n\nClosing ${
      reasons.length === 1 ? "it" : "them"
    } will kill what is running. Close anyway?`,
    reasons.length === 1 ? "Terminal is busy" : "Terminals are busy",
  );
}

/**
 * Drop a workspace whose last terminal just went away, when there is nothing
 * in it a person authored.
 *
 * "Nothing authored" is precisely: no typed title, at most one attachment, and
 * nothing nested under it. Such a workspace says only what its own repo already
 * says, so re-opening that repo — or starting another shell in it — mints an
 * identical one, and leaving it behind turns the queue into a list of finished
 * things. A typed title, a second repo, or a sub-workspace is a person having
 * built something here, and none of them is ever reaped: removal stays theirs.
 *
 * This is the *event* half of cleanup, and deliberately not a rule
 * `workspace::cleanup` could carry — a passive sweep with this predicate would also
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
  const state = useSpurStore.getState();
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return;
  if (workspace.title !== null || workspace.attachments.length > 1) return;
  // Something is nested under it: the card is a group somebody built, whatever
  // its own title and repo say.
  if (state.workspaces.some((entry) => entry.parentId === workspaceId)) return;
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
    useSpurStore.getState();
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

/**
 * How long a closed terminal can be brought back before its shell is really
 * killed. Ghostty's `undo-timeout` default, and the same idea: the pane leaves
 * the screen at once, the process goes a moment later.
 */
export const UNDO_CLOSE_TIMEOUT_MS = 5000;

/** A close that has left the screen but not yet reached the daemon. */
interface PendingClose {
  /** The sessions on their way out. */
  ids: string[];
  /** The tabs they were drawn in, as they were — what undo puts back. */
  tabs: TerminalTab[];
  /** The kill, and whatever is meant to follow it. */
  finalize: () => Promise<void>;
  timer: ReturnType<typeof setTimeout>;
}

/** Closes still inside their undo window, oldest first. */
const pendingCloses: PendingClose[] = [];

/** Whether ⌘⇧T has anything to bring back. */
export function hasPendingClose(): boolean {
  return pendingCloses.length > 0;
}

/**
 * Close `ids` in a way that can be undone for a few seconds.
 *
 * The panes leave the strip now — the close has to *look* done, or it isn't
 * one — but the shells keep running, unlisted, until the window lapses. That
 * is what makes undo cheap and faithful: nothing is restarted, so the
 * scrollback, the running command, and the daemon's own record of the session
 * all come back exactly as they were. Sessions that already exited have
 * nothing to keep alive and are torn down at once.
 *
 * `after` runs once the kills have gone through — cleanup that would be wrong
 * to do while the shells might still come back, such as reaping the workspace
 * they were the last thing in.
 */
function deferClose(ids: string[], after: () => Promise<void>): void {
  const state = useSpurStore.getState();
  const live = ids.filter((id) => !(id in state.terminalExited));
  for (const id of ids) {
    if (!live.includes(id)) teardown(id);
  }

  // The tabs holding these panes, before they lose them. Snapshotted whole
  // so a closed split comes back as a split.
  const tabs: TerminalTab[] = [];
  for (const id of live) {
    const tab = findTabForTerminal(state.terminalTabs, id);
    if (tab && !tabs.some((entry) => entry.id === tab.id)) tabs.push(tab);
  }
  for (const id of live) state.hideTerminal(id);

  const pending: PendingClose = {
    ids: live,
    tabs,
    finalize: async () => {
      for (const id of live) teardown(id);
      await after();
    },
    timer: setTimeout(() => {
      void settle(pending);
    }, UNDO_CLOSE_TIMEOUT_MS),
  };
  pendingCloses.push(pending);

  if (live.length > 0) {
    toast(
      live.length === 1 ? "Closed terminal" : `Closed ${live.length} terminals`,
      {
        duration: UNDO_CLOSE_TIMEOUT_MS,
        action: {
          label: "Undo",
          onClick: () => {
            undoClose(pending);
          },
        },
      },
    );
  } else {
    // Nothing was alive to hold on to: the close is already complete.
    void settle(pending);
  }
}

/** Let a pending close through: kill the shells and run what follows. */
async function settle(pending: PendingClose): Promise<void> {
  const index = pendingCloses.indexOf(pending);
  if (index === -1) return;
  pendingCloses.splice(index, 1);
  clearTimeout(pending.timer);
  await pending.finalize();
}

/** Bring a pending close back, tabs and all. */
function undoClose(pending: PendingClose): void {
  const index = pendingCloses.indexOf(pending);
  if (index === -1) return;
  pendingCloses.splice(index, 1);
  clearTimeout(pending.timer);
  useSpurStore.getState().restoreTerminalTabs(pending.tabs);
}

/**
 * Reopen the most recently closed terminal — ⌘⇧T, and the toast's Undo.
 * Answers whether there was one to reopen.
 */
export function undoCloseTerminal(): boolean {
  const pending = pendingCloses[pendingCloses.length - 1];
  if (!pending) return false;
  undoClose(pending);
  return true;
}

/**
 * Let every pending close through now. For the paths that end this window —
 * a close that is still holding its shell for undo when the window goes
 * would leave that shell running with nothing to bring it back.
 */
export async function flushPendingCloses(): Promise<void> {
  while (pendingCloses.length > 0) {
    await settle(pendingCloses[pendingCloses.length - 1]);
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
  const { terminalSessions } = useSpurStore.getState();
  const workspaceIds = new Set(
    ids
      .map((id) => terminalSessions[id]?.workspaceId)
      .filter((id): id is string => id != null),
  );
  // The reap waits for the kill: a workspace whose last terminal is still
  // inside its undo window is not spent yet.
  deferClose(ids, async () => {
    // Serially, and not because it is slow: `removeWorkspace` takes the
    // backend's whole-queue answer as truth, so two in flight at once each
    // return a snapshot missing only their own removal and the loser
    // resurrects the other.
    for (const workspaceId of workspaceIds) {
      await reapSpentWorkspace(workspaceId, ids);
    }
  });
  return true;
}

/** Close every pane in a tab, asking once for all of them. */
export async function closeTerminalTab(tab: TerminalTab): Promise<boolean> {
  return closeTerminals(collectLeafIds(tab.root));
}

/**
 * ⌘W over a terminal closes that pane — and the tab with it, when it was the
 * last one. Returns whether it handled the keystroke, so the caller can fall
 * through to closing the split, the file, or the window.
 *
 * "Over a terminal" is the pane with the keyboard, and failing that the pane
 * the panel is showing — see `shownTerminalPane` for why the second one is not
 * a fallback so much as the honest question.
 */
export async function closeFocusedTerminal(): Promise<boolean> {
  const target = focusedTerminalId() ?? shownTerminalPane();
  if (!target) return false;
  await closeTerminalPane(target);
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
  const asked = useSpurStore.getState();
  const title =
    asked.workspaces.find((entry) => entry.id === workspaceId)?.displayTitle ??
    "this workspace";

  // What goes with it is the human's call, and it is asked before anything
  // else: whether the sub-workspaces are coming decides which terminals are
  // even at stake, so the "these shells will die" prompt cannot be written
  // until it is answered.
  const scope = await chooseRemovalScope(
    title,
    descendantsOf(asked.workspaces, workspaceId),
  );
  if (scope === null) return false;

  // Read again, because a dialog is modal to the person and to nothing else:
  // an agent's `spur terminal start` — or another window — can land a
  // session in this subtree while one is open. A session missing from `ids`
  // is a shell that survives the only card it was reachable from, which is
  // the exact thing this function exists to prevent.
  const state = useSpurStore.getState();
  const going =
    scope === "subtree"
      ? [workspaceId, ...descendantsOf(state.workspaces, workspaceId)]
      : [workspaceId];
  // The daemon's attribution, not the tab list's: a session the store knows
  // about but no tab is drawing is still a shell this card is responsible for.
  const ids = Object.values(state.terminalSessions)
    .filter((session) => going.includes(session.workspaceId ?? ""))
    .map((session) => session.id);
  if (!(await confirmRemove(title, ids))) return false;
  for (const id of ids) teardown(id);
  await state.removeWorkspace(workspaceId, scope === "subtree");
  return true;
}

/** Every workspace nested under `workspaceId`, at any depth, in queue order. */
function descendantsOf(
  workspaces: readonly Workspace[],
  workspaceId: string,
): string[] {
  const inside = new Set([workspaceId]);
  // One pass is enough: the queue arrives in tree order, so a parent is always
  // seen before its children.
  const found: string[] = [];
  for (const entry of workspaces) {
    if (entry.parentId && inside.has(entry.parentId)) {
      inside.add(entry.id);
      found.push(entry.id);
    }
  }
  return found;
}

/**
 * What a removal takes: the card alone, the card and everything under it, or
 * nothing because the answer was no.
 */
type RemovalScope = "one" | "subtree";

/**
 * Ask what a removal should take when the card has workspaces nested under it.
 *
 * A card with nothing under it never sees this — there is nothing to decide,
 * and the terminal prompt below is the only question a removal has ever asked.
 * Neither answer is safe enough to be the default: taking the sub-workspaces
 * silently removes work that was never looked at, and leaving them silently
 * empties a group the person thought they were clearing. So this is two
 * questions rather than a guess, and declining the second one cancels.
 */
async function chooseRemovalScope(
  title: string,
  nested: readonly string[],
): Promise<RemovalScope | null> {
  if (nested.length === 0) return "one";
  const { dialogs } = getPlatformServices();
  const count = `${nested.length} ${nested.length === 1 ? "workspace" : "workspaces"}`;
  const takeAll = await dialogs.confirm(
    `${title} has ${count} nested under it.\n\nRemove those too, or keep them and move them up a level?`,
    "Remove nested workspaces?",
    { ok: `Remove all ${nested.length + 1}`, cancel: "Keep them" },
  );
  if (takeAll) return "subtree";
  // Declining to take them is not declining the removal — it is the other
  // removal, so it still gets asked rather than assumed.
  const keepThem = await dialogs.confirm(
    `Remove ${title} on its own? The ${count} under it move up a level and stay in the queue.`,
    "Remove this workspace?",
    { ok: "Remove", cancel: "Cancel" },
  );
  return keepThem ? "one" : null;
}

/**
 * Ask before a removal that ends running shells, naming what it would end.
 *
 * Sessions that have already exited are torn down without a word — their panes
 * are a dead terminal's remains, and a dialog about closing them is a question
 * with one answer. A card with nothing live in it is removed silently.
 */
async function confirmRemove(
  title: string,
  ids: readonly string[],
): Promise<boolean> {
  const { terminalStatuses, terminalSessions, terminalExited } =
    useSpurStore.getState();
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
