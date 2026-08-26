/**
 * The phone's navigation stack: the terminal is the screen you are on, and the
 * code half is *pushed* over it.
 *
 * This is the arithmetic half — which screen the stack is showing, where a
 * finger has dragged it to, and whether letting go commits the pop. It is kept
 * apart from `CompactStage` for the reason `Terminal/touch-gestures` is kept
 * apart from `TerminalPane`: the numbers are the part with answers, and they
 * can be checked without a DOM, a store, or a touchscreen.
 */

import type { ContentFocus } from "../../stores/slices/terminalSlice";

/**
 * How long a push or a pop takes, and the curve it takes it on, live in
 * `index.css` as `.nav-push` / `.nav-push-scrim` — 350ms on UIKit's own
 * `cubic-bezier(0.32, 0.72, 0, 1)`, a steep start that is almost entirely over
 * by two-thirds of the way through, so the screen arrives before the animation
 * technically ends and the gesture reads as answered rather than played back.
 *
 * They are CSS rather than numbers here because the resting states are set as
 * inline transforms (see `pushTransforms`) and the transition between them is
 * the browser's to run: a duration in both places would be two answers.
 */

/**
 * How far in from the left edge a drag has to start to be a back-swipe.
 *
 * iOS uses roughly this, and the size is the whole safety of the gesture: the
 * code half is full of things you scroll and tap, and only a strip this narrow
 * is reliably "nothing else is here".
 */
export const EDGE_ZONE_PX = 24;

/** How far a drag must travel before it is a direction rather than a tap. */
export const AXIS_SLOP_PX = 10;

/** Past this share of the screen, letting go pops. */
export const COMMIT_FRACTION = 1 / 3;

/**
 * A flick: fast enough that the distance stops mattering.
 *
 * In CSS px per millisecond — half a screen a second. Below the commit
 * distance this is the only thing that can still pop, which is what makes a
 * short, quick swipe from the edge work at all.
 */
export const FLICK_PX_PER_MS = 0.5;

/** Under 8px is a tap that wobbled, whatever velocity it computes to. */
const FLICK_MIN_PX = 8;

/**
 * How far the screen underneath slides while the one above covers it, as a
 * percentage of its own width. Parallax, not scale: the terminal under here is
 * a canvas, and scaling it mid-gesture resamples every glyph. iOS's nav push
 * doesn't scale either — that is the modal presentation.
 */
export const UNDERLAY_SHIFT_PCT = 22;

/** How dark the covered screen goes, at full push. */
export const UNDERLAY_DIM = 0.35;

/**
 * Whether the code half is pushed over the terminal.
 *
 * Derived from `contentFocus`, not stored beside it: "code has the stage" is
 * the same fact the desktop's Focus toggle states, so ⌘`, `jumpToTerminal` and
 * the code header's own back button are all already writing this, and a second
 * phone-only flag would be a second answer to one question.
 *
 * With no terminal half there is nothing to push *over* — the code half is
 * simply the screen, with no back affordance, which is what `docked === false`
 * means everywhere else in the compact layout.
 */
export function codePushed(focus: ContentFocus, docked: boolean): boolean {
  return docked && focus === "code";
}

/** Where the pushed screen sits, in px from its home position. */
export function dragOffset(dx: number, width: number): number {
  if (!Number.isFinite(dx)) return 0;
  return Math.max(0, Math.min(width, dx));
}

/** That offset as 0..1, where 0 is fully pushed and 1 is fully popped. */
export function dragProgress(offset: number, width: number): number {
  if (width <= 0) return 0;
  return Math.max(0, Math.min(1, offset / width));
}

/**
 * The three transforms that draw the stack at a given progress.
 *
 * One function for both the resting states and every frame of a drag, which is
 * what lets the gesture hand the screen back to React without a seam: letting
 * go paints the resting progress of wherever it is going (0 or 1), and the
 * render that follows sets the identical inline values. Nothing has to be
 * cleared, so nothing can snap home for a frame on the way out.
 *
 * Percentages, not pixels, so the same numbers describe a phone in either
 * orientation without anyone measuring.
 */
export function pushTransforms(progress: number): {
  screen: string;
  underlay: string;
  scrim: number;
} {
  const p = Math.max(0, Math.min(1, progress));
  return {
    screen: `translate3d(${p * 100}%, 0, 0)`,
    underlay: `translate3d(${-UNDERLAY_SHIFT_PCT * (1 - p)}%, 0, 0)`,
    scrim: UNDERLAY_DIM * (1 - p),
  };
}

/** Whether a drag starting here counts as coming from the left edge. */
export function startsAtEdge(
  clientX: number,
  left = 0,
  zone = EDGE_ZONE_PX,
): boolean {
  const from = clientX - left;
  return from >= 0 && from <= zone;
}

/**
 * Does letting go here pop the screen?
 *
 * Two ways to say yes, because a swipe and a flick are different gestures with
 * the same shape: dragged past a third of the width, or thrown — moving fast
 * enough at release that where it happened to be is beside the point. Anything
 * else springs back, which is the answer that costs nothing.
 *
 * `dt` of 0 (or worse) is not an infinite velocity: a release in the same
 * millisecond it started is a tap, and only the distance test can answer it.
 */
export function popCommits({
  dx,
  dt,
  width,
}: {
  /** How far the screen was dragged, px. */
  dx: number;
  /** How long the drag took, ms. */
  dt: number;
  /** The screen's own width, px. */
  width: number;
}): boolean {
  const offset = dragOffset(dx, width);
  if (width > 0 && offset >= width * COMMIT_FRACTION) return true;
  if (dt <= 0 || offset < FLICK_MIN_PX) return false;
  return offset / dt >= FLICK_PX_PER_MS;
}
