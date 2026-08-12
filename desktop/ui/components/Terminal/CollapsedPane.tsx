import type { ReactNode } from "react";
import { clsx } from "clsx";
import { useReviewStore } from "../../stores";
import { PhaseDot } from "../TabRail/PhaseDot";
import { phaseSummary } from "../TabRail/terminal-status-format";
import { RICH_TOOLTIP_CLASS, SimpleTooltip } from "../ui/tooltip";
import { sessionTitle } from "./glance";
import type { SplitDirection } from "./pane-tree";
import { TerminalGlanceCard } from "./TerminalGlanceCard";

interface CollapsedPaneProps {
  id: string;
  /**
   * The parent split's direction — the axis the pane was sharing. A pane in a
   * row folds sideways into a vertical strip; one in a column folds down into a
   * horizontal bar.
   */
  direction: SplitDirection;
  onExpand: () => void;
}

/**
 * A pane folded down to its title, the way a collapsed sidebar leaves a rail
 * behind. The session keeps running and keeps its share of the split's sizes —
 * unfolding puts it back exactly where it was, which is what makes this a
 * better "get out of my way" than dragging the divider down to a sliver.
 *
 * The bar carries the same phase dot the tab strip does, so a shell that starts
 * asking for a human while folded away still says so, and hovering peeks at its
 * screen without unfolding it.
 */
export function CollapsedPane({
  id,
  direction,
  onExpand,
}: CollapsedPaneProps): ReactNode {
  const session = useReviewStore((s) => s.terminalSessions[id]);
  const status = useReviewStore((s) => s.terminalStatuses[id]);
  const dead = useReviewStore((s) => id in s.terminalExited);

  const title = sessionTitle(status, session);
  const phase = status?.phase ?? "idle";
  const state = dead ? "exited" : phaseSummary(phase, status ? [status] : []);
  const vertical = direction === "row";

  return (
    // The gutter a pane has, kept so folding one doesn't move the seam between
    // it and its neighbour.
    <div className="flex h-full w-full p-1.5">
      <SimpleTooltip
        content={
          dead ? `${title} — exited` : <TerminalGlanceCard sessionId={id} />
        }
        side={vertical ? "right" : "top"}
        contentClassName={dead ? undefined : RICH_TOOLTIP_CLASS}
      >
        <button
          type="button"
          onClick={onExpand}
          aria-label={`Show ${title} — ${state}`}
          aria-expanded={false}
          className={clsx(
            "flex items-center gap-1.5 rounded bg-fg/[0.04]",
            "text-fg-muted transition-colors",
            "hover:bg-fg/[0.08] hover:text-fg-secondary",
            // The bar's own thickness — the one size in a split that isn't a
            // fraction, which is why its flex child doesn't grow.
            vertical ? "h-full w-5 flex-col py-1" : "h-5 w-full flex-row px-1",
          )}
        >
          <PhaseDot phase={phase} dead={dead} />
          <span
            className={clsx(
              "truncate text-[11px] leading-none",
              // Bottom-to-top, the way a tab turned on its side reads — and
              // what the collapsed rails already look like.
              vertical
                ? "min-h-0 [writing-mode:vertical-rl] rotate-180"
                : "min-w-0",
            )}
          >
            {title}
          </span>
        </button>
      </SimpleTooltip>
    </div>
  );
}
