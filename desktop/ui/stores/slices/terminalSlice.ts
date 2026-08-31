import { toast } from "sonner";
import type {
  GlobalReviewSummary,
  RepoLocalActivity,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalPhase,
  TerminalExit,
} from "../../types";
import { makeReviewKey } from "../../utils/review-key";
import {
  attentionEdge,
  notifyTerminalAttention,
} from "../../utils/terminal-notifications";
import { signalAttention } from "../../utils/attention";
import type { SpurStore, SliceCreatorWithClientAndStorage } from "../types";
import { createDebouncedFn } from "../types";
import {
  type TerminalTab,
  type SplitDirection,
  type DropEdge,
  makeTab,
  splitLeaf,
  movePane,
  removeLeaf,
  pruneLeaves,
  collectLeafIds,
  expandedLeafIds,
  setLeafCollapsed,
  setSizesAtPath,
  reorderTabs,
  sanitizeTabs,
  withRepairedFocus,
} from "../../components/Terminal/pane-tree";

export type { TerminalTab } from "../../components/Terminal/pane-tree";

/**
 * Terminal panel state. Raw PTY output NEVER flows through the store — it goes
 * transport → xterm directly (see TerminalPane). Only session metadata,
 * statuses, exit codes, and panel layout live here.
 *
 * The tab is the unit everywhere outside the panel: one global strip holds
 * every tab regardless of repo, review or work item, and a tab's panes are
 * layout the rest of the app never sees. Sessions remain the daemon's unit —
 * tabs are this window's grouping of them.
 */
export interface TerminalSlice {
  /** Live sessions by id. */
  terminalSessions: Record<string, TerminalSessionInfo>;
  /** Latest status per session id. */
  terminalStatuses: Record<string, TerminalStatus>;
  /** Exit code per session id; presence means the PTY child is gone (dead tab). */
  terminalExited: Record<string, number | null>;
  /**
   * Every tab, in strip order. Each holds a pane tree (iTerm/tmux style); this
   * is the structure the panel renders and the sidebar counts.
   *
   * Persisted, with the two below it — see `TAB_LAYOUT_KEY`. The sessions are
   * the daemon's; how they are grouped and split is this window's, and a
   * relaunch that couldn't remember it laid every session out as its own tab.
   */
  terminalTabs: TerminalTab[];
  /** The tab the panel is showing (persisted). */
  activeTabId: string | null;
  /**
   * When each tab was last brought to the front, as a counter rather than a
   * clock — the only question asked of it is "which of these is most recent",
   * and two tabs activated in the same millisecond still have an order.
   * Window-local, like the tab ids it is keyed by, and persisted with them so
   * "the workspace's latest tab" survives a relaunch.
   */
  terminalTabUsedAt: Record<string, number>;
  /**
   * Ids of sessions created in THIS window that have not yet been opened by a
   * pane. A fresh session has no scrollback worth replaying, so the pane skips
   * the replay round-trip. Consumed (removed) on first pane mount.
   */
  freshTerminalIds: string[];
  /**
   * Every checkout the app currently knows about, per repo, and which review
   * key owns it. This is what a session's cwd is resolved against, so the
   * overview's grouping and a tab's "your directory is gone" warning answer the
   * same question the same way instead of agreeing by coincidence.
   */
  terminalCheckouts: CheckoutIndex;

  /** Which surface holds the content region's focus (persisted). */
  contentFocus: ContentFocus;
  /**
   * Whether the stage is showing every terminal in the app side by side
   * instead of one workspace's.
   *
   * Deliberately not persisted, unlike the layout above: this is a look
   * taken across the work and then put down, not a layout the window should
   * come back wearing. Launching into it would hide the code half of a
   * workspace nobody asked to leave.
   */
  terminalOverview: boolean;
  /**
   * The session whose pane is wearing the ⌘F search bar, or null. One bar at a
   * time, and not persisted for the overview's reason: a search is a look
   * taken and put down, not a layout to come back wearing.
   */
  terminalSearchId: string | null;
  /** Panel width in px (persisted) — the vertical pane's own width. */
  terminalPanelWidth: number;
  /** Whether the current backend can host terminals (probed on mount). */
  terminalsSupported: boolean;

  // ----- Actions -----

  /** Load persisted panel preferences (focus/width) and the saved tab layout,
   *  which is applied once the daemon's session list has landed too. */
  hydrateTerminalPrefs: () => Promise<void>;
  setTerminalsSupported: (supported: boolean) => void;

  /**
   * Create a new session in a NEW tab. Generates the id, subscribes to its
   * events BEFORE starting (so no status/exit is missed), then starts the PTY.
   * Resolves to the new id, or null on failure (toasted).
   */
  startTerminal: (
    repoPath: string,
    cwd: string,
    cols: number,
    rows: number,
    shell?: string,
    /**
     * The workspace to be born in, when the caller knows which. Without it the
     * backend routes by cwd; with it, the workspace and the session land
     * together. An empty `cwd` means "no directory of its own" — the backend
     * starts in home.
     */
    workspaceId?: string,
  ) => Promise<string | null>;

  /**
   * Split the focused pane of `tabId`: start a new session at the target
   * pane's cwd and insert it beside/below the target leaf. Resolves to the new
   * id, or null on failure.
   */
  splitTerminal: (
    tabId: string,
    targetTerminalId: string,
    direction: SplitDirection,
  ) => Promise<string | null>;

  /** Kill a session and remove it from the store (session maps + pane tree). */
  killTerminal: (id: string) => Promise<void>;

  /** Remove an already-dead session's pane without killing anything. */
  removeTerminal: (id: string) => void;

  /**
   * Take a live session's pane out of the strip without killing it — a close
   * that can still be undone. The session stays in the maps (it is still
   * running) but `ingestTabs` leaves it alone, so no list frame wraps it in a
   * tab again, until `restoreTerminalTabs` puts it back or `killTerminal` ends
   * it.
   */
  hideTerminal: (id: string) => void;

  /**
   * Put panes taken out by `hideTerminal` back where they were, from the
   * snapshot of the tabs that held them.
   *
   * A tab the close emptied is gone from the strip and comes back whole — as
   * the split it was, not as one tab per pane. A tab it only *thinned* is
   * still in the strip, holding the panes that survived, and the snapshot is
   * merged into it in place: the closed pane returns to its own slot, at its
   * own size, in the tab that never left. Leaves whose session has since gone
   * are dropped, and panes that arrived in the tab after the close — which
   * the snapshot has never heard of — are kept alongside. The first tab
   * touched becomes the active one.
   */
  restoreTerminalTabs: (tabs: TerminalTab[]) => void;

