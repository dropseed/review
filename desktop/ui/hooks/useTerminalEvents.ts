import { useCallback, useEffect, useRef } from "react";
import { getApiClient } from "../api";
import { useReviewStore } from "../stores";
import { installTerminalWindowFocus } from "../components/Terminal/window-focus";
import { usePollWhileVisible } from "./usePollWhileVisible";

/**
 * How often the session list is re-asked when nothing has said to.
 *
 * It used to be 15s, and it was how sessions were *discovered*: one is born
 * outside this window as often as in it — the phone's PWA, `review terminal
 * start`, another client — and nothing on the daemon's wire announced it. The
 * events channel is that announcement, so discovery is no longer a poll and
 * this is a backstop, at the same five minutes `useWorkspaceSync` uses for the
 * same reason. It stands under two things the stream can't cover on its own:
 * the window that was asleep or offline while the socket was down (a reconnect
 * fires `sessionsInvalidated`, but only once it manages to reconnect), and the
 * plain possibility of a bug in the fan-out. The focus refresh is the half that
 * still earns its keep — coming back to the window is when a stale list is most
 * likely to be looked at.
 */
const LIST_POLL_MS = 5 * 60 * 1000;

/**
 * Mounted once at the app shell — beside the panel it feeds, and for the same
 * reason: a status stream that unsubscribed when you left the review would
 * leave the tab strip showing phases from whenever you last had one open.
 *
 * Probes terminal support, hydrates panel prefs, loads any pre-existing
 * sessions, and then keeps that list live off the daemon's event channel:
 * births, exits, workspace moves, removals, and the status roll-up. Modeled on
 * useFileWatcher.
 *
 * The one `terminalList` at the start is what makes the stream sufficient — the
 * daemon's guarantee is that a list taken after the channel is open, plus every
 * frame after it, is the list at any later moment.
 */
export function useTerminalEvents(): void {
  const repoPath = useReviewStore((s) => s.repoPath);
  const terminalsSupported = useReviewStore((s) => s.terminalsSupported);

  // The list request in flight, and whether something asked for another one
  // while it was out — see `refreshSessions`.
  const inFlight = useRef(false);
  const again = useRef(false);

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

  /**
   * Ask the daemon which sessions exist and fold the answer in.
   *
   * Idempotent by construction, which is what makes it pollable: ingesting
   * merges rather than replaces, subscriptions are ensured rather than opened,
   * and the layout restore it triggers runs at most once.
   *
   * No repo filter: the strip is one list of every terminal there is, and the
   * sidebar lists them all too. `terminalList()` already returns everything in
   * one call — asking per repo was N round trips and N store writes for the
   * same data.
   */
  const refreshSessions = useCallback(function refresh(): void {
    if (!useReviewStore.getState().terminalsSupported) return;
    // One list in flight at a time, with a trailing re-run for whatever asked
    // while it was out. Four things call this — mount, `sessionsInvalidated`,
    // window focus and the backstop poll — and at launch two of them fire
    // back-to-back; two overlapping answers can land in either order, and the
    // older one would ingest a session list from before the newer one's.
    if (inFlight.current) {
      again.current = true;
      return;
    }
    inFlight.current = true;
    getApiClient()
      .terminalList()
      .then((sessions) => {
        const store = useReviewStore.getState();
        store.ingestTerminalList(sessions);
        for (const session of sessions) {
          store.ensureTerminalSubscription(session.id);
        }
      })
      .catch((err) => {
        console.error("[terminal] Failed to load sessions:", err);
      })
      .finally(() => {
        inFlight.current = false;
        if (!again.current) return;
        again.current = false;
        refresh();
      });
  }, []);

  // Load the existing sessions and subscribe to the global status roll-up.
  // Gated on the support flag the probe above set, so we don't re-probe
  // availability here — and on nothing else: the daemon is global, so a shell
  // you started is still yours on the home screen, and waiting for a repo
  // would leave the dock empty until you opened one.
  useEffect(() => {
    if (!terminalsSupported) return;
    const client = getApiClient();

    // Status for every session there is, whether or not this window is drawing
    // it. Attention notifications are NOT decided here: in web mode a mounted
    // pane's own socket carries the same frame, and whichever arrives first is
    // the one that still sees the phase being replaced. The edge test lives
    // inside applyTerminalStatus, where every write passes and prev is still
    // prev.
    const unsubStatusChanged = client.onTerminalStatusChanged((status) => {
      useReviewStore.getState().applyTerminalStatus(status);
    });

    // A session born anywhere. Ingesting a one-element list is exactly right:
    // the merge is per-session, the tab reconciliation wraps a session no tab
    // holds into one of its own, and none of it touches the sessions the frame
    // didn't mention.
    const unsubStarted = client.onTerminalStarted((session) => {
      const store = useReviewStore.getState();
      store.ingestTerminalList([session]);
      store.ensureTerminalSubscription(session.id);
    });

    // The global roll-ups. Each is the same write the per-session subscription
    // makes for a mounted pane, reaching the sessions that have none — a shell
    // whose card is sitting in the queue unopened is exactly the one whose
    // finishing a person wants to see.
    const unsubExited = client.onTerminalExited((exit) => {
      useReviewStore.getState().applyTerminalExit(exit);
    });
    const unsubAssigned = client.onTerminalWorkspaceAssigned(
      ({ id, workspaceId }) => {
        useReviewStore.getState().applyTerminalWorkspace(id, workspaceId);
      },
    );
    const unsubRemoved = client.onTerminalRemoved(({ id }) => {
      useReviewStore.getState().applyTerminalRemoved(id);
    });

    // The stream admitting it may have missed something — on every (re)connect
    // and whenever the daemon drops events for a subscriber that fell behind.
    // One list is the whole repair, which is why the list stayed idempotent.
    const unsubInvalidated =
      client.onTerminalSessionsInvalidated(refreshSessions);

    refreshSessions();

    return () => {
      unsubStatusChanged();
      unsubStarted();
      unsubExited();
      unsubAssigned();
      unsubRemoved();
      unsubInvalidated();
    };
  }, [terminalsSupported, refreshSessions]);

  // Coming back to the window is the moment a stale list is most likely to be
  // looked at, so focus refreshes as well as the interval.
  usePollWhileVisible(refreshSessions, LIST_POLL_MS, { onFocus: true });
}
