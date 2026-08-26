import { type ReactNode, useCallback, useSyncExternalStore } from "react";
import { onTerminalViewScale, requestFit, terminalViewScale } from "./registry";

/**
 * The phone's readout of how far down the terminal is being drawn, and the tap
 * that fixes it.
 *
 * A phone renders the PTY's true grid scaled down to fit (see "One PTY grid" in
 * the root CLAUDE.md), and the only way to change that is to fit the shared
 * grid to this screen — a write every other client sees, so it stays a tap and
 * never a side effect. The tap used to be a pill floating in the bottom-right
 * corner of the drawing, which put it on top of the last rows of output: over
 * Claude Code, exactly on its status line. A control that covers the thing it
 * is about is the wrong trade at any size, and it was already reachable a
 * second way (the `⋯` sheet's "Fit to screen").
 *
 * So it lives in the strip's trailing group instead — a place that can never
 * sit on a row of output. Which makes it a status readout first and a control
 * second, and that is what decides both rules below: it is a percentage rather
 * than the words "Fit to screen" (the words are in the sheet, where they are
 * offered unconditionally), and it appears only when there is something to
 * report — disappearing is what it has to say when the fit works.
 */
export function TerminalScaleChip({ paneId }: { paneId: string }): ReactNode {
  const scale = useTerminalViewScale(paneId);
  if (!chipVisible(scale)) return null;
  // Rounded down, because the number is a claim about legibility and 94.6%
  // shown as "95%" would be the one case where the chip appears reading like
  // the threshold it just crossed.
  const percent = `${Math.max(1, Math.floor(scale * 100))}%`;
  return (
    <button
      type="button"
      onClick={() => requestFit(paneId)}
      aria-label={`Fit terminal to screen (drawn at ${percent})`}
      title={`Drawn at ${percent} — tap to fit the terminal to this screen`}
      className="tap tap-target flex shrink-0 items-center justify-center
                 rounded-md px-2 text-xxs tabular-nums text-fg-faint
                 active:bg-surface-raised"
    >
      {percent}
    </button>
  );
}

/**
 * How far below true size the drawing has to be drawn before the chip appears.
 *
 * A few percent of shrink is invisible and reads as noise in the strip, and a
 * chip that came and went on a resize of a few pixels would be worse than
 * either state. Anything a person can actually see is well below this.
 */
const SCALE_CHIP_THRESHOLD = 0.95;

/** Whether the strip should be reporting this scale at all. */
function chipVisible(scale: number): boolean {
  // Guard the numbers a layout can produce before it has measured anything:
  // 0 (a pane with no size yet) is not "scaled to nothing", it is "unknown".
  if (!Number.isFinite(scale) || scale <= 0) return false;
  return scale < SCALE_CHIP_THRESHOLD;
}

/**
 * What the mounted pane is drawing this session at.
 *
 * Subscribed rather than read: the strip renders above the pane, so its effect
 * runs before the pane has laid anything out — the first scale always arrives
 * as a notification, never as the initial read.
 */
function useTerminalViewScale(id: string): number {
  return useSyncExternalStore(
    useCallback(
      (onChange: () => void) => onTerminalViewScale(id, onChange),
      [id],
    ),
    () => terminalViewScale(id),
  );
}