  /** Show `tabId` in the panel, and record it as this tab's latest use. */
  setActiveTab: (tabId: string) => void;
  /**
   * Show the workspace's most recently used tab — what activating a card does.
   * Selects; it never opens the panel or hides another workspace's tabs, because
   * the strip is one list and every tab in it stays where it was.
   */
  selectWorkspaceTab: (workspaceId: string) => void;
  /**
   * Move the tab holding `terminalId` into a workspace — the drag of a terminal
   * onto a card, and the menu verb. Panes travel with their tab, so naming any
   * one of them names the tab, and every session in it is reassigned.
   *
   * Attribution belongs to the daemon, so this is a round trip rather than a
   * local write; the store's copy is patched to match so the row moves at once.
   */
  attachTerminalToWorkspace: (
    terminalId: string,
    workspaceId: string,
  ) => Promise<void>;
  /** Publish the current checkout layout — what cwds are resolved against. */
  setTerminalCheckouts: (
    activity: RepoLocalActivity[],
    reviews: GlobalReviewSummary[],
  ) => void;
  /** Drag-to-reorder within the strip. */
  moveTab: (fromIndex: number, toIndex: number) => void;
  /** Mark `terminalId` as the focused leaf in `tabId`. */
  setFocusedTerminalPane: (tabId: string, terminalId: string) => void;
  /**
   * Drag-to-rearrange: land the pane `sourceTerminalId` against `edge` of
   * `targetTerminalId`. Both panes are already in the tab — this only
   * rearranges, it never starts or kills a session.
   *
   * The tab is resolved from the target rather than passed in: one of the two
   * gestures that ends here (the Tauri window drop) sees only a cursor position
   * and a pane, and knows nothing of the tree it crossed.
   */
  dropPaneOn: (
    sourceTerminalId: string,
    targetTerminalId: string,
    edge: DropEdge,
  ) => void;
  /**
   * Move a pane out of its own tab and into `targetTabId` — the pane grip
   * dragged onto a tab in the strip. The pane takes on the tab it joined,
   * attachment included: a tab is one place of work.
   */
  movePaneToTab: (sourceTerminalId: string, targetTabId: string) => void;
  /**
   * Pull a pane out into a tab of its own, beside the one it left. Resolves to
   * the new tab's id, or null when the pane was its tab's only one.
   */
  movePaneToNewTab: (sourceTerminalId: string) => string | null;
  /**
   * Fold a pane down to a title bar, or unfold it. Ignored when it would leave
   * the tab showing no terminal at all.
   */
  setPaneCollapsed: (
    tabId: string,
    terminalId: string,
    collapsed: boolean,
  ) => void;
  /** Set the child fractions of the split node at `path` within `tabId`. */
  resizeSplit: (tabId: string, path: number[], sizes: number[]) => void;
  /** Give a surface the content region, or neither ("split"). Persisted. */
  setContentFocus: (focus: ContentFocus) => void;
  /** Show every terminal at once, or put the stage back. */
  setTerminalOverview: (on: boolean) => void;
  /** [`setTerminalOverview`] as the one gesture that drives it. */
  toggleTerminalOverview: () => void;
  /** Open the ⌘F search bar over one pane (null closes; one bar at a time). */
  setTerminalSearchId: (id: string | null) => void;
  /** ⌘`: focus code ↔ split — the terminal in and out of view. */
  toggleTerminalPanel: () => void;
  /** ⇧⌘↵: focus terminal ↔ split — full width from wherever it starts. */
  toggleTerminalFocus: () => void;
  setTerminalPanelWidth: (width: number) => void;

  /** Mark a fresh id as consumed (pane has mounted it). */
  consumeFreshTerminal: (id: string) => void;

  /**
   * Ensure per-session subscriptions exist for `id` (idempotent). Used by
   * useTerminalEvents for sessions discovered via terminalList that this window
   * did not create.
   */
  ensureTerminalSubscription: (id: string) => void;

  // Reducers (exposed as actions that route into the pure helpers below)
  applyTerminalStatus: (status: TerminalStatus) => void;
  applyTerminalExit: (exit: TerminalExit) => void;

  /**
   * Re-attribute a session the daemon says has moved. The inbound half of
   * `attachTerminalToWorkspace`, which is the outbound one — this writes the
   * store only, because the move has already happened somewhere else.
   */
  applyTerminalWorkspace: (id: string, workspaceId: string | null) => void;

  /**
   * Mark a session the daemon has stopped listing as gone.
   *
   * Gone is not the same as closed, and this deliberately keeps the pane: an
   * exited terminal stays on screen showing what it said and what it exited
   * with until a person closes it, and a session killed from the phone should
   * read the same way here. So it lands in `terminalExited` — the map every
   * surface asks "is this dead" — and nowhere else. `teardownSession` remains
   * the one thing that removes a session, and it is reached by closing the
   * pane, never by news from the daemon.
   */
  applyTerminalRemoved: (id: string) => void;
  /**
   * Fold the daemon's session list into the session maps and the tab list:
   * wrap any session no tab holds into one of its own, and drop panes whose
   * session this window no longer knows about at all.
   */
  ingestTerminalList: (sessions: TerminalSessionInfo[]) => void;
}

/**
 * Which surface holds the content region: the code (terminal collapses to its
 * rail), the terminal (code collapses to its rail), or neither — "split", the
 * shared view. You never hide a surface, you focus the other one; whatever
 * loses focus narrows to a rail rather than vanishing.
 *
 * One value rather than open/maximized booleans, because "terminal focused
 * while hidden" is not a state the UI has — as two flags it would be an
 * invariant every action had to re-assert.
 */
export type ContentFocus = "code" | "split" | "terminal";

export const TERMINAL_PANEL_WIDTH_DEFAULT = 480;
export const TERMINAL_PANEL_WIDTH_MIN = 320;
export const TERMINAL_PANEL_WIDTH_MAX = 1000;

/**
 * Whether the app has a terminal dock at all — the one rule every surface that
 * shows, hides or commands the panel asks.
 *
 * Tabs are global, so the dock is too: a shell keeps its place on the home
 * screen the same as it does in a review. A repo counts even with no tabs yet,
 * because that is the state the panel's own "+" is for; with neither, there is
 * nothing to show and no directory to start a shell in, so the dock stays away
 * rather than offering a control that could only fail.
 */
export function terminalDockPresent(state: {
  terminalsSupported: boolean;
  terminalTabs: TerminalTab[];
  repoPath: string | null;
}): boolean {
  if (!state.terminalsSupported) return false;
  return state.terminalTabs.length > 0 || state.repoPath !== null;
}

// ----- Checkout index (cwd → owning review key) -----

/** One repo's checkout layout, as terminals need to read it. */
export interface RepoCheckouts {
  /** Every checkout root in the repo, innermost-wins ordering applied later. */
  roots: string[];
  /** Checkout root → the review key whose row owns it. */
  owners: Record<string, string>;
}

export type CheckoutIndex = Record<string, RepoCheckouts>;

/**
 * Build the checkout index from the same listings the sidebar rows are built
 * from, so a terminal's repo attribution and its sidebar row can never disagree
 * about which checkout it is sitting in.
 *
 * Derived from the raw listings rather than from the built sidebar tree: the
 * store has the listings, and going through the tree would make a data
 * question depend on a presentation structure.
 */
export function buildCheckoutIndex(
  activity: RepoLocalActivity[],
  reviews: GlobalReviewSummary[] = [],
): CheckoutIndex {
  const index: CheckoutIndex = {};

  const repoFor = (repoPath: string): RepoCheckouts => {
    let repo = index[repoPath];
    if (!repo) {
      // A repo with no branch listing still anchors attribution at its root.
      repo = { roots: [repoPath], owners: {} };
      index[repoPath] = repo;
    }
    return repo;
  };

  const add = (
    repo: RepoCheckouts,
    path: string | null | undefined,
    key: string,
  ) => {
    if (!path) return;
    if (!repo.roots.includes(path)) repo.roots.push(path);
    repo.owners[path] = key;
  };

  for (const activityRepo of activity) {
    const repo = repoFor(activityRepo.repoPath);
    for (const branch of activityRepo.branches) {
      const key = makeReviewKey(activityRepo.repoPath, branch.name);
      // The branch at the repo root has a checkout just as much as one in a
      // linked worktree — the main working tree is still a working tree.
      const path = branch.isCurrent
        ? activityRepo.repoPath
        : branch.worktreePath;
      add(repo, path, key);
    }
  }

  // Reviews whose ref is not a local branch can still own a worktree.
  for (const review of reviews) {
    const repo = repoFor(review.repoPath);
    add(repo, review.worktreePath, makeReviewKey(review.repoPath, review.ref));
  }

  return index;
}

/**
 * Whether a session's directory is gone.
 *
 * Every terminal is started inside a checkout, so a cwd that no longer falls
 * inside any of the repo's checkouts means that checkout was removed out from
 * under it. Derived from the checkout listing rather than a disk probe: the
 * listing is already the app's answer to "what exists", and asking the
 * filesystem per session per render would not be.
 *
 * Review-managed worktrees live outside the repo (`~/.spur/worktrees/...`),
 * so removing one leaves its shells matching nothing and they are flagged. A
 * hand-made worktree nested *under* the repo root still matches the root after
 * removal, so it is quietly adopted by the root row instead of flagged.
 */
