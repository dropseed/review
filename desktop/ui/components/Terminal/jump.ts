import { getCommandUi } from "../../commands/host";
import { useReviewStore } from "../../stores";
import {
  findTabForTerminal,
  panelReviewKey,
  sessionHomeKey,
} from "../../stores/slices/terminalSlice";
import { makeReviewKey, refFromReviewKey } from "../../utils/review-key";
import { focusedTerminalId } from "./close";
import { needsYouQueue } from "./glance";
import { setTerminalFocus } from "./registry";

/**
 * Jumping to a terminal from anywhere — an overview card, the needs-you
 * shortcut — regardless of which review row it lives under.
 */

/**
 * Bring `id`'s pane on screen and give it the keyboard: open the panel, leave
 * the overview, activate its tab, and — when its tab lives under a row other
 * than the one being viewed and isn't pinned into every strip — activate that
 * row the way clicking it in the sidebar would.
 */
export function jumpToTerminal(id: string): void {
  const store = useReviewStore.getState();
  const session = store.terminalSessions[id];
  const found = findTabForTerminal(store.terminalTabsByReviewKey, id);

  if (store.terminalPanelMode === "closed") store.toggleTerminalPanel();
  if (store.terminalOverviewOpen) store.setTerminalOverviewOpen(false);

  if (found) {
    store.setActiveTab(found.reviewKey, found.tab.id);
    store.setFocusedTerminalPane(found.reviewKey, found.tab.id, id);
  }

  const currentKey = store.repoPath
    ? panelReviewKey(store.terminalCheckouts, store.repoPath, store.reviewRef)
    : null;

  // Where the session lives. A session in a repo this window hasn't opened has
  // no tab here at all (it's merged in for badges only), so its home is
  // derived the same way its sidebar row derives it.
  const homeKey = found
    ? found.reviewKey
    : session
      ? sessionHomeKey(
          store.terminalCheckouts,
          store.terminalHomes,
          session,
          makeReviewKey(session.repoPath, ""),
        )
      : null;

  if (currentKey && homeKey) {
    if (found && (found.tab.pinned || homeKey === currentKey)) {
      // Visible in the strip being viewed — a pinned visitor still needs the
      // *viewed* key pointed at it, since that's the key the panel reads.
      store.setActiveTab(currentKey, found.tab.id);
    } else if (homeKey !== currentKey && session) {
      const ref = refFromReviewKey(homeKey, session.repoPath);
      if (ref) getCommandUi().activateReviewKey(session.repoPath, ref);
    }
  }

  // After the panel/tab/row switches commit and the pane is mounted. A session
  // whose xterm doesn't exist yet (cross-repo jump, still loading) just misses
  // focus — the pane is still the one on screen.
  setTimeout(() => setTerminalFocus(id, true), 50);
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
