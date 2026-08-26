/**
 * The arithmetic behind the terminal pane's touch gestures.
 *
 * Kept apart from `TerminalPane` because it is the part with answers: which
 * way a drag went, how far two fingers have spread, what that spread is worth
 * in font-size steps. The pane holds the listeners and the terminal; this holds
 * the sums, and can be checked without either.
 *
 * Counting pixels into whole cells is not here — it is `takeSteps` in
 * `registry`, shared with the wheel and the scroll drag, which need the same
 * carry for the same reason.
 */

/** Which way a drag committed. Decided once, on first movement past the slop. */
export type GestureAxis = "horizontal" | "vertical";

/**
 * Which axis a drag belongs to, or null while it is still a tap.
 *
 * Measured from where the finger started rather than from the last move, so a
 * gesture cannot flip axis by wobbling: the caller asks until it gets an
 * answer and then keeps it for the rest of the gesture. Ties go to vertical —
 * scrolling is what a drag on a terminal has always done, and a thumb aiming
 * to scroll is far more likely to drift sideways than a swipe is to drift up.
 */
export function lockAxis(
  dx: number,
  dy: number,
  slop: number,
): GestureAxis | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dx) > Math.abs(dy) ? "horizontal" : "vertical";
}

/**
 * Distance between two touch points, in CSS pixels.
 *
 * Typed structurally rather than against `Touch` so a test can pass two plain
 * points.
 */
export function touchDistance(
  a: { clientX: number; clientY: number },
  b: { clientX: number; clientY: number },
): number {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/**
 * How much a pinch has to spread before it is worth one step of font size.
 *
 * Small enough that the text follows the fingers rather than lagging behind
 * them, large enough that resting two fingers on the glass doesn't resize
 * anything.
 */
export const PINCH_STEP_RATIO = 1.15;

/**
 * How many font-size steps a pinch of this ratio is worth.
 *
 * Logarithmic, so pinching out and back in again lands on the size it started
 * from: a ratio and its reciprocal give opposite step counts, which a linear
 * reading of the same ratio would not. Measured against the size the gesture
 * *started* at rather than the current one, so the size tracks the fingers
 * absolutely and a clamp at one end doesn't shift the scale for the way back.
 */
export function pinchSteps(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.round(Math.log(ratio) / Math.log(PINCH_STEP_RATIO));
}
