import { terminalSeverity } from "../../stores/slices/terminalSlice";
import { basename } from "../Sidebar/terminal-status-format";
import { collectLeafIds, type TerminalTab } from "./pane-tree";
import { agentKind, type AgentKind } from "./agent-kind";
import type {
  TerminalPhase,
  TerminalSessionInfo,
  TerminalStatus,
} from "../../types";

/**
 * Pure "what would a glance at this terminal say?" helpers, shared by every
 * surface that summarizes sessions it isn't showing — the tab strip, both
 * collapsed rails, the sidebar badge, and the overview grid. Split out so the
 * summaries can't drift apart, and so they're testable without the store.
 */

/** What a tab's strip entry / rail entry needs to know, computed once. */
export interface TabGlance {
  leafIds: string[];
  statuses: TerminalStatus[];
  severity: TerminalPhase | null;
  /** Every pane's shell has exited — the tab is a corpse, not idle. */
  allDead: boolean;
  title: string;
  /**
   * The one session a single-session summary of this tab should show:
   * the most severe pane, falling back to the focused one.
   */
  primaryId: string;
  /**
   * The agent running in the pane this tab is summarised by, if the app
   * recognises one — what its marker wears instead of the terminal glyph.
   */
  agent: AgentKind | null;
}

/** The name a session goes by everywhere it's listed. */
export function sessionTitle(
  status: TerminalStatus | undefined,
  session: TerminalSessionInfo | undefined,
): string {
  return (
    status?.title || session?.title || basename(session?.cwd ?? "") || "shell"
  );
}

/**
 * The most severe status, oldest-in-state first among equals — "who has been
 * asking the longest" is the tie-break a human would use.
 */
export function primaryStatus(
  statuses: TerminalStatus[],
): TerminalStatus | null {
  const worst = terminalSeverity(statuses);
  if (worst === null) return null;
  const candidates = statuses.filter((s) => s.phase === worst);
  candidates.sort((a, b) => a.enteredStateAt - b.enteredStateAt);
  return candidates[0] ?? null;
}

/** Summarize a tab's panes for its strip/rail entry. */
export function tabGlance(
  tab: TerminalTab,
  sessions: Record<string, TerminalSessionInfo>,
  statuses: Record<string, TerminalStatus>,
  exited: Record<string, number | null>,
): TabGlance {
  const leafIds = collectLeafIds(tab.root);
  const leafStatuses = leafIds
    .map((id) => statuses[id])
    .filter((s): s is TerminalStatus => s != null);
  const primary = primaryStatus(leafStatuses);
  return {
    leafIds,
    statuses: leafStatuses,
    severity: terminalSeverity(leafStatuses),
    allDead: leafIds.every((id) => id in exited),
    title: sessionTitle(statuses[tab.focused], sessions[tab.focused]),
    primaryId: primary?.id ?? tab.focused,
    // Read off the same pane the tab is named and coloured by, so the mark, the
    // title and the phase all describe one shell rather than three.
    agent: agentKind(primary?.runningCommand ?? null),
  };
}

const NEEDS_YOU_RANK: Partial<Record<TerminalPhase, number>> = {
  needs_attention: 0,
  waiting_for_input: 1,
};

interface NeedsYouState {
  terminalSessions: Record<string, TerminalSessionInfo>;
  terminalStatuses: Record<string, TerminalStatus>;
  terminalExited: Record<string, number | null>;
}

function wantsHuman(state: NeedsYouState, id: string): boolean {
  if (id in state.terminalExited) return false;
  const phase = state.terminalStatuses[id]?.phase;
  return phase != null && phase in NEEDS_YOU_RANK;
}

/**
 * Whether anything wants a human — the `isEnabled` predicate for ⌥⌘`, which
 * every command resolve re-runs on every store write. Short-circuits rather
 * than building the queue just to measure it.
 */
export function hasNeedsYou(state: NeedsYouState): boolean {
  return Object.keys(state.terminalSessions).some((id) =>
    wantsHuman(state, id),
  );
}

/**
 * Live sessions that want a human, most in need first: attention (oldest ask
 * first), then shells sitting at a prompt. The order ⌥⌘` walks.
 */
export function needsYouQueue(state: NeedsYouState): string[] {
  return Object.keys(state.terminalSessions)
    .filter((id) => wantsHuman(state, id))
    .map((id) => state.terminalStatuses[id]!)
    .sort(
      (a, b) =>
        NEEDS_YOU_RANK[a.phase]! - NEEDS_YOU_RANK[b.phase]! ||
        a.enteredStateAt - b.enteredStateAt,
    )
    .map((st) => st.id);
}

/**
 * The last `n` lines of a peek, trailing whitespace dropped. The peek is
 * already trimmed to the visible screen's tail by the backend; this is the
 * further cut a card-sized box makes.
 */
export function tailLines(text: string, n: number): string {
  const lines = text.replace(/\s+$/, "").split("\n");
  return lines
    .slice(Math.max(0, lines.length - n))
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n");
}
