import { toast } from "sonner";
import { getCommandUi } from "../../commands/host";
import { useReviewStore } from "../../stores";
import {
  findTabForTerminal,
  panelReviewKey,
  repoOfKey,
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

  if (store.terminalPanelMode === "closed") store.toggleTerminalPanel();
  if (store.terminalOverviewOpen) store.setTerminalOverviewOpen(false);

  const currentKey = store.repoPath
    ? panelReviewKey(store.terminalCheckouts, store.repoPath, store.reviewRef)
    : null;

  // The row this was clicked under, derived the way the sidebar derives it
  // rather than read off whichever bucket the tab happens to sit in: a session
  // whose own row is gone is drawn under its repo's root row, and its tab may
  // be stranded in a bucket no view reads.
  const homeKey = session
    ? sessionHomeKey(
        store.terminalCheckouts,
        store.terminalHomes,
        session,
        makeReviewKey(session.repoPath, ""),
      )
    : null;

  // The repo whose sidebar shows the home row — usually the session's own, but
  // a terminal dragged onto another repo's row lives under that repo now.
  const homeRepo =
    session && homeKey
      ? (repoOfKey(store.terminalCheckouts, homeKey) ?? session.repoPath)
      : null;

  // For the repo being viewed the strip is ours to fix, so the tab is put
  // where the row that was clicked will show it before anything is activated.
  if (session && homeKey && homeRepo === store.repoPath) {
    store.adoptTerminalTab(id, homeKey);
  }

  const found = findTabForTerminal(
    useReviewStore.getState().terminalTabsByReviewKey,
    id,
  );
  if (found) {
    store.setActiveTab(found.reviewKey, found.tab.id);
    store.setFocusedTerminalPane(found.reviewKey, found.tab.id, id);
  }

  if (currentKey && homeKey && session) {
    if (found && (found.tab.pinned || homeKey === currentKey)) {
      // Visible in the strip being viewed — a pinned visitor still needs the
      // *viewed* key pointed at it, since that's the key the panel reads.
      store.setActiveTab(currentKey, found.tab.id);
    } else if (homeKey !== currentKey && homeRepo) {
      const ref = refFromReviewKey(homeKey, homeRepo);
      if (ref) {
        getCommandUi().activateReviewKey(homeRepo, ref);
      } else {
        // The placeholder `repoPath:""` key — the repo's checkouts aren't
        // known, so there is no row to switch to and nothing more this can do.
        // Saying so beats a click that looks like it did nothing.
        toast.error("Couldn't find the row that terminal lives on");
      }
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
