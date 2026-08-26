/**
 * When a scaled terminal is worth saying so about, and how to say it.
 *
 * A phone renders the PTY's true grid scaled down to fit (see "One PTY grid"
 * in the root CLAUDE.md), and the only way to change that is to fit the shared
 * grid to this screen — a write every other client sees, so it stays a tap and
 * never a side effect. The tap used to be a pill floating in the bottom-right
 * corner of the drawing, which put it on top of the last rows of output: over
 * Claude Code, exactly on its status line. A control that covers the thing it
 * is about is the wrong trade at any size, and it was already reachable a
 * second way (the `⋯` sheet's "Fit to screen").
 *
 * So on a phone the scale is a **chip in the terminal strip** instead — a
 * place that can never sit on a row of output — that reports the scale and
 * fits when tapped. Which makes it a status readout first and a control
 * second, and that is what decides both rules below.
 */

/**
 * How far below true size the drawing has to be drawn before the chip appears.
 *
 * A few percent of shrink is invisible and reads as noise in the strip, and a
 * chip that came and went on a resize of a few pixels would be worse than
 * either state. Anything a person can actually see is well below this.
 */
export const SCALE_CHIP_THRESHOLD = 0.95;

/** Whether the strip should be reporting this scale at all. */
export function scaleChipVisible(scale: number): boolean {
  // Guard the numbers a layout can produce before it has measured anything:
  // 0 (a pane with no size yet) is not "scaled to nothing", it is "unknown".
  if (!Number.isFinite(scale) || scale <= 0) return false;
  return scale < SCALE_CHIP_THRESHOLD;
}

/**
 * The scale as the chip says it: a whole percentage.
 *
 * Rounded down, because the number is a claim about legibility and 94.6%
 * shown as "95%" would be the one case where the chip appears reading like
 * the threshold it just crossed.
 */
export function formatScale(scale: number): string {
  return `${Math.max(1, Math.floor(scale * 100))}%`;
}
