import { type ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import type { ContentFocus } from "../../stores/slices/terminalSlice";
import { SimpleTooltip } from "../ui/tooltip";

/**
 * The one control for the content region: code · split · terminal, a
 * three-position switch. It appears in the terminal panel's header, and — as
 * the same control with its vertical orientation — in whichever rail the
 * unfocused surface has collapsed to, so every place you can stand shows the
 * same switch with the same positions.
 *
 * Each glyph is a miniature of the layout it selects, with the filled region
 * standing for the terminal on the side it actually docks — the language the
 * dock-side button beside it already speaks. The positions are ordered to
 * match too: reading across the switch sweeps the divider from "all code" to
 * "all terminal", whichever side the terminal is on.
 */
export function FocusSwitch({
  vertical = false,
  tooltipSide,
}: {
  vertical?: boolean;
  tooltipSide?: "top" | "right" | "bottom" | "left";
}): ReactNode {
  const contentFocus = useReviewStore((s) => s.contentFocus);
  const setContentFocus = useReviewStore((s) => s.setContentFocus);
  const side = useReviewStore((s) => s.terminalDockSide);

  // Divider position, read left to right: with the terminal docked left,
  // pushing right gives it more room; docked right, the sweep reverses.
  const positions: ContentFocus[] =
    side === "left"
      ? ["code", "split", "terminal"]
      : ["terminal", "split", "code"];

  return (
    <div
      role="radiogroup"
      aria-label="Focus"
      className={clsx(
        "flex shrink-0 items-center gap-px rounded-md bg-fg/[0.05] p-0.5",
        vertical && "flex-col",
      )}
    >
      {positions.map((focus) => {
        const active = focus === contentFocus;
        return (
          <SimpleTooltip
            key={focus}
            content={FOCUS_LABELS[focus]}
            side={tooltipSide}
          >
            <button
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={FOCUS_LABELS[focus]}
              onClick={() => setContentFocus(focus)}
              className={clsx(
                "flex items-center justify-center rounded transition-colors",
                vertical ? "h-6 w-6" : "h-5 w-6",
                active
                  ? "bg-surface-raised text-fg-secondary"
                  : "text-fg-faint hover:bg-fg/[0.08] hover:text-fg-secondary",
              )}
            >
              <FocusGlyph focus={focus} side={side} />
            </button>
          </SimpleTooltip>
        );
      })}
    </div>
  );
}

// The shortcuts hold from every state a segment is clickable in: ⌘` lands on
// "code" from anywhere but code itself, ⇧⌘↵ on "terminal" from anywhere but
// terminal — and the segment you're on isn't the one you reach for.
const FOCUS_LABELS: Record<ContentFocus, string> = {
  code: "Focus code (⌘`)",
  split: "Split code and terminal",
  terminal: "Focus terminal (⇧⌘↵)",
};

/**
 * A miniature of the layout: the frame is the content region, the fill is how
 * much of it the terminal holds — a sliver (its rail), half, or all of it.
 */
function FocusGlyph({
  focus,
  side,
}: {
  focus: ContentFocus;
  side: "left" | "right";
}): ReactNode {
  const width = focus === "code" ? 3 : focus === "split" ? 6.5 : 12;
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