export function isOrphanedSession(
  index: CheckoutIndex,
  repoPath: string,
  cwd: string,
): boolean {
  const repo = index[repoPath];
  // Nothing loaded for this repo yet — don't accuse a session of being orphaned
  // on the strength of an empty index.
  if (!repo) return false;
  return sessionCheckout(cwd, repo.roots) === null;
}

/** Severity ordering for aggregating session phases into one signal. */
export const PHASE_SEVERITY: Record<TerminalPhase, number> = {
  needs_attention: 3,
  waiting_for_input: 2,
  working: 1,
  idle: 0,
};

/**
 * Aggregate a set of session statuses into the most severe phase
 * (attention > waiting > working > idle). Returns null for no sessions.
 */
export function terminalSeverity(
  statuses: TerminalStatus[],
): TerminalPhase | null {
  let worst: TerminalPhase | null = null;
  for (const s of statuses) {
    if (worst === null || PHASE_SEVERITY[s.phase] > PHASE_SEVERITY[worst]) {
      worst = s.phase;
    }
  }
  return worst;
}

// ----- Pure reducers (exported for unit testing) -----

type SessionState = Pick<
  TerminalSlice,
  | "terminalSessions"
  | "terminalStatuses"
  | "terminalExited"
  | "freshTerminalIds"
>;

type TabState = Pick<TerminalSlice, "terminalTabs" | "activeTabId">;

/**
 * Tab state plus the sessions it is attributed through — what a reducer that
 * may have to re-pick the active tab needs, since which workspace a tab belongs
 * to is the daemon's answer about its sessions, not the tab's own.
 */
type TabStateWithSessions = TabState & Pick<TerminalSlice, "terminalSessions">;

/**
 * Whether two statuses say the same thing about a session.
 *
 * Every field is a primitive, so this is a plain field-wise compare rather
 * than anything structural. It exists because the same status can be delivered
 * twice — the announcement channel, and, in web mode, the socket of a pane
 * mounted on that session — and the redundant copy must not allocate a new
 * `terminalStatuses` map — see `applyTerminalStatus` on the slice.
 */
export function sameTerminalStatus(
  a: TerminalStatus,
  b: TerminalStatus,
): boolean {
  return (
    a.id === b.id &&
    a.phase === b.phase &&
    a.runningCommand === b.runningCommand &&
    a.lastExitCode === b.lastExitCode &&
    a.cwd === b.cwd &&
    a.title === b.title &&
    a.enteredStateAt === b.enteredStateAt &&
    a.shellIntegrationActive === b.shellIntegrationActive &&
    a.attentionMessage === b.attentionMessage
  );
}

/**
 * Tell the desktop app that a *workspace* is waiting on a person.
 *
 * The same edge the notification banner fires on, raised one level: a phone has
 * no idea what a session id is, and the thing you would go and look at is the
 * card, not the pane. A session the daemon hasn't placed in a workspace yet is
 * skipped rather than escalated under a name nobody would recognize.
 *
 * Gated on the same preference as the banner — one switch for "tell me when a
 * terminal stops", whichever device ends up hearing it.
 */
function escalateAttention(
  state: Pick<
    SpurStore,
    "terminalSessions" | "workspaces" | "terminalNotificationsEnabled"
  >,
  prev: TerminalStatus | undefined,
  next: TerminalStatus,
): void {
  if (!state.terminalNotificationsEnabled) return;
  if (!attentionEdge(prev, next)) return;

  const workspaceId = state.terminalSessions[next.id]?.workspaceId;
  if (!workspaceId) return;
  const workspace = state.workspaces.find((entry) => entry.id === workspaceId);
  if (!workspace) return;

  const terminal = next.title || next.runningCommand || "A terminal";
  signalAttention(
    workspaceId,
    workspace.displayTitle,
    next.attentionMessage ?? `${terminal} needs attention`,
  );
}

export function applyTerminalStatus(
  state: Pick<TerminalSlice, "terminalStatuses">,
  status: TerminalStatus,
): Partial<SessionState> {
  return {
    terminalStatuses: { ...state.terminalStatuses, [status.id]: status },
  };
}

export function applyTerminalExit(
  state: Pick<TerminalSlice, "terminalStatuses" | "terminalExited">,
  exit: TerminalExit,
): Partial<SessionState> {
  const prev = state.terminalStatuses[exit.id];
  const nextStatuses = prev
    ? {
        ...state.terminalStatuses,
        [exit.id]: {
          ...prev,
          phase: "idle" as const,
          lastExitCode: exit.exitCode,
        },
      }
    : state.terminalStatuses;
  return {
    terminalExited: { ...state.terminalExited, [exit.id]: exit.exitCode },
    terminalStatuses: nextStatuses,
  };
}

export function addTerminalToState(
  state: SessionState,
  session: TerminalSessionInfo,
): Partial<SessionState> {
  return {
    terminalSessions: { ...state.terminalSessions, [session.id]: session },
    terminalStatuses: {
      ...state.terminalStatuses,
      [session.id]: session.status,
    },
    freshTerminalIds: state.freshTerminalIds.includes(session.id)
      ? state.freshTerminalIds
      : [...state.freshTerminalIds, session.id],
  };
}

export function removeTerminalFromState(
  state: SessionState,
  id: string,
): Partial<SessionState> {
  const terminalSessions = { ...state.terminalSessions };
  delete terminalSessions[id];
  const terminalStatuses = { ...state.terminalStatuses };
  delete terminalStatuses[id];
  const terminalExited = { ...state.terminalExited };
  delete terminalExited[id];

  return {
    terminalSessions,
    terminalStatuses,
    terminalExited,
    freshTerminalIds: state.freshTerminalIds.filter((x) => x !== id),
  };
}

/**
 * Fold a session list into the session/status maps. A live status already in
 * hand beats the list snapshot, which may be staler than the events we have
 * been receiving.
 *
 * Sessions the list doesn't mention are left alone rather than dropped: they
 * may have been started in this window since the list was fetched, and a
 * session removed from these maps loses its title, its phase and its row.
 */
export function mergeSessionList(
  state: Pick<SessionState, "terminalSessions" | "terminalStatuses">,
  sessions: TerminalSessionInfo[],
): Partial<SessionState> {
  if (sessions.length === 0) return {};
  const terminalSessions = { ...state.terminalSessions };
  const terminalStatuses = { ...state.terminalStatuses };
  for (const session of sessions) {
    terminalSessions[session.id] = session;
    terminalStatuses[session.id] ??= session.status;
  }
  return { terminalSessions, terminalStatuses };
}

/**
 * The session map with `ids` re-attributed to `workspaceId`.
 *
 * The local half of an assignment the daemon has already accepted: without it
 * the row would not move until the next `terminalList`, which is seconds away
 * and looks like a drag that did nothing. `null` is a real answer — a session
 * can be moved out of every workspace — and is what the daemon announces when
 * it re-routes one.
 */
export function withWorkspace(
  state: Pick<TerminalSlice, "terminalSessions">,
  ids: string[],
  workspaceId: string | null,
): Record<string, TerminalSessionInfo> {
  const terminalSessions = { ...state.terminalSessions };
  for (const id of ids) {
    const session = terminalSessions[id];
    if (session) terminalSessions[id] = { ...session, workspaceId };
  }
  return terminalSessions;
}

// ----- Pure tab reducers (exported for unit testing) -----

