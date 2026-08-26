import { type ReactNode, useEffect, useState } from "react";
import { onTerminalViewScale, requestFit, terminalViewScale } from "./registry";
import { formatScale, scaleChipVisible } from "./view-scale";

/**
 * The phone's readout of how far down the terminal is being drawn, and the tap
 * that fixes it.
 *
 * It lives in the strip's trailing group rather than over the drawing, for the
 * reason `view-scale` gives: the pill it replaces covered the last rows of
 * output. Up here it is a status chip that happens to be a control — which is
 * also why it is a percentage rather than the words "Fit to screen". The words
 * are still in the `⋯` sheet, where they are offered unconditionally; this one
 * appears only when there is something to report, and disappearing is what it
 * has to say when the fit works.
 */
export function TerminalScaleChip({ paneId }: { paneId: string }): ReactNode {
  const scale = useTerminalViewScale(paneId);
  if (!scaleChipVisible(scale)) return null;
  const percent = formatScale(scale);
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
 * What the mounted pane is drawing this session at.
 *
 * Subscribed rather than read: the strip renders above the pane, so its effect
 * runs before the pane has laid anything out — the first scale always arrives
 * as a notification, never as the initial read.
 */
function useTerminalViewScale(id: string): number {
  const [scale, setScale] = useState(() => terminalViewScale(id));
  useEffect(() => {
    setScale(terminalViewScale(id));
    return onTerminalViewScale(id, setScale);
  }, [id]);
  return scale;
}
