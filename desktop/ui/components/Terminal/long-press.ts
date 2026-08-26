/**
 * The press that means "hold on, I want to read this" — and everything that
 * isn't it.
 *
 * A terminal on a phone already answers four gestures (tap, scroll drag, swipe,
 * pinch), and a fifth one can only be told apart from them by *not* being them:
 * one finger, still, for long enough that no scroll or swipe was intended. So
 * this is a timer with cancel rules rather than a measurement, and it lives
 * apart from the pane for the same reason the gesture arithmetic does — the
 * rules are the part worth checking, and they need neither a terminal nor a
 * touchscreen to check.
 *
 * The slop is the pane's own `TOUCH_SLOP_PX`, passed in rather than imported:
 * the press has to be cancelled by exactly the movement that commits a drag, or
 * there is a band of travel that is both.
 */

/**
 * How long a finger must rest before it means "select".
 *
 * iOS's own text long-press is ~500ms; a hair under that is deliberate — the
 * gesture is being claimed from the page, and a person who has learned the
 * system's timing should never see the system's callout win the race.
 */
export const LONG_PRESS_MS = 450;

export interface LongPress {
  /** A finger landed. Restarts the clock, whatever came before. */
  start(x: number, y: number): void;
  /** It moved. Past the slop, this was a drag all along. */
  move(x: number, y: number): void;
  /** It lifted, a second finger landed, or the pane is going away. */
  cancel(): void;
  /** Whether a press is still on its way to firing. */
  readonly pending: boolean;
}

/**
 * A long-press timer over one gesture at a time.
 *
 * `onFire` is called with the point the finger *landed* on, not where it was
 * when the timer expired — they are within the slop of each other by
 * construction, and the landing point is the one the person aimed.
 */
export function createLongPress({
  delayMs = LONG_PRESS_MS,
  slopPx,
  onFire,
}: {
  delayMs?: number;
  slopPx: number;
  onFire: (x: number, y: number) => void;
}): LongPress {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let origin: { x: number; y: number } | null = null;

  const stop = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    origin = null;
  };

  return {
    start(x, y) {
      stop();
      origin = { x, y };
      timer = setTimeout(() => {
        const at = origin;
        stop();
        if (at) onFire(at.x, at.y);
      }, delayMs);
    },
    move(x, y) {
      if (!origin) return;
      if (Math.hypot(x - origin.x, y - origin.y) >= slopPx) stop();
    },
    cancel: stop,
    get pending() {
      return timer !== null;
    },
  };
}
