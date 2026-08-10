import { useEffect, useRef } from "react";

interface PollWhileVisibleOptions {
  /**
   * Also poll when the window regains focus. Separate from visibility because
   * they are separate events: clicking back into an already-visible window
   * fires `focus` and nothing else, and for a poll whose data changes from
   * outside the app that is the moment the user is most likely to be looking.
   */
  onFocus?: boolean;
}

/**
 * Run `poll` on an interval, but only while the window is visible.
 *
 * Every poll in this app costs something real — a subprocess, a git fan-out, an
 * API call — so a backgrounded window stops asking rather than paying for
 * answers nobody can see. Coming back runs one immediately instead of waiting
 * out the remainder of an interval that wasn't running, since the whole point of
 * returning to the window is to see the current state.
 *
 * `poll` is read through a ref, so a caller can pass an inline closure over
 * fresh state without a new identity tearing down and restarting the timer.
 */
export function usePollWhileVisible(
  poll: () => void,
  intervalMs: number,
  { onFocus = false }: PollWhileVisibleOptions = {},
): void {
  const pollRef = useRef(poll);
  useEffect(() => {
    pollRef.current = poll;
  }, [poll]);

  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | null = null;
    const run = (): void => pollRef.current();

    const start = (): void => {
      intervalId ??= setInterval(run, intervalMs);
    };
    const stop = (): void => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const handleVisibility = (): void => {
      if (document.visibilityState === "visible") {
        run();
        start();
      } else {
        stop();
      }
    };

    // Mounting doesn't poll: callers do their own first read, in whatever order
    // the rest of their startup needs.
    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);
    if (onFocus) window.addEventListener("focus", run);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      if (onFocus) window.removeEventListener("focus", run);
      stop();
    };
  }, [intervalMs, onFocus]);
}
