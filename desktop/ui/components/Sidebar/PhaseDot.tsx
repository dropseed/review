import type { ReactNode } from "react";
import { clsx } from "clsx";
import { phaseTextClass } from "./terminal-status-format";
import { ClaudeIcon, CodexIcon, TerminalGlyphIcon } from "../ui/icons";
import type { AgentKind } from "../Terminal/agent-kind";
import type { TerminalPhase } from "../../types";

interface PhaseDotProps {
  phase: TerminalPhase;
  /** Every session it stands for has exited — the shell is gone, not idle. */
  dead?: boolean;
  /**
   * The agent running in it, if the app recognises one — see
   * `Terminal/agent-kind`. Its mark replaces the terminal glyph.
   */
  agent?: AgentKind | null;
  className?: string;
}

const AGENT_GLYPHS: Record<
  AgentKind,
  (props: { className?: string }) => ReactNode
> = {
  claude: ClaudeIcon,
  codex: CodexIcon,
};

/**
 * The status marker for a terminal phase: a terminal glyph coloured by phase.
 *
 * It was a 6px dot, which said "something has a state" but not what kind of
 * thing — in a sidebar where rows also carry PR and presence markers, a bare
 * dot is the one shape that names nothing. The glyph says "terminal" and the
 * colour still carries the phase, so no row needs a second marker to explain
 * the first.
 *
 * Kept as a component rather than another `phaseTextClass` call site because
 * the colour is only half the rule — an exited session reads as grey whatever
 * phase it died in, and that was being restated at every marker in the app.
 * Lives here rather than in `terminal-status-format` so that module stays
 * JSX-free and unit-testable.
 *
 * The marker does not animate. `working` and `needs_attention` used to pulse,
 * which meant any window with a live agent in the sidebar ran a CSS animation
 * forever — style resolution and a layer commit every frame, for a signal the
 * colour already carries.
 *
 * A shell running an agent wears that agent's mark instead of the terminal
 * glyph, in the same phase colour. Which agent is the far more useful half of
 * "what is this row" once a queue holds several, and the colour still answers
 * the phase — so this adds identity without adding a second marker. A dead
 * session keeps the agent's shape: what ran there is still what ran there.
 */
export function PhaseDot({
  phase,
  dead = false,
  agent = null,
  className,
}: PhaseDotProps): ReactNode {
  const Glyph = (agent && AGENT_GLYPHS[agent]) ?? TerminalGlyphIcon;
  return (
    <Glyph
      className={clsx(
        "inline-block h-3 w-3 shrink-0",
        dead ? "text-fg-faint" : phaseTextClass(phase),
        className,
      )}
    />
  );
}
