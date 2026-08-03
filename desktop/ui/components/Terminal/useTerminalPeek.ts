import { useEffect, useState } from "react";
import { getApiClient } from "../../api";

const PEEK_INTERVAL_MS = 2000;
const TICK_INTERVAL_MS = 1000;

/**
 * The current screen text of a session, refreshed while the caller is showing
 * it. Pass `null` to stand down (nothing to peek at — the session exited, or
 * the surface is closed).
 *
 * Pull-based on purpose: peeks are deliberately not part of the status stream
 * (see the backend's status module), so anything that wants screen content asks
 * for it only while it's actually on screen — a mounted card, an open popover.
 * Returns `null` until the first peek resolves; a failed peek (session just
 * died) settles on "" rather than an error, since "nothing to show" is the
 * honest answer.
 */
export function useTerminalPeek(sessionId: string | null): string | null {
  const [peek, setPeek] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setPeek(null);
      return;
    }
    let cancelled = false;
    // In flight at most once — a slow peek must not stack behind the interval.
    let pending = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const pull = () => {
      if (pending) return;
      pending = true;
      getApiClient()
        .terminalPeek(sessionId)
        .then((text) => {
          // A terminal that isn't moving returns the same screen forever;
          // keeping the old string spares every card a re-render per tick.
          if (!cancelled) setPeek((prev) => (prev === text ? prev : text));
        })
        .catch(() => {
          if (!cancelled) setPeek((prev) => prev ?? "");
        })
        .finally(() => {
          pending = false;
        });
    };

    // Each peek costs a round trip to the daemon and a full VT screen render,
    // so a backgrounded window stops asking entirely rather than paying for
    // screens nobody can see.
    const sync = () => {
      if (document.visibilityState === "visible") {
        pull();
        interval ??= setInterval(pull, PEEK_INTERVAL_MS);
      } else if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    };

    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", sync);
      if (interval !== null) clearInterval(interval);
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
