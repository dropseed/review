import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import {
  TERMINAL_FONT_SIZE_MAX,
  TERMINAL_FONT_SIZE_MIN,
  TERMINAL_FONT_SIZE_STEP,
} from "../../stores/slices/preferencesSlice";
import { requestFit } from "./registry";

/**
 * The phone's text size: two taps, where the desktop has a settings panel.
 *
 * A step is a *resize*, not a zoom, and it has to be — a compact pane draws the
 * PTY's grid scaled to fit the screen, so a larger font on the same grid is
 * simply drawn at a smaller scale and arrives exactly the size it left. Bigger
 * text on a 390px screen means fewer columns, which is the shared grid
 * changing. That is allowed here for the same reason "Fit to screen" is: it is
 * a deliberate act, asked for in so many words, rather than the side effect of
 * a glance (see "One PTY grid" in the root CLAUDE.md). A desktop still sized to
 * the old grid letterboxes and says so, and one click there takes it back.
 *
 * The size itself is an ordinary preference, so it is this client's alone — the
 * phone keeps its own, and the desktop's is untouched.
 */
export function TerminalTextSize({ paneId }: { paneId: string }): ReactNode {
  const size = useReviewStore((s) => s.terminalFontSize);
  const setSize = useReviewStore((s) => s.setTerminalFontSize);

  const step = (delta: number) => {
    const next = Math.min(
      TERMINAL_FONT_SIZE_MAX,
      Math.max(TERMINAL_FONT_SIZE_MIN, size + delta),
    );
    if (next === size) return;
    setSize(next);
    // After the paint that re-measures the glyphs: fitting against the old
    // metrics would compute the grid for the size we just left.
    requestAnimationFrame(() => requestFit(paneId));
  };

  return (
    <div className="flex shrink-0 items-center">
      <button
        type="button"
        aria-label="Smaller terminal text"
        title="Smaller terminal text"
        onClick={() => step(-TERMINAL_FONT_SIZE_STEP)}
        className="rounded-md px-2 py-1 text-xs leading-none text-fg-muted
                   active:bg-fg/[0.06]"
      >
        A<span className="text-[0.65rem]">−</span>
      </button>
      <button
        type="button"
        aria-label="Bigger terminal text"
        title="Bigger terminal text"
        onClick={() => step(TERMINAL_FONT_SIZE_STEP)}
        className="rounded-md px-2 py-1 text-sm leading-none text-fg-muted
                   active:bg-fg/[0.06]"
      >
        A<span className="text-[0.65rem]">+</span>
      </button>
    </div>
  );
}
