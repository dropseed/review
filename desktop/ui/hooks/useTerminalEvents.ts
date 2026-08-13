import { useEffect } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { installTerminalWindowFocus } from "../components/Terminal/window-focus";

/**
 * Mounted once at the app shell — beside the panel it feeds, and for the same
 * reason: a status stream that unsubscribed when you left the review would
 * leave the tab strip showing phases from whenever you last had one open.
 *
 * Probes terminal support, hydrates panel prefs, loads any pre-existing
 * sessions, and keeps the store's status map fresh via the global status
 * roll-up. Modeled on useFileWatcher.
 */
export function useTerminalEvents(): void {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const terminalsSupported = useReviewStore((s) => s.terminalsSupported);

  // One window-level pair for every pane — the focused terminal is whichever
  // one holds DOM focus, which the registry can answer without each pane
  // subscribing for itself.
  useEffect(() => installTerminalWindowFocus(), []);

  // Probe support + hydrate prefs once. Cheap and idempotent; runs on repo
  // changes so a backend that gains/loses support is re-detected.
  useEffect(() => {
    const client = getApiClient();
    const store = useReviewStore.getState();
    store.hydrateTerminalPrefs();
    client
      .terminalsAvailable()
      .then((supported) => store.setTerminalsSupported(supported))
      .catch((err) => {
        console.error("[terminal] Support probe failed:", err);
        store.setTerminalsSupported(false);
      });
  }, [repoPath]);

  // Load the existing sessions and subscribe to the global status roll-up.
  // Gated on the support flag the probe above set, so we don't re-probe
  // availability here — and on nothing else: the daemon is global, so a shell
  // you started is still yours on the home screen, and waiting for a repo
  // would leave the dock empty until you opened one.
  useEffect(() => {
    if (!terminalsSupported) return;
    const client = getApiClient();
    let cancelled = false;

    // Attention notifications are NOT decided here: per-session subscriptions
    // receive the same status first and write the store through
    // applyTerminalStatus, so by the time this roll-up handler ran, the phase
    // being replaced was already gone. The edge test lives inside
    // applyTerminalStatus, where every write passes and prev is still prev.
    const unsubStatusChanged = client.onTerminalStatusChanged((status) => {
      useReviewStore.getState().applyTerminalStatus(status);
    });

    // No repo filter: the strip is one list of every terminal there is, and
    // the sidebar lists them all too. `terminalList()` already returns
    // everything in one call — asking per repo was N round trips and N store
    // writes for the same data.
    client
      .terminalList()
      .then((sessions) => {
        if (cancelled) return;
        const store = useReviewStore.getState();
        store.ingestTerminalList(sessions);
        for (const session of sessions) {
          store.ensureTerminalSubscription(session.id);
        }
      })
      .catch((err) => {
        console.error("[terminal] Failed to load sessions:", err);
      });

    return () => {
      cancelled = true;
      unsubStatusChanged();
    };
  }, [repoPath, reviewRef, terminalsSupported]);
}