/**
 * The active tab, re-picked when the old answer is gone — closing a tab, and
 * every reconcile that drops one.
 *
 * `state` is the strip as it was, `terminalTabs` what is left of it, because
 * the replacement is chosen by where the departed tab *was*: the tab after it,
 * else the tab before it, which is what every tabbed thing does and what the
 * eye expects.
 *
 * Nearness alone isn't enough, though, because the strip is not the whole list:
 * the panel draws one workspace's tabs (see `showingTabId` in TerminalPanel),
 * so landing on a neighbour belonging to another workspace shows a strip with
 * nothing under it. A surviving tab of the departed tab's own workspace
 * therefore wins over a nearer one that isn't — and in the strip the user is
 * looking at, that tab *is* the neighbour.
 */
export function resolveActiveTabId(
  state: TabAttribution & Pick<TerminalSlice, "activeTabId">,
  terminalTabs: TerminalTab[],
): string | null {
  const previous = state.activeTabId;
  if (previous && terminalTabs.some((tab) => tab.id === previous))
    return previous;
  const before = state.terminalTabs;
  const at = previous ? before.findIndex((tab) => tab.id === previous) : -1;
  if (at === -1) return terminalTabs[0]?.id ?? null;

  // Where it was, outward: everything after it, then everything before it.
  const candidates = [
    ...before.slice(at + 1),
    ...before.slice(0, at).reverse(),
  ].filter((tab) => terminalTabs.some((entry) => entry.id === tab.id));
  const workspaceId = tabWorkspaceId(state, before[at]);
  const kin =
    workspaceId === null
      ? null
      : candidates.find((tab) => tabWorkspaceId(state, tab) === workspaceId);
  return (kin ?? candidates[0])?.id ?? terminalTabs[0]?.id ?? null;
}

/** The tab with `tabId`, or null. */
export function findTab(
  tabs: TerminalTab[],
  tabId: string,
): TerminalTab | null {
  return tabs.find((tab) => tab.id === tabId) ?? null;
}

/** The tab holding `terminalId` in one of its panes, or null. */
export function findTabForTerminal(
  tabs: TerminalTab[],
  terminalId: string,
): TerminalTab | null {
  return (
    tabs.find((tab) => collectLeafIds(tab.root).includes(terminalId)) ?? null
  );
}

/** Every session in the tab holding `terminalId` — panes travel together. */
export function tabSessionIds(
  tabs: TerminalTab[],
  terminalId: string,
): string[] {
  const tab = findTabForTerminal(tabs, terminalId);
  return tab ? collectLeafIds(tab.root) : [terminalId];
}

/** Append a fresh single-leaf tab for `terminalId` and make it active. */
export function addTabForTerminal(
  state: TabState,
  terminalId: string,
  tabId: string,
): Partial<TabState> {
  const tabs = state.terminalTabs.some((tab) => tab.id === tabId)
    ? state.terminalTabs
    : [...state.terminalTabs, makeTab(tabId, terminalId)];
  return { terminalTabs: tabs, activeTabId: tabId };
}

/**
 * Insert `newId` as a split of the pane `targetId` within `tabId`, and focus
 * the new leaf. The session maps are updated separately by `addTerminalToState`.
 */
export function splitTabForTerminal(
  state: TabState,
  tabId: string,
  targetId: string,
  newId: string,
  direction: SplitDirection,
): Partial<TabState> {
  if (!findTab(state.terminalTabs, tabId)) return {};
  return {
    terminalTabs: state.terminalTabs.map((tab) =>
      tab.id === tabId
        ? {
            ...tab,
            root: splitLeaf(tab.root, targetId, newId, direction),
            focused: newId,
          }
        : tab,
    ),
  };
}

/**
 * Rearrange `tabId`'s panes: put `sourceId` against `edge` of `targetId` and
 * focus it there, because the pane you just placed is the one you meant to work
 * in. A move the tree declines (either pane gone, or a drop that would change
 * nothing) writes nothing.
 */
export function movePaneInTab(
  state: TabState,
  tabId: string,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): Partial<TabState> {
  const found = findTab(state.terminalTabs, tabId);
  if (!found) return {};
  const root = movePane(found.root, sourceId, targetId, edge);
  if (root === found.root) return {};
  return {
    terminalTabs: state.terminalTabs.map((tab) =>
      tab.id === tabId ? { ...tab, root, focused: sourceId } : tab,
    ),
  };
}

/**
 * The tab as it looks once `sourceId` has left it, or null when the pane it
 * lost was its last one — a tab with no panes is not a tab.
 *
 * Pairs the tree collapse with `withRepairedFocus`, which is where the "focus
 * lands on a pane that is actually drawn" rule lives.
 */
export function tabWithoutPane(
  tab: TerminalTab,
  sourceId: string,
): TerminalTab | null {
  return withRepairedFocus(tab, removeLeaf(tab.root, sourceId));
}

/**
 * Move the pane `sourceId` out of its own tab and into `targetTabId`, beside
 * that tab's focused pane — the drag from a pane's grip onto a tab in the strip.
 *
 * Composed from the two reducers that already own each half: removing a pane
 * from a tab, and splitting a tab's focused pane. So the tab the pane came from
 * collapses (or is dropped when that pane was all it had, making this gesture a
 * merge) by exactly the rule that closing a pane follows.
 *
 * The pane lands focused, and its new tab becomes the active one — you just put
 * it there, so that is what should be on screen.
 */
export function movePaneToTabTree(
  state: TabStateWithSessions,
  sourceId: string,
  targetTabId: string,
): Partial<TabState> {
  const source = findTabForTerminal(state.terminalTabs, sourceId);
  const target = findTab(state.terminalTabs, targetTabId);
  if (!source || !target || source.id === targetTabId) return {};

  const lifted = { ...state, ...removeTerminalFromTabs(state, sourceId) };
  const placed = {
    ...lifted,
    // Read from the tab as it was: the removal cannot have touched the target,
    // which is guaranteed above not to hold the pane being moved.
    ...splitTabForTerminal(
      lifted,
      targetTabId,
      target.focused,
      sourceId,
      "row",
    ),
  };

  return { terminalTabs: placed.terminalTabs, activeTabId: targetTabId };
}

/**
 * Pull the pane `sourceId` out of its tab into a new tab of its own, placed
 * right after the tab it left — the drop onto the strip's "New tab" slot.
 *
 * Declines when the pane is its tab's only one: it already is its own tab, and
 * honoring the drop would swap one tab for an identical one at a new id,
 * throwing away its position in the strip for nothing.
 */
export function extractPaneToTab(
  state: TabState,
  sourceId: string,
  newTabId: string,
): Partial<TabState> {
  const source = findTabForTerminal(state.terminalTabs, sourceId);
  if (!source) return {};
  const sourceTab = tabWithoutPane(source, sourceId);
  if (!sourceTab) return {};

  const tabs = [...state.terminalTabs];
  const at = tabs.findIndex((tab) => tab.id === source.id);
  tabs.splice(at, 1, sourceTab, makeTab(newTabId, sourceId));

  return { terminalTabs: tabs, activeTabId: newTabId };
}

/**
 * Remove terminal `id` from every tab: collapse single-child splits, re-pick a
 * tab's focus if it lost the focused leaf, drop a tab that empties, and re-pick
 * the active tab if it went away.
 */
export function removeTerminalFromTabs(
  state: TabStateWithSessions,
  id: string,
): Partial<TabState> {
  // A tab that has nothing left is dropped, which is what the nulls are.
  const terminalTabs = state.terminalTabs
    .map((tab) => tabWithoutPane(tab, id))
    .filter((tab): tab is TerminalTab => tab !== null);
  return {
    terminalTabs,
    activeTabId: resolveActiveTabId(state, terminalTabs),
  };
}

/**
 * Set the focused leaf of `tabId`. Focusing a collapsed pane unfolds it —
 * every route to a pane (a click, ⌥⌘`, an overview card) goes through here, so
 * none of them can land the keyboard on a title bar.
 */
export function setFocusedInTab(
  state: TabState,
  tabId: string,
  terminalId: string,
): Partial<TabState> {
  return {
    terminalTabs: state.terminalTabs.map((tab) =>
      tab.id === tabId
        ? {
            ...tab,
            focused: terminalId,
            root: setLeafCollapsed(tab.root, terminalId, false),
          }
        : tab,
    ),
  };
}

