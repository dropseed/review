import type { ReactNode } from "react";
import { clsx } from "clsx";
import { wantsAHuman } from "../../stores/selectors/terminals";
import type { TerminalPhase } from "../../types";

/**
 * What a workspace is, as one mark.
 *
 * Deliberately a coarser question than `PhaseDot` answers. A terminal's dot
 * says what that shell is doing — working, waiting, in trouble — because you
 * are looking at the shell. A workspace's dot is read from across the room and
 * only has to answer "does this want me": both of the phases that have stopped
 * for a person collapse into one amber, which is why amber can be the loudest
 * thing in the window instead of one of four colours competing.
 */
export type WorkspaceState = "running" | "waiting" | "idle" | "dormant";

/**
 * The state a workspace's terminals put it in. No terminals at all is
 * `dormant` — the density the queue draws as a single line.
 */
export function workspaceState(
  phase: TerminalPhase | null,
  hasTerminals: boolean,
): WorkspaceState {
  if (!hasTerminals) return "dormant";
  // The same rule the waiting snippet is chosen by, so a card can never show
  // an amber line under a green dot.
  if (wantsAHuman(phase)) return "waiting";
  if (phase === "working") return "running";
  return "idle";
}

export const STATE_LABEL: Record<WorkspaceState, string> = {
  running: "Running",
  waiting: "Waiting for you",
  idle: "Idle",
  dormant: "Not started",
};

/**
 * Running and waiting carry a glow; idle and dormant carry none. The glow is
 * what makes one card findable in a list of ten without any of them animating —
 * see the `PhaseDot` note on why nothing in this app pulses.
 */
const DOT_CLASS: Record<WorkspaceState, string> = {
  running: "bg-pr-open shadow-[0_0_6px_var(--color-pr-open)]",
  waiting: "bg-status-saved shadow-[0_0_6px_var(--color-status-saved)]",
  idle: "bg-fg-faint/50",
  dormant: "border border-fg-faint/50",
};

export function StatusDot({
  state,
  className,
}: {
  state: WorkspaceState;
  className?: string;
}): ReactNode {
  return (
    <span
      aria-hidden="true"
      className={clsx(
        "inline-block size-[7px] shrink-0 rounded-full",
        DOT_CLASS[state],
        className,
      )}
    />
  );
}
