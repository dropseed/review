import { useReviewStore } from "../../stores";
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
} from "../../stores/slices/preferencesSlice";
import { requestFit } from "./registry";

/** A font size the terminal will actually draw at. */
export function clampTerminalFontSize(size: number): number {
  return Math.min(
    TERMINAL_FONT_SIZE_MAX,
    Math.max(TERMINAL_FONT_SIZE_MIN, size),
  );
}

/**
 * Settle on a terminal text size: clamp it, store it, and refit the pane.
 *
 * The one place a chosen size becomes the preference, shared by the two taps
 * below and by the end of a pinch — both are the same deliberate act, and both
 * owe the pane the same resize. The rAF is why it is a function rather than
 * three lines each: fitting before the paint that re-measures the glyphs
 * computes the grid for the size we just left.
 */
export function applyTerminalFontSize(paneId: string, next: number): void {
  const clamped = clampTerminalFontSize(next);
  const store = useReviewStore.getState();
  if (clamped === store.terminalFontSize) return;
  store.setTerminalFontSize(clamped);
  requestAnimationFrame(() => requestFit(paneId));
}

/*
 * The two callers that step a size rather than clamp one — the pinch that ends
 * in `TerminalPane`, and the "Text size" row in `TerminalOverflowSheet` — are
 * the phone's *only* writes to the shared grid, alongside "Fit to screen".
 *
 * A step is a resize, not a zoom, and it has to be: a compact pane draws the
 * PTY's grid scaled to fit the screen, so a larger font on the same grid is
 * simply drawn at a smaller scale and arrives exactly the size it left. Bigger
 * text on a 390px screen means fewer columns, which is the shared grid
 * changing. That is allowed for the same reason "Fit to screen" is — a
 * deliberate act, asked for in so many words, rather than the side effect of a
 * glance (see "One PTY grid" in the root CLAUDE.md). A desktop still sized to
 * the old grid letterboxes and says so, and one click there takes it back.
 *
 * The size itself is an ordinary preference, so it is this client's alone: the
 * phone keeps its own and the desktop's is untouched.
 */
