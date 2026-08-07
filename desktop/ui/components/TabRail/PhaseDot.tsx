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
 * the colour is only half the rule — an exited session reads as grey whatever
 * phase it died in, and that was being restated at every dot in the app. Lives
 * here rather than in `terminal-status-format` so that module stays JSX-free
 * and unit-testable.
 *
 * The dot does not animate. `working` and `needs_attention` used to pulse,
 * which meant any window with a live agent in the sidebar ran a CSS animation
 * forever — style resolution and a layer commit every frame, for a signal the
 * colour already carries.
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
        className,
      )}
    />
  );
}
