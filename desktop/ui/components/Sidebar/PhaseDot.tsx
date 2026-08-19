import { useEffect, useRef, useState, type ReactNode } from "react";
import { clsx } from "clsx";
import { phaseTextClass } from "./terminal-status-format";
import { ClaudeIcon, CodexIcon, TerminalGlyphIcon } from "../ui/icons";
import { wantsAHuman } from "../../stores/selectors/terminals";
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
 * Nothing here loops. `working` and `needs_attention` used to pulse, which meant
 * any window with a live agent in the sidebar kept a CSS animation running for
 * as long as it was open — frames spent forever to repeat a signal the colour
 * already carries.
 *
 * The one motion left is spent on the thing a colour cannot say: that this
 * *just changed*. A marker whose session **enters** a phase that wants a human
 * knocks once (`attention-knock`, ~600ms) and then holds still. Colour reports
 * the state, motion reports the transition — so it fires when a session stops
 * for you and never while one is merely busy, and it costs frames only at the
 * moment it is telling you something. A marker mounting into an already-waiting
 * session does not knock: that is a state, and it is the colour's to carry.
 *
 * The workspace `StatusDot` deliberately stays still through the same event. It
 * sits on the card these rows are on, so knocking both would be one event
 * drawn twice; this is the marker that says *which* terminal.
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
  const knock = useAttentionKnock(phase, dead);
  return (
    <Glyph
      // Remounting is what restarts the animation: a second transition while
      // the first is still playing would otherwise change nothing about the
      // class list and go unseen.
      key={knock}
      className={clsx(
        "inline-block h-3 w-3 shrink-0",
        dead ? "text-fg-faint" : phaseTextClass(phase),
        knock > 0 && "animate-attention-knock",
        className,
      )}
    />
  );
}

/** How long `attention-knock` runs. Keep in step with `index.css`. */
const KNOCK_MS = 600;

/**
 * Zero, or a nonce that changes each time this marker *watches* its session
 * enter a phase that wants a human.
 *
 * Watches is the whole rule. The first phase a marker sees is where the session
 * already was — mounting a row, opening the sidebar, or switching to the tab
 * would otherwise knock for transitions that happened while nobody was looking,
 * which is the "everything moves at once" failure that made the old pulse worth
 * removing. Only a change observed from one phase to another is an event.
 */
function useAttentionKnock(phase: TerminalPhase, dead: boolean): number {
  const previous = useRef<TerminalPhase | null>(null);
  const [knock, setKnock] = useState(0);

  useEffect(() => {
    const before = previous.current;
    previous.current = phase;
    if (before === null || before === phase) return;
    if (dead || !wantsAHuman(phase)) return;

    setKnock((n) => n + 1);
    const timer = window.setTimeout(() => setKnock(0), KNOCK_MS);
    return () => window.clearTimeout(timer);
  }, [phase, dead]);

  return knock;
}
