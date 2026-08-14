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

  const focused = contentFocus === half;
  const label = focused ? "Exit full view" : "Full view";

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
        <ExpandGlyph collapsing={focused} />
      </button>
    </SimpleTooltip>
  );
}

/**
 * Corner arrows: out to the corners to take the whole stage, back in to give it
 * up again.
 *
 * This used to be a miniature of the stage — a frame with a bar filling half of
 * it or all of it. It was accurate and unreadable at 14px: the difference
 * between the two states was the width of a bar, and neither state said what
 * clicking would *do*. The full-screen arrows are the one glyph every media
 * player and every image viewer has already taught, and the direction of the
 * arrowheads is legible at a glance.
 */
function ExpandGlyph({ collapsing }: { collapsing: boolean }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-3.5 w-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {collapsing ? (
        <>
          {/* Arrowheads at the corners pointing inward, each with its tail
              running out to the edge it came from. */}
          <path d="M6.5 2.5v4h-4M2.5 2.5l4 4" />
          <path d="M9.5 2.5v4h4M13.5 2.5l-4 4" />
          <path d="M6.5 13.5v-4h-4M2.5 13.5l4-4" />
          <path d="M9.5 13.5v-4h4M13.5 13.5l-4-4" />
        </>
      ) : (
        <>
          <path d="M2.5 6.5v-4h4M2.5 2.5l4 4" />
          <path d="M13.5 6.5v-4h-4M13.5 2.5l-4 4" />
          <path d="M2.5 9.5v4h4M2.5 13.5l4-4" />
          <path d="M13.5 9.5v4h-4M13.5 13.5l-4-4" />
        </>
      )}
    </svg>
  );
}
