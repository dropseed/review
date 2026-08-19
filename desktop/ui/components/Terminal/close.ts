/**
 * Closing a terminal, from every entrance that can do it: the pane ×, the tab
 * ×, and ⌘W. They share one implementation so the confirmation for a busy
 * shell can't be attached to some of them and not the others.
 */

import { getPlatformServices } from "../../platform";
import { useReviewStore } from "../../stores";
import {
  findTab,
  findTabForTerminal,
  tabWorkspaceId,
} from "../../stores/slices/terminalSlice";
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
  const state = useReviewStore.getState();
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
    useReviewStore.getState();
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
