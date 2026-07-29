import type { ReactNode } from "react";
import { clsx } from "clsx";
import { SimpleTooltip } from "./tooltip";

/** Which window edge a rail hugs. Drives glyph direction and tooltip side. */
export type RailEdge = "left" | "right";

/** Tooltips point inward, away from the edge the rail is pinned to. */
export function railTooltipSide(edge: RailEdge): "left" | "right" {
  return edge === "left" ? "right" : "left";
}

interface RailProps {
  children: ReactNode;
  /** The surface of the pane this rail stands for — its card and background,
   *  or its flat edge — so collapsing reads as that pane narrowing rather than
   *  different chrome appearing. Width comes from here too, since a floating
   *  panel and a flush sidebar don't collapse to the same strip. */
  className?: string;
}

/**
 * A collapsed pane, narrowed to a strip on its dock edge. Hiding a pane leaves
 * one of these rather than nothing, so there's always a visible way back and
 * room for an ambient signal from what's hidden.
 *
 * Only the strip's own layout lives here; the surface is the caller's, because
 * the two panes that collapse don't look alike — the terminal is a floating
 * card, the sidebar a flush column against the window edge.
 */
export function Rail({ children, className }: RailProps): ReactNode {
  return (
    <div
      className={clsx(
        "flex h-full flex-col items-center gap-1.5 overflow-hidden py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Hairline between groups of rail entries. */
export function RailSeparator({
  className,
}: {
  className?: string;
}): ReactNode {
  return <div className={clsx("h-px w-4 shrink-0 bg-edge/60", className)} />;
}

interface RailButtonProps {
  label: string;
  edge: RailEdge;
  onClick: () => void;
  children: ReactNode;
}

export function RailButton({
  label,
  edge,
  onClick,
  children,
}: RailButtonProps): ReactNode {
  return (
    <SimpleTooltip content={label} side={railTooltipSide(edge)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded
                   text-fg-muted hover:bg-fg/[0.08] hover:text-fg-secondary"
      >
        {children}
      </button>
    </SimpleTooltip>
  );
}

interface RailTabProps {
  /** Text along the tab. Rotated, so keep it to the row's own short name. */
  text: string;
  /** Full description for the tooltip and screen readers. */
  label: string;
  edge: RailEdge;
  active?: boolean;
  onClick: () => void;
  /** Status marker shown at the tab's head, above the label. */
  marker?: ReactNode;
}

/**
 * One entry in a rail: a filing-folder tab, label and all, turned on its side.
 *
 * A rail is 36px wide, which is enough for an icon and nothing else — so the
 * first version of this showed a single-letter monogram and leaned on tooltips
 * for the rest. Rotating the label instead spends the one dimension a rail has
 * plenty of. The text reads bottom-to-top, the convention for tabs on a left
 * edge, and truncates rather than growing without limit.
 */
export function RailTab({
  text,
  label,
  edge,
  active = false,
  onClick,
  marker,
}: RailTabProps): ReactNode {
  return (
    <SimpleTooltip content={label} side={railTooltipSide(edge)}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-current={active ? "true" : undefined}
        className={clsx(
          "flex w-6 shrink-0 flex-col items-center gap-1 rounded px-0.5 py-1.5",
          "transition-colors duration-100",
          active
            ? "bg-surface-raised text-fg-secondary"
            : "text-fg-muted hover:bg-fg/[0.08] hover:text-fg-secondary",
        )}
      >
        {marker}
        <span
          className="max-h-32 truncate text-[11px] leading-none
                     [writing-mode:vertical-rl] rotate-180"
        >
          {text}
        </span>
      </button>
    </SimpleTooltip>
  );
}

/**
 * Restore glyph: the terminal panel's minimize chevron mirrored, so it points
 * off the rail's edge and into the content region — the direction the pane
 * grows when you click it.
 */
export function RailRestoreIcon({ edge }: { edge: RailEdge }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      className={`h-3.5 w-3.5 ${edge === "left" ? "-scale-x-100" : ""}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 4 5 8l4 4" />
      <line x1="12" y1="3.5" x2="12" y2="12.5" />
    </svg>
  );
}