/**
 * Fold `terminalId`'s pane down to a title bar, or unfold it.
 *
 * Declines when it would leave the tab with nothing but bars: a collapse you
 * can't see the way out of is a lost terminal, and the panel's own ⌘` is the
 * gesture for hiding everything.
 */
export function setPaneCollapsedInTab(
  state: TabState,
  tabId: string,
  terminalId: string,
  collapsed: boolean,
): Partial<TabState> {
  const tab = findTab(state.terminalTabs, tabId);
  if (!tab) return {};

  const root = setLeafCollapsed(tab.root, terminalId, collapsed);
  if (root === tab.root) return {};
  const stillShowing = expandedLeafIds(root);
  if (stillShowing.length === 0) return {};

  return {
    terminalTabs: state.terminalTabs.map((t) =>
      t.id === tabId
        ? {
            ...t,
            root,
            // Folding the focused pane hands the keyboard to one that's still
            // on screen rather than leaving focus on a bar.
            focused: stillShowing.includes(t.focused)
              ? t.focused
              : stillShowing[0],
          }
        : t,
    ),
  };
}

/** Set the child fractions of the split at `path` within `tabId`. */
export function resizeSplitInTab(
  state: TabState,
  tabId: string,
  path: number[],
  sizes: number[],
): Partial<TabState> {
  return {
    terminalTabs: state.terminalTabs.map((tab) =>
      tab.id === tabId
        ? { ...tab, root: setSizesAtPath(tab.root, path, sizes) }
        : tab,
    ),
  };
}

/**
 * Reconcile the tab list against the sessions this window knows: prune panes
 * whose session is gone (collapsing/dropping as needed) and wrap any session no
 * tab holds into its own single-leaf tab.
 *
 * `sessions` is the *merged* set, not the daemon's list — see
 * `ingestTerminalList`. Pruning against the raw list would drop the pane of
 * every session the daemon has stopped listing while `mergeSessionList`
 * deliberately keeps it.
 *
 * The new tab's id is the session's own, which is what makes a reload rebuild
 * the same tabs.
 *
 * `placing` names the sessions this window is in the middle of putting
 * somewhere itself — see the slice's own set. The daemon announces a birth to
 * every client, this window included, and that frame can arrive before
 * `terminalStart`'s own response does; wrapping it here would give the shell a
 * tab of its own a moment before the start path gives it the one it asked for,
 * and two tabs for one session is not self-healing — every later ingest sees
 * both holding a live session and keeps them.
 */
export function ingestTabs(
  state: TabStateWithSessions,
  sessions: TerminalSessionInfo[],
  placing: ReadonlySet<string> = new Set(),
): Partial<TabState> {
  const live = new Set(sessions.map((s) => s.id));

  const terminalTabs: TerminalTab[] = [];
  const placed = new Set<string>();
  for (const tab of state.terminalTabs) {
    const pruned = withRepairedFocus(tab, pruneLeaves(tab.root, live));
    if (!pruned) continue;
    terminalTabs.push(pruned);
    for (const leafId of collectLeafIds(pruned.root)) placed.add(leafId);
  }

  for (const session of sessions) {
    if (placed.has(session.id) || placing.has(session.id)) continue;
    terminalTabs.push(makeTab(session.id, session.id));
    placed.add(session.id);
  }

  return {
    terminalTabs,
    activeTabId: resolveActiveTabId(state, terminalTabs),
  };
}

/** Storage key for this window's tab/pane layout. */
export const TAB_LAYOUT_KEY = "terminalTabLayout";

/** The state the layout is made of — a write touching any of it is saved. */
const LAYOUT_KEYS = [
  "terminalTabs",
  "activeTabId",
  "terminalTabUsedAt",
] as const;

/** A divider drag writes the tree per frame; the file only needs the last. */
const layoutSaveDebounce = 500;

/**
 * The tab layout as it is written to (and read back from) storage.
 *
 * Sessions are deliberately not in it: the daemon owns those, and a layout
 * that carried its own copy of them would be a second answer to "what is
 * running" that could disagree with the first. This says only how the sessions
 * the daemon reports are *grouped* — which is the part that is this window's
 * alone, and the part that used to be lost on every relaunch.
 */
export interface PersistedTabLayout {
  /** Tabs, active tab, and tab recency (so "the workspace's latest tab"
   *  survives a relaunch) — every field as stored, and so unverified: this is
   *  a file a person can edit and a format that outlives this version. Each is
   *  checked where it is used. */
  tabs: unknown;
  activeTabId: unknown;
  usedAt: unknown;
}

/**
 * Lay a persisted layout over the sessions this window knows about.
 *
 * The layout is only ever half the answer — it says which panes shared a tab,
 * and the daemon says which of those sessions are still alive — so it is
 * reconciled through `ingestTabs` rather than restored as-is: panes whose
 * session died while the app was closed are pruned (folding splits back up),
 * and any session the layout has never heard of, one started by the CLI or by
 * another window meanwhile, still lands in a tab of its own.
 */
export function restoreTabs(
  state: TabState & Pick<TerminalSlice, "terminalSessions">,
  layout: PersistedTabLayout,
): Partial<TabState> {
  return ingestTabs(
    {
      terminalTabs: sanitizeTabs(layout.tabs),
      activeTabId:
        typeof layout.activeTabId === "string"
          ? layout.activeTabId
          : state.activeTabId,
      terminalSessions: state.terminalSessions,
    },
    Object.values(state.terminalSessions),
  );
}

/**
 * The stamps in `stored` that still name a restored tab, and nothing else.
 *
 * Recency is only meaningful about tabs that came back, so a layout's stamps
 * are filtered through them rather than restored wholesale.
 */
export function restoredRecency(
  tabs: TerminalTab[],
  stored: unknown,
): Record<string, number> {
  if (typeof stored !== "object" || stored === null) return {};
  const stamps = stored as Record<string, unknown>;
  const restored: Record<string, number> = {};
  for (const tab of tabs) {
    const at = stamps[tab.id];
    if (typeof at === "number" && Number.isFinite(at)) restored[tab.id] = at;
  }
  return restored;
}

/**
 * The checkout a session belongs to: the longest known checkout root
 * containing its cwd, or null if it started outside all of them.
 *
 * A shell is bound to a directory, so a *checkout* is what a session sits in —
 * not a branch name. That makes attribution survive everything a branch can't:
 * a row disappearing, a branch being renamed, a review being deleted.
 *
 * Matched against the session's *start* cwd, which never moves, rather than
 * the live OSC 7 cwd, so `cd`-ing around inside a terminal doesn't reassign it.
 */
export function sessionCheckout(
  cwd: string,
  checkouts: readonly string[],
): string | null {
  let best: string | null = null;
  for (const root of checkouts) {
    if (cwd !== root && !cwd.startsWith(`${root}/`)) continue;
    if (best === null || root.length > best.length) best = root;
  }
  return best;
}

type TabAttribution = Pick<TerminalSlice, "terminalTabs" | "terminalSessions">;

/**
 * The workspace a tab belongs to, or null while its sessions are unknown.
 *
 * A tab is one place of work, so it has one workspace even when it holds
 * several panes: the first pane that has an answer speaks for the tab. Panes
 * only disagree in flight — a pane dragged into another tab is reassigned to
 * that tab's workspace right after it lands.
 *
 * The answer comes from the session, which is the daemon's record, not this
 * window's: a reload, a second window, and the `spur` CLI all read the same
 * attribution instead of three copies that agree by habit.
 */
export function tabWorkspaceId(
  state: Pick<TerminalSlice, "terminalSessions">,
  tab: TerminalTab,
): string | null {
  for (const leafId of collectLeafIds(tab.root)) {
    const workspaceId = state.terminalSessions[leafId]?.workspaceId;
    if (workspaceId) return workspaceId;
  }
  return null;
}

