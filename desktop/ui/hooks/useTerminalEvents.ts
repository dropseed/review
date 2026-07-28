import { useEffect } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { makeReviewKey } from "../utils/review-key";

/**
 * Mounted once in ReviewView. Probes terminal support, hydrates panel prefs,
 * loads any pre-existing sessions for the repo, and keeps the store's status
 * map fresh via the global status roll-up. Modeled on useFileWatcher.
 */
export function useTerminalEvents(): void {
  const repoPath = useReviewStore((s) => s.repoPath);
  const reviewRef = useReviewStore((s) => s.reviewRef);
  const terminalsSupported = useReviewStore((s) => s.terminalsSupported);

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

  // Load existing sessions for this repo/review and subscribe to the global
  // status roll-up. Gated on the support flag the probe above set, so we don't
  // re-probe availability here.
  useEffect(() => {
    if (!repoPath || !terminalsSupported) return;
    const client = getApiClient();
    let cancelled = false;

    const reviewKey = makeReviewKey(repoPath, reviewRef ?? "");

    const unsubStatusChanged = client.onTerminalStatusChanged((status) => {
      useReviewStore.getState().applyTerminalStatus(status);
    });

    // No repo filter: sidebar rows for *every* repo show terminal badges, so
    // the session map has to cover all of them. `terminalList()` already
    // returns everything in one call — asking per repo was N round trips and N
    // store writes for the same data.
    client
      .terminalList()
      .then((sessions) => {
        if (cancelled) return;
        const store = useReviewStore.getState();
        // Sessions in this repo are placed in the bucket their checkout owns;
        // sessions from elsewhere only need to reach the flat maps that badges
        // read. `reviewKey` is just the fallback for a repo whose checkout
        // listing hasn't loaded yet.
        store.ingestTerminalList(
          sessions.filter((s) => s.repoPath === repoPath),
          repoPath,
          reviewKey,
        );
        for (const session of sessions) {
          store.ensureTerminalSubscription(session.id);
        }
        store.mergeTerminalSessions(sessions);
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
