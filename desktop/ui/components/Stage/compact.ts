import type { ContentFocus } from "../../stores/slices/terminalSlice";
import { SIDEBAR_LIMITS } from "../../utils/resize";
import type { StageHalf } from "./FocusToggle";

/**
 * Which half a phone-width stage shows.
 *
 * `contentFocus` has three values and a narrow window can honour two of them,
 * so "split" has to resolve to one half. It resolves to the terminal: the
 * reason to open this app on a phone is almost always an agent that has been
 * left running, and the code half at 390px is a diff read four words at a time.
 * A workspace with no terminal dock has no such half to show, so it resolves
 * to the code regardless.
 *
 * Nothing here writes to the store. `contentFocus` keeps whatever the desktop
 * chose, and widening the window restores it untouched — the rule
 * `useResponsiveDiffViewMode` already follows for a split diff in a narrow
 * pane.
 */
export function compactStageHalf(
  focus: ContentFocus,
  docked: boolean,
): StageHalf {
  if (!docked) return "code";
  return focus === "code" ? "code" : "terminal";
}

/**
 * The narrowest the diff may get before the files column stops being worth its
 * room, in rem.
 *
 * Below this the two columns are each too narrow to read and the pair is worse
 * than either alone. Sized against what a diff needs rather than what the
 * column wants: `useResponsiveDiffViewMode` already gives up side-by-side at
 * 48rem, so this is the next rung down — a single column of code with its line
 * numbers and gutter still legible.
 */
const DIFF_MIN_REM = 26;

/**
 * Whether the code half should show one of its two columns instead of both.
 *
 * This is a fact about the *container*, not about the device. A phone hits it
 * because the whole window is narrow; a desktop hits it with the terminal taking
 * three-quarters of the stage, which is the ordinary way to work here — and
 * before this, that second case just squeezed the diff into a ribbon a few words
 * wide while the files column kept its full width.
 *
 * Driving the list/detail behaviour off the measured width rather than off a
 * phone breakpoint means there is one mechanism, and the phone is simply the
 * case where it is always true.
 *
 * `availablePx` of 0 is "not measured yet", which must read as roomy: the
 * alternative is every code half rendering as a file list for one frame.
 */
export function codeHalfIsNarrow(
  availablePx: number,
  rootFontSizePx: number,
): boolean {
  if (availablePx <= 0) return false;
  const rem = rootFontSizePx > 0 ? rootFontSizePx : 16;
  // The files column cannot go below its own floor, so the room actually left
  // for the diff is what remains after it — not some share of the whole.
  const filesFloorPx = SIDEBAR_LIMITS.right.minRem * rem;
  return availablePx - filesFloorPx < DIFF_MIN_REM * rem;
}
