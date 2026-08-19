import { useMemo } from "react";
import { useReviewStore } from "../index";
import {
  findTab,
  selectTabsByWorkspaceId,
  terminalDockPresent,
  terminalSeverity,
} from "../slices/terminalSlice";
import { useFocusedWorkspace } from "./workspaces";
import {
  sessionTitle,
  tabGlance,
  type TabGlance,
} from "../../components/Terminal/glance";
import type { TerminalTab } from "../slices/terminalSlice";
import type {
  TerminalPhase,
  TerminalSessionInfo,
  TerminalStatus,
} from "../../types";

/** Everything the terminal roll-ups read that lives in the store. */
export interface TerminalState {
  terminalTabs: TerminalTab[];
  terminalSessions: Record<string, TerminalSessionInfo>;
  terminalStatuses: Record<string, TerminalStatus>;
  terminalExited: Record<string, number | null>;
}

/** What a workspace's own terminals amount to, as the queue wears it. */
export interface WorkspaceTerminals {
  /** How many tabs the workspace holds — zero is what makes it dormant. */
  tabs: number;
  /** The loudest phase among them, or null when it holds none. */
  phase: TerminalPhase | null;
  /**
   * The one line a blocked terminal is blocked on — what the escape that
   * raised the attention actually said. Null unless something is waiting *and*
   * said something: the snippet is the card's loudest element, and it must not
   * appear for a workspace that is merely busy.
   */
  waitingOn: string | null;
  /**
   * When the workspace most recently *became* blocked, as epoch ms — the
   * newest transition into a waiting phase among its terminals, else null.
   *
   * The timestamp rather than the fact, because "has the human seen this?"
   * needs something to compare a last-focused moment against. Newest rather
   * than oldest: a second agent stopping for a person is a new thing to look
   * at, even if the first one has already been acknowledged.
   */
  waitingSince: number | null;
  /**
   * When a terminal here most recently *raised an attention*, as epoch ms —
   * narrower than `waitingSince`, which also counts a shell sitting at its
   * prompt.
   *
   * This is what the badge counts, and the difference is the whole point: a
   * shell waiting for you to type is not an interruption, and a dock badge that
   * lit for every idle prompt would be on permanently. The backend's own
   * `enteredStateAt` rather than the moment this window noticed, so a reload
   * doesn't reset what the human has and hasn't seen.
   */
  needsAttentionSince: number | null;
}

const NO_TERMINALS: WorkspaceTerminals = {
  tabs: 0,
  phase: null,
  waitingOn: null,
  waitingSince: null,
  needsAttentionSince: null,
};

/**
 * The roll-ups, cached on input identity — the pattern `getSidebarTree` uses,
 * and for the same reason.
 *
 * Five mounted components read these (the queue, the collapsed rail, the stage
 * header, the terminal panel, the terminal rail). Per-consumer `useMemo` meant
 * five rebuilds on every status push — and, worse, five *distinct* objects, so
 * every downstream `memo` that took one as a prop was defeated by identity.
 * Statuses arrive seconds apart for every agent in the window, so this is the
 * steady-state cost of an idle window rather than a rare one.
 */
let tabsCache: {
  deps: readonly unknown[];
  out: Record<string, string[]>;
} | null = null;
let rollUpCache: {
  deps: readonly unknown[];
  out: Record<string, WorkspaceTerminals>;
} | null = null;

function hits(
  cached: { deps: readonly unknown[] } | null,
  deps: readonly unknown[],
) {
  return cached != null && deps.every((dep, i) => dep === cached.deps[i]);
}

/** Tab ids grouped by the workspace they belong to, in strip order. */
export function getTabsByWorkspaceId(
  state: TerminalState,
): Record<string, string[]> {
  const deps = [state.terminalTabs, state.terminalSessions];
  if (hits(tabsCache, deps)) return tabsCache!.out;
  const out = selectTabsByWorkspaceId(state);

  // Per-workspace identity, the same rule the roll-up below keeps and for the
  // same reason: `terminalTabs` is replaced by things that have nothing to do
  // with which tabs exist — focusing a pane, folding one, and `resizeSplit`,
  // which fires rafThrottled for the whole of a divider drag. Handing every
  // card a fresh array on each of those re-rendered the entire queue at 60fps
  // for a gesture happening in the terminal panel.
  const previous = tabsCache?.out ?? {};
  for (const [workspaceId, tabIds] of Object.entries(out)) {
    const before = previous[workspaceId];
    if (before && sameIds(before, tabIds)) out[workspaceId] = before;
  }

  tabsCache = { deps, out };
  return out;
}

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

