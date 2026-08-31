import { useSpurStore } from "../../stores";
import {
  findTabForTerminal,
  tabWorkspaceId,
} from "../../stores/slices/terminalSlice";
import { focusWorkspace } from "../../commands/workspaceCommands";
import { focusedTerminalId } from "./close";
import { needsYouQueue } from "./glance";
import { setTerminalFocus } from "./registry";

/**
 * Jumping to a terminal from anywhere — a queue card's child row, a ⌘K
 * terminal row, the needs-you shortcut.
 *
 * The panel shows **one workspace's** tabs, not every tab, so "show that tab"
 * is two steps and the first one is not optional: activating a tab that lives
 * in a workspace the stage isn't showing left the panel rendering nothing — the
 * active id pointed at a tab the strip had filtered out. Every jump therefore
 * focuses the tab's workspace first.
 */

/**
 * Bring `id`'s pane on screen and give it the keyboard: focus its workspace,
 * open the panel, activate its tab and focus the pane within it.
 */
export function jumpToTerminal(id: string): void {
  const store = useSpurStore.getState();

  const tab = findTabForTerminal(store.terminalTabs, id);

  // Every route onto the stage has to leave the terminals-only row, and this
  // is the one `focusWorkspace` can't cover: the workspace below is focused
  // only when it isn't already, so jumping to a terminal in the workspace you
  // are on would otherwise select its tab behind an overview still covering
  // the stage — a click that visibly does nothing.
  if (store.terminalOverview) store.setTerminalOverview(false);

  // Before the tab is activated, because focusing a workspace selects that
  // workspace's own remembered tab — doing it after would immediately point
  // the panel somewhere else.
  const workspaceId = tab ? tabWorkspaceId(store, tab) : null;
  if (workspaceId && workspaceId !== store.focusedWorkspaceId) {
    const workspace = store.workspaces.find((w) => w.id === workspaceId);
    if (workspace) focusWorkspace(workspace);
  }

  if (useSpurStore.getState().contentFocus === "code") {
    useSpurStore.getState().toggleTerminalPanel();
  }

  if (tab) {
    const latest = useSpurStore.getState();
    latest.setActiveTab(tab.id);
    latest.setFocusedTerminalPane(tab.id, id);
  }

  // After the panel/tab switches commit and the pane is mounted. A session
  // whose xterm doesn't exist yet just misses focus — the pane is still the one
  // on screen.
  setTimeout(() => setTerminalFocus(id, true), 50);
}

/** The same, for a noun that names a tab: its focused pane is the terminal. */
export function jumpToTab(tabId: string): void {
  const tab = useSpurStore.getState().terminalTabs.find((t) => t.id === tabId);
  if (!tab) return;
  jumpToTerminal(tab.focused);
}

/**
 * Jump to the next terminal that needs a human, cycling from the one that has
 * focus so repeated presses walk the whole queue.
 */
export function focusNextNeedsYou(): void {
  const queue = needsYouQueue(useSpurStore.getState());
  if (queue.length === 0) return;
  const current = focusedTerminalId();
  const index = current ? queue.indexOf(current) : -1;
  jumpToTerminal(queue[(index + 1) % queue.length]);
}
