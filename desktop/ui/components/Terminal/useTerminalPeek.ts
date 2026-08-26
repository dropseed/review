import { useEffect, useState } from "react";
import { sharedTerminalPeekPoller } from "./peek-poller";

const TICK_INTERVAL_MS = 1000;

/**
 * The current screen text of a session, refreshed while the caller is showing
 * it. Pass `null` to stand down (nothing to peek at — the session exited, or
 * the surface is closed).
 *
 * Pull-based on purpose: peeks are deliberately not part of the status stream
 * (see the backend's status module), so anything that wants screen content asks
 * for it only while it's actually on screen — a mounted card, an open popover.
 * The asking itself is not this hook's: every mounted card subscribes to one
 * shared poller, which batches them into a single call per tick (see
 * `peek-poller`). Returns `null` until the first peek resolves; a peek the
 * daemon can't answer (session just died) settles on "" rather than an error,
 * since "nothing to show" is the honest answer.
 */
export function useTerminalPeek(sessionId: string | null): string | null {
  const [peek, setPeek] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setPeek(null);
      return;
    }
    // The poller only calls back on a changed screen, so this is already the
    // "unchanged string → no re-render" the cards want; the guard is here for
    // the one case it can't see, a re-subscribe handing back its cache.
    const unsubscribe = sharedTerminalPeekPoller().subscribe(
      sessionId,
      (text) => setPeek((prev) => (prev === text ? prev : text)),
    );
    return () => {
      unsubscribe();
      setPeek(null);
    };
  }, [sessionId]);

  return peek;
}

/**
 * A ticking clock for time-in-state labels. Only mounted surfaces tick, so the
 * cost is scoped to what's visible — pass `false` to freeze.
 */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [active]);
  return now;
}
