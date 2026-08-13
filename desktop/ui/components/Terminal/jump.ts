import { useReviewStore } from "../../stores";
import { findTabForTerminal } from "../../stores/slices/terminalSlice";
import { focusedTerminalId } from "./close";
import { needsYouQueue } from "./glance";
import { setTerminalFocus } from "./registry";

/**
 * Jumping to a terminal from anywhere — a sidebar row, an overview card, the
 * needs-you shortcut.
 *
 * There is one strip and it holds every tab, so this is only ever "show that
 * tab": no review to switch to first, and nothing that can be pointed at a tab
 * no view renders.
 */

/**
 * Bring `id`'s pane on screen and give it the keyboard: open the panel, leave
 * the overview, activate its tab and focus the pane within it.
 */
export function jumpToTerminal(id: string): void {
  const store = useReviewStore.getState();

  if (store.terminalPanelMode === "closed") store.toggleTerminalPanel();
  if (store.terminalOverviewOpen) store.setTerminalOverviewOpen(false);

  const tab = findTabForTerminal(store.terminalTabs, id);
  if (tab) {
    store.setActiveTab(tab.id);
    store.setFocusedTerminalPane(tab.id, id);
  }

  // After the panel/tab switches commit and the pane is mounted. A session
  // whose xterm doesn't exist yet just misses focus — the pane is still the one
  // on screen.
  setTimeout(() => setTerminalFocus(id, true), 50);
}

/** The same, for a noun that names a tab: its focused pane is the terminal. */
export function jumpToTab(tabId: string): void {
  const tab = useReviewStore
    .getState()
    .terminalTabs.find((t) => t.id === tabId);
  if (!tab) return;
  jumpToTerminal(tab.focused);
}

/**
 * Jump to the next terminal that needs a human, cycling from the one that has
 * focus so repeated presses walk the whole queue.
 */
export function focusNextNeedsYou(): void {
  const queue = needsYouQueue(useReviewStore.getState());
  if (queue.length === 0) return;
  const current = focusedTerminalId();
  const index = current ? queue.indexOf(current) : -1;
  jumpToTerminal(queue[(index + 1) % queue.length]);
}
