import type { ReactNode } from "react";
import { clsx } from "clsx";
import { phaseDotClass } from "./terminal-status-format";
import type { TerminalPhase } from "../../types";

interface PhaseDotProps {
  phase: TerminalPhase;
  /** Every session it stands for has exited — the shell is gone, not idle. */
  dead?: boolean;
  className?: string;
}

/**
 * The status dot for a terminal phase.
 *
 * Kept as a component rather than another `phaseDotClass` call site because
 * the class is only half the rule — which phases pulse is the other half, and
 * it was being restated at every dot in the app. Lives here rather than in
 * `terminal-status-format` so that module stays JSX-free and unit-testable.
 */
export function PhaseDot({
  phase,
  dead = false,
  className,
}: PhaseDotProps): ReactNode {
  return (
    <span
      className={clsx(
        "inline-block h-1.5 w-1.5 shrink-0 rounded-full",
        dead ? "bg-fg-faint" : phaseDotClass(phase),
        !dead &&
          (phase === "working" || phase === "needs_attention") &&
          "animate-pulse",
        className,
      )}
    />
  );
}
