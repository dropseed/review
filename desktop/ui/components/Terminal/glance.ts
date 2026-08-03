import {
  PHASE_SEVERITY,
  terminalSeverity,
} from "../../stores/slices/terminalSlice";
import { basename } from "../TabRail/terminal-status-format";
import { refFromReviewKey } from "../../utils/review-key";
import { collectLeafIds, type TerminalTab } from "./pane-tree";
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
}

/** A repo+ref's terminals, ordered for the overview grid. */
export interface TerminalGroup {
  key: string;
  label: string;
  severity: TerminalPhase | null;
  ids: string[];
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
  return {
    leafIds,
    statuses: leafStatuses,
    severity: terminalSeverity(leafStatuses),
    allDead: leafIds.every((id) => id in exited),
    title: sessionTitle(statuses[tab.focused], sessions[tab.focused]),
    primaryId: primaryStatus(leafStatuses)?.id ?? tab.focused,
  };
}

/**
 * Sort weight for a phase, with "no phase at all" below every real one so
 * exited and unknown sessions land last wherever this orders things.
 */
export function phaseRank(phase: TerminalPhase | null | undefined): number {
  return phase ? PHASE_SEVERITY[phase] : -1;
}

/**
 * Every live-or-dead terminal, bucketed by the row it lives under and ordered
 * loudest-first within and between buckets. The overview grid's whole model —
 * kept here so the "who needs a human first" rule stays in one tested place.
 */
export function overviewGroups(
  sessionsByHomeKey: Record<string, string[]>,
  sessions: Record<string, TerminalSessionInfo>,
  statuses: Record<string, TerminalStatus>,
  exited: Record<string, number | null>,
): TerminalGroup[] {
  const rank = (id: string): number => {
    if (id in exited) return -1; // corpses sort after everything
    // A live session whose status hasn't arrived yet reads as idle, not as a
    // corpse — only an actual exit drops below the phases.
    const phase = statuses[id]?.phase;
    return phase ? PHASE_SEVERITY[phase] : PHASE_SEVERITY.idle;
  };

  const groups = Object.entries(sessionsByHomeKey)
    .filter(([, ids]) => ids.length > 0)
    .map(([key, ids]) => {
      const sorted = [...ids].sort(
        (a, b) =>
          rank(b) - rank(a) ||
          (statuses[a]?.enteredStateAt ?? 0) -
            (statuses[b]?.enteredStateAt ?? 0),
      );
      const live = sorted
        .filter((id) => !(id in exited))
        .map((id) => statuses[id])
        .filter((s): s is TerminalStatus => s != null);
      const repoPath = sessions[sorted[0]]?.repoPath ?? "";
      const ref = refFromReviewKey(key, repoPath) ?? key;
      return {
        key,
        label: ref ? `${basename(repoPath)} · ${ref}` : basename(repoPath),
        severity: terminalSeverity(live),
        ids: sorted,
      };
    });

  groups.sort(
    (a, b) =>
      phaseRank(b.severity) - phaseRank(a.severity) ||
      a.label.localeCompare(b.label),
  );
  return groups;
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
