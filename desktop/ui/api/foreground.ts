/**
 * "This tab is being looked at again, and the network may be back."
 *
 * Three events, because no single one of them fires everywhere:
 *
 * - `visibilitychange` is the ordinary one — Home button, app switcher, screen
 *   lock — and the only one iOS reliably gives a PWA.
 * - `pageshow` covers a restore from the back/forward cache, where the page is
 *   resumed rather than re-run and `visibilitychange` may never fire at all.
 * - `online` is the other way a suspended socket comes back: the tab was
 *   visible the whole time and the radio wasn't.
 *
 * Fired at most once per `MIN_GAP_MS`, since all three can land together on a
 * single unlock and the work behind them is a probe per session.
 */

/** The shortest gap between two wakes; below it the second is the same event. */
const MIN_GAP_MS = 250;

/**
 * Run `listener` whenever this tab returns to the foreground. Returns an
 * unsubscribe.
 *
 * The three listeners are this subscription's own — there is no shared
 * registry, because the one caller (`HttpClient`) already holds the set of
 * sockets it wants woken and subscribes once for all of them.
 */
export function onForeground(listener: () => void): () => void {
  if (typeof document === "undefined") return () => {};

  let lastFiredAt = 0;
  const fire = () => {
    const now = Date.now();
    if (now - lastFiredAt < MIN_GAP_MS) return;
    lastFiredAt = now;
    listener();
  };
  const onVisibility = () => {
    if (document.visibilityState === "visible") fire();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("pageshow", fire);
  window.addEventListener("online", fire);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("pageshow", fire);
    window.removeEventListener("online", fire);
  };
}
