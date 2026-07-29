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

/** The tab holding the focused pane, with the review key that owns it. */
export function focusedTerminalTab(): {
  terminalId: string;
  tab: TerminalTab;
  reviewKey: string;
} | null {
  const terminalId = focusedTerminalId();
  if (!terminalId) return null;
  const found = findTabForTerminal(
    useReviewStore.getState().terminalTabsByReviewKey,
    terminalId,
  );
  return found ? { terminalId, ...found } : null;
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

/** Close one pane, asking first if its shell is running something. */
export async function closeTerminalPane(id: string): Promise<boolean> {
  if (!(await confirmKill([id]))) return false;
  teardown(id);
  return true;
}

/** Close every pane in a tab, asking once for all of them. */
export async function closeTerminalTab(tab: TerminalTab): Promise<boolean> {
  const ids = collectLeafIds(tab.root);
  if (!(await confirmKill(ids))) return false;
  for (const id of ids) teardown(id);
  return true;
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
