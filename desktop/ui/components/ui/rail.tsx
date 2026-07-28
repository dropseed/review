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
  /** Background of the pane this rail stands for, so collapsing reads as that
   *  pane narrowing rather than different chrome appearing. */
  className?: string;
}

/**
 * A collapsed pane: the same card the pane uses, narrowed to a strip on its
 * dock edge. Hiding a pane leaves one of these rather than nothing, so there's
 * always a visible way back and room for an ambient signal from what's hidden.
 */
export function Rail({ children, className }: RailProps): ReactNode {
  return (
    <div
      className={clsx(
        "panel-card flex h-full w-full flex-col items-center gap-1.5 overflow-hidden py-1.5",
        className,
      )}
    >
      {children}
    </div>
  );
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
