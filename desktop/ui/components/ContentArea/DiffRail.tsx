import type { ReactNode } from "react";
import { useReviewStore } from "../../stores";
import { useReviewProgress } from "../../hooks/useReviewProgress";
import { SimpleTooltip } from "../ui/tooltip";
import { ProgressRing } from "../ui/progress-ring";
import {
  Rail,
  RailButton,
  RailRestoreIcon,
  railTooltipSide,
  type RailEdge,
} from "../ui/rail";

/**
 * The diff's collapsed state, shown while the terminal is maximized over it —
 * the mirror of TerminalRail, on the opposite edge. Maximizing means "give the
 * terminal everything", so this stays as narrow as the terminal's own rail and
 * carries exactly one thing worth knowing from a shell: how much of the review
 * is left.
 */
export function DiffRail(): ReactNode {
  const terminalDockSide = useReviewStore((s) => s.terminalDockSide);
  const toggleTerminalPanelMaximized = useReviewStore(
    (s) => s.toggleTerminalPanelMaximized,
  );
  const progress = useReviewProgress();

  // The diff is pushed to whichever edge the terminal isn't docked to.
  const edge: RailEdge = terminalDockSide === "left" ? "right" : "left";
  const remaining = progress.pendingHunks + progress.savedForLaterHunks;

  return (
    <Rail className="bg-surface">
      <RailButton
        label="Show diff (⇧⌘↵)"
        edge={edge}
        onClick={toggleTerminalPanelMaximized}
      >
        <RailRestoreIcon edge={edge} />
      </RailButton>

      {progress.totalHunks > 0 && (
        <>
          <div className="h-px w-4 shrink-0 bg-edge/60" />
          <SimpleTooltip
            content={`${progress.reviewedHunks}/${progress.totalHunks} hunks reviewed${
              remaining > 0 ? ` · ${remaining} left` : ""
            }`}
            side={railTooltipSide(edge)}
          >
            <div className="flex shrink-0 cursor-default flex-col items-center gap-0.5">
              {/* Review completion as a ring — readable at a glance from
                  across the room, which a "12/40" is not at this size. */}
              <ProgressRing
                percent={progress.reviewedPercent}
                size={20}
                strokeWidth={2.5}
                radius={8}
                className="h-5 w-5"
                arcClassName={
                  progress.rejectedHunks > 0
                    ? "stroke-status-rejected"
                    : "stroke-status-approved"
                }
              />
              <span className="text-xxs text-fg-faint tabular-nums">
                {remaining > 0 ? remaining : "✓"}
              </span>
            </div>
          </SimpleTooltip>
        </>
      )}
    </Rail>
  );
}
