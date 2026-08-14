import type { ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { SimpleTooltip } from "../ui/tooltip";

/** Which half of the stage a toggle speaks for. */
export type StageHalf = "terminal" | "code";

/**
 * "Give this half the whole stage", on that half's own tab bar.
 *
 * One button per bar rather than one switch listing every layout: the question
 * a person actually has is about the half they are already looking at, and the
 * two bars are never both hidden — so the button that took the stage is always
 * on screen to give it back. `contentFocus` is still the one state underneath;
 * this is `split ⇄ this half`, which is exactly what the two store toggles do.
 */
export function FocusToggle({
  half,
  tooltipSide = "bottom",
}: {
  half: StageHalf;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}): ReactNode {
  const contentFocus = useReviewStore((s) => s.contentFocus);
  const toggleTerminalFocus = useReviewStore((s) => s.toggleTerminalFocus);
  const toggleTerminalPanel = useReviewStore((s) => s.toggleTerminalPanel);
  const dockSide = useReviewStore((s) => s.terminalDockSide);

  const focused = contentFocus === half;
  const label = focused ? "Exit focus" : "Focus";
  // The terminal sits on its dock side; the code has the other one.
  const side =
    half === "terminal" ? dockSide : dockSide === "left" ? "right" : "left";

  return (
    <SimpleTooltip content={label} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={focused}
        onClick={() =>
          half === "terminal" ? toggleTerminalFocus() : toggleTerminalPanel()
        }
        className={clsx(
          "flex h-5 w-6 shrink-0 items-center justify-center rounded transition-colors",
          focused
            ? "bg-surface-raised text-fg-secondary"
            : "text-fg-faint hover:bg-fg/[0.08] hover:text-fg-secondary",
        )}
      >
        <StageHalfGlyph side={side} filled={focused} />
      </button>
    </SimpleTooltip>
  );
}

/**
 * A miniature of the stage: the frame is the content region, the fill is what
 * this half holds — half of it, or all of it once it has focus. The same
 * language the dock-side button beside it speaks.
 */
function StageHalfGlyph({
  side,
  filled,
}: {
  side: "left" | "right";
  filled: boolean;
}): ReactNode {
  const width = filled ? 12 : 6.5;
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="2" y="2.5" width="12" height="11" rx="1.5" />
      <rect
        x={side === "left" ? 2 : 14 - width}
        y="2.5"
        width={width}
        height="11"
        rx="1.5"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