/** Every workspace's terminal state, in one pass over the tabs. */
export function getTerminalsByWorkspaceId(
  state: TerminalState,
): Record<string, WorkspaceTerminals> {
  const deps = [
    state.terminalTabs,
    state.terminalSessions,
    state.terminalStatuses,
    state.terminalExited,
  ];
  if (hits(rollUpCache, deps)) return rollUpCache!.out;

  const previous = rollUpCache?.out ?? {};
  const byWorkspace = getTabsByWorkspaceId(state);
  const out: Record<string, WorkspaceTerminals> = {};

  for (const [workspaceId, tabIds] of Object.entries(byWorkspace)) {
    const own = tabIds
      .map((tabId) => findTab(state.terminalTabs, tabId))
      .filter((tab) => tab != null)
      .flatMap(
        (tab) =>
          tabGlance(
            tab,
            state.terminalSessions,
            state.terminalStatuses,
            state.terminalExited,
          ).statuses,
      );
    const phase = terminalSeverity(own);
    const blocked = wantsAHuman(phase);
    const next: WorkspaceTerminals = {
      tabs: tabIds.length,
      phase,
      waitingOn: blocked ? waitingLine(own) : null,
      waitingSince: blocked ? waitingSince(own) : null,
      needsAttentionSince: newestEnteredAt(
        own.filter((s) => s.phase === "needs_attention"),
      ),
    };
    // One agent's status tick changes one workspace's entry; every other
    // workspace keeps the object it had, so its card's `memo` bails instead of
    // re-rendering the whole queue.
    const before = previous[workspaceId];
    out[workspaceId] = before && sameTerminals(before, next) ? before : next;
  }

  rollUpCache = { deps, out };
  return out;
}

function sameTerminals(a: WorkspaceTerminals, b: WorkspaceTerminals): boolean {
  return (
    a.tabs === b.tabs &&
    a.phase === b.phase &&
    a.waitingOn === b.waitingOn &&
    a.waitingSince === b.waitingSince &&
    a.needsAttentionSince === b.needsAttentionSince
  );
}

/** [`getTabsByWorkspaceId`] as a hook. */
export function useTabsByWorkspaceId(): Record<string, string[]> {
  return useReviewStore(getTabsByWorkspaceId);
}

/** [`getTerminalsByWorkspaceId`] as a hook. */
export function useTerminalsByWorkspaceId(): Record<
  string,
  WorkspaceTerminals
> {
  return useReviewStore(getTerminalsByWorkspaceId);
}

/**
 * The tabs of one workspace, or every tab when none is focused.
 *
 * Shared by the terminal panel and the rail so the strip and the strip-turned-
 * sideways cannot list different terminals. Cached on the grouping's identity,
 * so the filtered array is stable between status ticks.
 */
export function useWorkspaceTabs(workspaceId: string | null): TerminalTab[] {
  const tabs = useReviewStore((s) => s.terminalTabs);
  const byWorkspace = useTabsByWorkspaceId();

  return useMemo(() => {
    if (!workspaceId) return tabs;
    const own = new Set(byWorkspace[workspaceId] ?? []);
    return tabs.filter((tab) => own.has(tab.id));
  }, [tabs, byWorkspace, workspaceId]);
}

/** [`getTerminalsByWorkspaceId`] for one workspace, with the empty answer. */
export function workspaceTerminals(
  byId: Record<string, WorkspaceTerminals>,
  workspaceId: string | null,
): WorkspaceTerminals {
  return (workspaceId ? byId[workspaceId] : undefined) ?? NO_TERMINALS;
}

/** Whether a phase is one that has stopped and is waiting on a person. */
export function wantsAHuman(phase: TerminalPhase | null): boolean {
  return phase === "needs_attention" || phase === "waiting_for_input";
}

/**
 * The blocked session's own words, and nothing else.
 *
 * Broader than `attentionText` in which phases it will take them from — a shell
 * stopped at a prompt is waiting on a person just as much as an agent that
 * raised an attention — but not in what it will say. It used to fall back to
 * the session's *title*, which is the string the card already draws on that
 * terminal's own row: the line meant to say what is being asked instead said
 * "Claude Code" under a row reading "Claude Code". A terminal that stopped
 * without saying why is reported by its phase, which its row is already
 * wearing.
 */
function waitingLine(statuses: TerminalStatus[]): string | null {
  return (
    statuses
      .filter((s) => wantsAHuman(s.phase))
      .map((s) => s.attentionMessage)
      .find((text) => !!text) ?? null
  );
}

/** The newest transition into a waiting phase; see `waitingSince`. */
function waitingSince(statuses: TerminalStatus[]): number | null {
  return newestEnteredAt(statuses.filter((s) => wantsAHuman(s.phase)));
}

/** The newest of these statuses' transitions, or null when there are none. */
function newestEnteredAt(statuses: TerminalStatus[]): number | null {
  return statuses.length === 0
    ? null
    : Math.max(...statuses.map((s) => s.enteredStateAt));
}

/** One pane of a tab, as the row's status cluster draws it. */
export interface TabPaneGlance {
  id: string;
  phase: TerminalPhase;
  dead: boolean;
  title: string;
}