/**
 * Tab ids grouped by the workspace they belong to, in strip order — what a
 * card's terminal rows read.
 *
 * One pass for the whole section rather than one scan per card. A tab whose
 * workspace the queue has not caught up with yet simply lands in a bucket
 * nothing is drawing, and appears when it has.
 */
export function selectTabsByWorkspaceId(
  state: TabAttribution,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tab of state.terminalTabs) {
    const workspaceId = tabWorkspaceId(state, tab);
    if (workspaceId == null) continue;
    (out[workspaceId] ??= []).push(tab.id);
  }
  return out;
}

/** The most recently activated of `tabIds`, or the first if none ever was. */
export function mostRecentTabId(
  tabIds: string[],
  usedAt: Record<string, number>,
): string | null {
  let best: string | null = null;
  for (const tabId of tabIds) {
    if (best === null || (usedAt[tabId] ?? 0) > (usedAt[best] ?? 0)) {
      best = tabId;
    }
  }
  return best;
}

export const createTerminalSlice: SliceCreatorWithClientAndStorage<
  TerminalSlice
> = (client, storage) => (write, get) => {
  // Per-session unsubscribe fns (exit). Module-of-closure state, not store
  // state — these are non-serializable and window-local.
  const sessionUnsubs = new Map<string, () => void>();

  /**
   * Sessions this window has claimed and is about to place in a tab.
   *
   * A start mints the session id here and hands it to the daemon, which
   * announces the birth to every client — this one included — and that frame
   * routinely beats the start's own response back. The claim says "this one is
   * mine to place", so `ingestTabs` leaves it alone instead of wrapping it in a
   * tab the start path is a moment away from replacing. Claimed alongside the
   * exit subscription and for the same reason: both have to be in place before
   * the daemon is told anything.
   */
  const placing = new Set<string>();

  /**
   * Sessions closed by the person but not yet killed — see `hideTerminal`.
   * Kept out of the strip by `ingestTabs` the same way `placing` is: both are
   * live sessions this window has decided not to draw right now.
   */
  const hidden = new Set<string>();

  /** Monotonic stamp for tab recency — see `terminalTabUsedAt`. */
  let useCounter = 0;

  const debouncedLayoutSave = createDebouncedFn(layoutSaveDebounce);

  // ----- Layout persistence -----
  //
  // The daemon owns the sessions; how they are grouped into tabs and split
  // into panes is this window's own answer, and it used to live only in
  // memory — so every relaunch met the daemon's flat session list and laid
  // each one out as a tab of its own, panes and all.

  /**
   * What storage answered with: `undefined` until it has, then the stored
   * layout or `null` for a window that has never saved one.
   */
  let savedLayout: PersistedTabLayout | null | undefined;
  /** Whether the daemon's session list has landed — the other half. */
  let sessionsIngested = false;
  /** Whether the restore has run (or settled as having nothing to restore). */
  let layoutRestored = false;

  /**
   * Write the layout, but never before the restore has run.
   *
   * Startup writes tabs before it can read them back — `ingestTerminalList`
   * wraps every session in a tab of its own on the way to being regrouped —
   * and saving those would overwrite the very layout being restored with the
   * flat one it is there to replace.
   *
   * Debounced, because a divider drag writes the tree on every frame it moves.
   */
  function saveLayout(): void {
    if (!layoutRestored) return;
    debouncedLayoutSave(() => {
      const g = get();
      storage.set(TAB_LAYOUT_KEY, {
        tabs: g.terminalTabs,
        activeTabId: g.activeTabId,
        usedAt: g.terminalTabUsedAt,
      });
    });
  }

  /**
   * `set`, plus a save whenever the write touched the layout.
   *
   * Wrapped once here rather than called from each of the dozen actions that
   * move a pane: a tab reducer added later persists by construction instead of
   * by remembering to.
   */
  const set = (partial: Partial<SpurStore>): void => {
    write(partial);
    if (LAYOUT_KEYS.some((key) => key in partial)) saveLayout();
  };

  /**
   * Lay the saved layout over the reported sessions, once both are in hand.
   *
   * The read is async and the session list is a round trip, so either can land
   * first; this runs on whichever arrives second and exactly once. Restoring
   * against sessions we haven't heard about yet would prune every pane in the
   * layout as dead — which is also why a `terminalList` that never answers
   * leaves the stored layout alone rather than replacing it with a degraded
   * one: the next successful list settles it.
   */
  function restoreLayout(): void {
    if (layoutRestored || savedLayout === undefined || !sessionsIngested) {
      return;
    }
    layoutRestored = true;
    if (!savedLayout) {
      // Nothing stored — start saving what this window has instead.
      saveLayout();
      return;
    }
    const restored = restoreTabs(get(), savedLayout);
    const usedAt = restoredRecency(
      restored.terminalTabs ?? [],
      savedLayout.usedAt,
    );
    // The counter has to outrun every stamp it inherited, or the first tab
    // activated after a relaunch would read as older than one last touched
    // days ago.
    useCounter = Math.max(useCounter, ...Object.values(usedAt));
    // Saves on the way through, which is what settles panes whose session died
    // while the app was closed.
    set({ ...restored, terminalTabUsedAt: usedAt });
  }

  /**
   * Watch one session's exit.
   *
   * Exit only: status arrives on the announcement channel, for every session at
   * once, which `useTerminalEvents` subscribes to once at the app shell. A
   * per-session status listener would be the same frame a second time.
   */
  function subscribeSession(id: string): void {
    if (sessionUnsubs.has(id)) return;
    sessionUnsubs.set(
      id,
      client.onTerminalExit(id, (exit) => get().applyTerminalExit(exit)),
    );
  }

  /**
   * Type the user's launch command at a new session's prompt.
   *
   * Written as input rather than passed as the PTY's `shell`, so the command is
   * a program the shell ran — quitting it drops you back to a prompt instead of
   * killing the terminal. The tty buffers the keystrokes until the shell is
   * ready to read them, which is why this needs no readiness handshake.
   */
  function runLaunchCommand(id: string): void {
    const command = get().terminalLaunchCommand?.trim();
    if (!command) return;
    client.terminalWrite(id, `${command}\n`).catch((err) => {
      console.error("[terminal] Launch command failed:", err);
    });
  }

  function setFocus(focus: ContentFocus): void {
    set({ contentFocus: focus });
    storage.set("contentFocus", focus);
  }

  function unsubscribeSession(id: string): void {
    const unsub = sessionUnsubs.get(id);
    if (unsub) {
      unsub();
      sessionUnsubs.delete(id);
    }
  }

  /** Bringing `tabId` to the front, as the partial to spread. */
  function activateTab(tabId: string): Partial<TerminalSlice> {
    return {
      activeTabId: tabId,
      terminalTabUsedAt: { ...get().terminalTabUsedAt, [tabId]: ++useCounter },
    };
  }

  /** Drop a gone session from every map that holds it. */
  function teardownSession(id: string): void {
    unsubscribeSession(id);
    hidden.delete(id);
    const g = get();
    set({
      ...removeTerminalFromState(g, id),
      ...removeTerminalFromTabs(g, id),
      terminalSearchId: g.terminalSearchId === id ? null : g.terminalSearchId,
    });
  }

  /**
   * Move `sessionIds` into `workspaceId`.
   *
   * The daemon is told first and the store patched after, because the daemon's
   * copy is the real one — a local write that the round trip then failed to
   * confirm would be a row sitting under a card it does not belong to.
   */
  async function assignSessions(
    sessionIds: string[],
    workspaceId: string,
  ): Promise<void> {
    try {
      await Promise.all(
        sessionIds.map((id) => client.terminalAssignWorkspace(id, workspaceId)),
      );
    } catch (err) {
      console.error("[terminal] Failed to move terminal:", err);
      toast.error("Failed to move terminal");
      return;
    }
    set({ terminalSessions: withWorkspace(get(), sessionIds, workspaceId) });
  }

  /** [`assignSessions`] for the whole tab holding `terminalId` — panes travel
   *  together, so naming one of them names the tab. */
  function assignTab(terminalId: string, workspaceId: string): Promise<void> {
    return assignSessions(
      tabSessionIds(get().terminalTabs, terminalId),
      workspaceId,
    );
  }

  return {
    terminalSessions: {},
    terminalStatuses: {},
    terminalExited: {},
    terminalTabs: [],
    activeTabId: null,
    terminalTabUsedAt: {},
    freshTerminalIds: [],
    terminalCheckouts: {},
    contentFocus: "code",
    terminalOverview: false,
    terminalSearchId: null,
    terminalPanelWidth: TERMINAL_PANEL_WIDTH_DEFAULT,
    terminalsSupported: false,

    hydrateTerminalPrefs: async () => {
      const [focus, legacyMode, legacyOpen, width, layout] = await Promise.all([
        storage.get<ContentFocus>("contentFocus"),
        // Pre-focus installs persisted the same three states under the
        // panel's own names; map them once so the layout survives upgrade.
        storage.get<"closed" | "split" | "maximized">("terminalPanelMode"),
        // And pre-mode installs persisted an open/closed boolean.
        storage.get<boolean>("terminalPanelOpen"),
        storage.get<number>("terminalPanelWidth"),
        storage.get<PersistedTabLayout>(TAB_LAYOUT_KEY),
      ]);
      // Held rather than applied: the tabs it describes mean nothing until the
      // daemon has said which of their sessions are still running. Storage
      // answering "nothing stored" settles the restore just the same — a first
      // run has to start saving too.
      savedLayout = layout ?? null;
      const migrated: ContentFocus | null =
        legacyMode === "closed"
          ? "code"
          : legacyMode === "maximized"
            ? "terminal"
            : legacyMode === "split"
              ? "split"
              : null;
      set({
        contentFocus: focus ?? migrated ?? (legacyOpen ? "split" : "code"),
        terminalPanelWidth: width ?? TERMINAL_PANEL_WIDTH_DEFAULT,
      });
      restoreLayout();
    },

    setTerminalsSupported: (supported) =>
      set({ terminalsSupported: supported }),

    startTerminal: async (repoPath, cwd, cols, rows, shell, workspaceId) => {
      const id = crypto.randomUUID();
      const tabId = crypto.randomUUID();
      // Subscribe and claim BEFORE starting, so neither the first exit nor the
      // birth announcement can race us.
      subscribeSession(id);
      placing.add(id);
      try {
        // The backend routes: the session is born in the workspace its cwd
        // belongs to, and says which one that is.
        const { session, workspace } = await client.terminalStart({
          terminalId: id,
          repoPath,
          cwd,
          cols,
          rows,
          shell,
          workspaceId,
        });
        const g = get();
        set({
          ...addTerminalToState(g, session),
          ...addTabForTerminal(g, session.id, tabId),
          ...activateTab(tabId),
        });
        // A workspace the router just invented is one the queue has never
        // listed, and a terminal is drawn under its workspace or nowhere — so
        // the list is re-read rather than waited for. (The workspaces.json watcher
        // would get there too; this makes the new card land with the shell.)
        if (workspace.created) void get().loadWorkspaces();
        runLaunchCommand(session.id);
        return id;
      } catch (err) {
        unsubscribeSession(id);
        console.error("[terminal] Failed to start terminal:", err);
        toast.error("Failed to start terminal");
        return null;
      } finally {
        // Placed, or never born — either way this window is no longer holding
        // a tab open for it.
        placing.delete(id);
      }
    },

    splitTerminal: async (tabId, targetTerminalId, direction) => {
      const target = get().terminalSessions[targetTerminalId];
      if (!target) return null;
      const id = crypto.randomUUID();
      // Same claim as `startTerminal`: the split says which tab the new pane
      // belongs to, and the announcement must not put it in one of its own
      // while this is in flight.
      subscribeSession(id);
      placing.add(id);
      try {
        // A split joins the tab it was opened from, so it belongs to that
        // tab's workspace — which is not always where its cwd would have
        // routed it, because the tab may have been moved somewhere else since.
        //
        // Named up front rather than assigned afterwards. Starting first and
        // moving second lets the router mint a workspace for the cwd that the
        // session then walks away from, leaving an empty queue entry behind for
        // cleanup to collect.
        const { session, workspace } = await client.terminalStart({
          terminalId: id,
          repoPath: target.repoPath,
          // New pane inherits the split pane's cwd; it refits on mount.
          cwd: target.cwd,
          cols: 80,
          rows: 24,
          workspaceId: target.workspaceId ?? undefined,
        });
        const g = get();
        set({
          ...addTerminalToState(g, session),
          ...splitTabForTerminal(
            g,
            tabId,
            targetTerminalId,
            session.id,
            direction,
          ),
        });
        // Same reason as `startTerminal`: a workspace the router just invented
        // has never been listed, and a terminal is drawn under its workspace or
        // nowhere.
        if (workspace.created) void get().loadWorkspaces();
        runLaunchCommand(session.id);
        return id;
      } catch (err) {
        unsubscribeSession(id);
        console.error("[terminal] Failed to split terminal:", err);
        toast.error("Failed to start terminal");
        return null;
      } finally {
        placing.delete(id);
      }
    },

    killTerminal: async (id) => {
      try {
        await client.terminalKill(id);
      } catch (err) {
        // Log but still tear down locally — a kill that failed because the
        // session already died should not strand the tab.
        console.error("[terminal] Failed to kill terminal:", err);
      }
      teardownSession(id);
    },

    removeTerminal: (id) => teardownSession(id),

    hideTerminal: (id) => {
      if (!get().terminalSessions[id]) return;
      hidden.add(id);
      const g = get();
      set({
        ...removeTerminalFromTabs(g, id),
        terminalSearchId: g.terminalSearchId === id ? null : g.terminalSearchId,
      });
    },

    restoreTerminalTabs: (tabs) => {
      const g = get();
      const live = new Set(Object.keys(g.terminalSessions));
      const placed = new Set<string>();
      for (const tab of g.terminalTabs) {
        for (const leafId of collectLeafIds(tab.root)) placed.add(leafId);
      }
      // A snapshot of a tab still in the strip is a merge into that tab, not a
      // second copy of it: closing one pane of a split leaves the tab standing,
      // so this is the ordinary case for an undone pane close, not an edge one.
      const merged = new Map<string, TerminalTab>();
      const appended: TerminalTab[] = [];
      const touched: string[] = [];
      for (const tab of tabs) {
        const standing = g.terminalTabs.find((entry) => entry.id === tab.id);
        // The panes that tab is holding right now: they are `placed`, but
        // placed *here*, which is where the snapshot wants them anyway.
        const here = new Set(
          standing ? collectLeafIds(standing.root) : ([] as string[]),
        );
        const keep = new Set(
          collectLeafIds(tab.root).filter(
            (leafId) =>
              live.has(leafId) && (here.has(leafId) || !placed.has(leafId)),
          ),
        );
        let root = pruneLeaves(tab.root, keep);
        if (root && standing) {
          // Panes that arrived in the tab after the close — a split, a drag
          // from another tab. The snapshot has never heard of them and would
          // prune them away, which would unlist a live terminal; they join the
          // rebuilt tree instead, at its end.
          for (const leafId of collectLeafIds(standing.root)) {
            if (keep.has(leafId)) continue;
            const leaves = collectLeafIds(root);
            root = splitLeaf(root, leaves[leaves.length - 1], leafId, "row");
          }
        }
        const rebuilt = withRepairedFocus(tab, root);
        if (!rebuilt) continue;
        if (standing) merged.set(rebuilt.id, rebuilt);
        else appended.push(rebuilt);
        touched.push(rebuilt.id);
        for (const leafId of collectLeafIds(rebuilt.root)) {
          placed.add(leafId);
          hidden.delete(leafId);
        }
      }
      if (touched.length === 0) return;
      const usedAt = { ...g.terminalTabUsedAt };
      for (const tabId of touched) usedAt[tabId] = ++useCounter;
      set({
        // Merged tabs keep their place in the strip; only a tab the close
        // emptied has a place to be given back, and it goes on the end.
        terminalTabs: [
          ...g.terminalTabs.map((tab) => merged.get(tab.id) ?? tab),
          ...appended,
        ],
        activeTabId: touched[0],
        terminalTabUsedAt: usedAt,
      });
    },

    setActiveTab: (tabId) => set(activateTab(tabId)),

    selectWorkspaceTab: (workspaceId) => {
      const g = get();
      const tabIds = selectTabsByWorkspaceId(g)[workspaceId] ?? [];
      const tabId = mostRecentTabId(tabIds, g.terminalTabUsedAt);
      if (tabId) set(activateTab(tabId));
    },

    setTerminalCheckouts: (activity, reviews) =>
      set({ terminalCheckouts: buildCheckoutIndex(activity, reviews) }),

    attachTerminalToWorkspace: (terminalId, workspaceId) =>
      assignTab(terminalId, workspaceId),

    moveTab: (fromIndex, toIndex) => {
      const g = get();
      const terminalTabs = reorderTabs(g.terminalTabs, fromIndex, toIndex);
      // The helper hands back the original array for a drag it won't honor, so
      // those don't re-render the panel.
      if (terminalTabs === g.terminalTabs) return;
      set({ terminalTabs });
    },

    setFocusedTerminalPane: (tabId, terminalId) =>
      set(setFocusedInTab(get(), tabId, terminalId)),

    dropPaneOn: (sourceTerminalId, targetTerminalId, edge) => {
      const g = get();
      const tab = findTabForTerminal(g.terminalTabs, targetTerminalId);
      if (!tab) return;
      set(movePaneInTab(g, tab.id, sourceTerminalId, targetTerminalId, edge));
    },

    movePaneToTab: (sourceTerminalId, targetTabId) => {
      const g = get();
      const target = findTab(g.terminalTabs, targetTabId);
      const next = movePaneToTabTree(g, sourceTerminalId, targetTabId);
      if (!next.terminalTabs || !target) return;
      set({ ...next, ...activateTab(targetTabId) });
      // The pane belongs to the tab it joined now, so it takes on that tab's
      // workspace rather than keeping the one it arrived with.
      const workspaceId = tabWorkspaceId(g, target);
      if (workspaceId) void assignSessions([sourceTerminalId], workspaceId);
    },

    movePaneToNewTab: (sourceTerminalId) => {
      const g = get();
      const source = findTabForTerminal(g.terminalTabs, sourceTerminalId);
      if (!source) return null;
      const tabId = crypto.randomUUID();
      const next = extractPaneToTab(g, sourceTerminalId, tabId);
      if (!next.terminalTabs) return null;
      set({ ...next, ...activateTab(tabId) });
      // Nothing to reassign: the session is the same session, and its workspace
      // came with it into the tab it now has to itself.
      return tabId;
    },

    setPaneCollapsed: (tabId, terminalId, collapsed) =>
      set(setPaneCollapsedInTab(get(), tabId, terminalId, collapsed)),

    resizeSplit: (tabId, path, sizes) =>
      set(resizeSplitInTab(get(), tabId, path, sizes)),

    setContentFocus: (focus) => setFocus(focus),

    // Straight to the store and nowhere near `storage`: see `terminalOverview`.
    setTerminalOverview: (on) => set({ terminalOverview: on }),

    toggleTerminalOverview: () =>
      set({ terminalOverview: !get().terminalOverview }),

    setTerminalSearchId: (id) => set({ terminalSearchId: id }),

    toggleTerminalPanel: () => {
      // From terminal focus this lands on "code", not "split" — hiding the
      // terminal means the code gets everything, and the way back reopens as
      // a split so the code can't stay hidden behind a panel that isn't
      // showing.
      setFocus(get().contentFocus === "code" ? "split" : "code");
    },

    toggleTerminalFocus: () => {
      // From code focus this jumps straight to terminal focus — the shortcut
      // reads as "show me the terminal, full size" whichever state it starts
      // from.
      setFocus(get().contentFocus === "terminal" ? "split" : "terminal");
    },

    setTerminalPanelWidth: (width) => {
      const clamped = Math.max(
        TERMINAL_PANEL_WIDTH_MIN,
        Math.min(TERMINAL_PANEL_WIDTH_MAX, width),
      );
      set({ terminalPanelWidth: clamped });
      storage.set("terminalPanelWidth", clamped);
    },

    consumeFreshTerminal: (id) =>
      set({
        freshTerminalIds: get().freshTerminalIds.filter((x) => x !== id),
      }),

    ensureTerminalSubscription: (id) => subscribeSession(id),

    applyTerminalStatus: (status) => {
      // Edge detection lives at the write, not on any one event channel:
      // every stream carrying a status lands here, in transport order, and
      // only the first to arrive still sees the phase being replaced. A
      // second delivery of the same status finds prev === next and stays
      // quiet.
      const prev = get().terminalStatuses[status.id];
      notifyTerminalAttention(prev, status);
      escalateAttention(get(), prev, status);
      // ...and the redundant deliveries stop here rather than reaching the
      // store. A status can arrive twice — the announcement channel, and, in
      // web mode, a mounted pane's own socket carrying the same frame — and a
      // write allocates a new `terminalStatuses` map, so every surface that
      // summarizes sessions --
      // both rails, the tab strip, the sidebar badge, the overview grid --
      // would re-render two extra times per change. Titles are the field that
      // moves most (an agent rewrites its own on every turn), so those extra
      // renders are the steady-state cost of an idle window, not a rare one.
      if (prev && sameTerminalStatus(prev, status)) return;
      set(applyTerminalStatus(get(), status));
    },
    applyTerminalExit: (exit) => set(applyTerminalExit(get(), exit)),

    applyTerminalWorkspace: (id, workspaceId) => {
      const session = get().terminalSessions[id];
      // Unknown, or already where it is being told to be. The list poll and the
      // event both report a move, and a write here allocates a new session map
      // — which re-renders every surface that groups terminals by workspace.
      if (!session || session.workspaceId === workspaceId) return;
      set({ terminalSessions: withWorkspace(get(), [id], workspaceId) });
    },

    applyTerminalRemoved: (id) => {
      const g = get();
      // A session this window never knew, or one it already tore down (killing
      // a terminal here removes it, then the daemon announces the removal).
      if (!g.terminalSessions[id]) return;
      // Already dead, and with a real exit code: `exited` arrives before
      // `removed` for a shell that finished on its own, and null would be a
      // worse answer than the number already stored.
      if (id in g.terminalExited) return;
      set(applyTerminalExit(g, { id, exitCode: null }));
    },

    ingestTerminalList: (sessions) => {
      const g = get();
      const merged = mergeSessionList(g, sessions);
      // Tabs are reconciled against the *merged* sessions, not the daemon's
      // list, because the two have to leave together. A session the list omits
      // is kept on purpose — an exited one is still on screen showing its exit
      // code until the user closes it — so pruning its pane here would leave a
      // session no tab holds: an overview card whose click jumps nowhere, a
      // needs-you queue pointing at nothing, and, when a restarted daemon
      // answers with [], every tab in the strip gone at once. `teardownSession`
      // is the one thing that removes a session, and it removes the pane too.
      set({
        ...merged,
        ...ingestTabs(
          g,
          Object.values(merged.terminalSessions ?? g.terminalSessions),
          new Set([...placing, ...hidden]),
        ),
      });
      // The daemon has now answered which sessions exist, which is the half of
      // the restore this window can't supply for itself.
      sessionsIngested = true;
      restoreLayout();
    },
  };
};