/** What every surface that lists a tab by name needs to draw one row. */
export interface TabRowGlance extends TabGlance {
  /** The session behind the title — where the row's repo attribution comes from. */
  session: TerminalSessionInfo | undefined;
  /** That session's exit code, for a row that reports one. */
  exitCode: number | null | undefined;
  /**
   * Every pane, in tree order. A row summarizes its tab with one phase, which
   * is the loudest of these — the cluster is how a split tab says which of its
   * panes that was. A pane the status stream hasn't reported on yet reads as
   * idle rather than being left out, so the cluster's count is the tab's.
   */
  panes: TabPaneGlance[];
}

/**
 * A tab resolved for display, or null when there is nothing to show yet.
 *
 * Null carries the sidebar's membership rule: a tab whose panes the status
 * stream hasn't reported on has no phase, no title and no place in a list — the
 * rule was pasted into every row that listed one.
 */
export function useTabGlance(tabId: string): TabRowGlance | null {
  return useReviewStore((s) => getTabGlances(s)[tabId] ?? null);
}

let glanceCache: {
  deps: readonly unknown[];
  out: Record<string, TabRowGlance>;
} | null = null;

/**
 * Every tab's glance, built in one pass and cached like its siblings above.
 *
 * This used to be four whole-map subscriptions plus a per-consumer `useMemo`,
 * which meant one agent's status tick re-rendered *every* terminal row in the
 * window and re-walked every tab's pane tree — the opposite of what the rows
 * were built to do. Sharing one build, and keeping the identity of each tab
 * whose fields didn't move, is what makes zustand's own equality check bail for
 * the rows that didn't change.
 */
function getTabGlances(state: TerminalState): Record<string, TabRowGlance> {
  const deps = [
    state.terminalTabs,
    state.terminalSessions,
    state.terminalStatuses,
    state.terminalExited,
  ];
  if (hits(glanceCache, deps)) return glanceCache!.out;

  const previous = glanceCache?.out ?? {};
  const out: Record<string, TabRowGlance> = {};
  for (const tab of state.terminalTabs) {
    const glance = tabGlance(
      tab,
      state.terminalSessions,
      state.terminalStatuses,
      state.terminalExited,
    );
    // The membership rule: a tab whose panes the status stream hasn't reported
    // on has no phase, no title and no place in a list.
    if (glance.statuses.length === 0) continue;
    const next: TabRowGlance = {
      ...glance,
      session: state.terminalSessions[tab.focused],
      exitCode: state.terminalExited[tab.focused],
      panes: glance.leafIds.map((id) => ({
        id,
        phase: state.terminalStatuses[id]?.phase ?? "idle",
        dead: id in state.terminalExited,
        title: sessionTitle(
          state.terminalStatuses[id],
          state.terminalSessions[id],
        ),
      })),
    };
    const before = previous[tab.id];
    out[tab.id] = before && sameGlance(before, next) ? before : next;
  }

  glanceCache = { deps, out };
  return out;
}

/** What a row actually draws — deeper equality would cost more than it saves. */
function sameGlance(a: TabRowGlance, b: TabRowGlance): boolean {
  return (
    a.title === b.title &&
    a.severity === b.severity &&
    a.allDead === b.allDead &&
    a.exitCode === b.exitCode &&
    a.session === b.session &&
    a.leafIds.length === b.leafIds.length &&
    a.panes.length === b.panes.length &&
    a.panes.every((pane, i) => {
      const other = b.panes[i];
      return (
        pane.id === other.id &&
        pane.phase === other.phase &&
        pane.dead === other.dead &&
        pane.title === other.title
      );
    })
  );
}

/**
 * Whether the stage is actually split between two halves right now.
 *
 * `TerminalDock` decides this, and the code half's own bar has to reach the
 * same answer — a Focus button on a stage with nothing to take the room from
 * would report a state the screen doesn't have. One hook, so the two can't
 * disagree.
 */
export function useTerminalDockPresent(): boolean {
  const terminalsSupported = useReviewStore((s) => s.terminalsSupported);
  const terminalTabs = useReviewStore((s) => s.terminalTabs);
  const repoPath = useReviewStore((s) => s.repoPath);
  const focused = useFocusedWorkspace();
  // Just the boolean, not the whole roll-up: subscribing to the roll-up would
  // re-render every consumer on any status tick in any workspace.
  const hasTabs = useReviewStore(
    (s) => (getTabsByWorkspaceId(s)[focused?.id ?? ""] ?? []).length > 0,
  );

  // A workspace with neither a terminal nor a repo has no terminal half at
  // all: its stage is the empty state, whose own left half offers to start
  // one.
  const scoped = focused === null || hasTabs || focused.attachments.length > 0;
  return (
    scoped &&
    terminalDockPresent({ terminalsSupported, terminalTabs, repoPath })
  );
}
