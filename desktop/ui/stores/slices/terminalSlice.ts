import { toast } from "sonner";
import type {
  GlobalReviewSummary,
  RepoLocalActivity,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalPhase,
  TerminalExit,
  WorkItem,
} from "../../types";
import { makeReviewKey } from "../../utils/review-key";
import { jsonEqual } from "../../utils/equality";
import { notifyTerminalAttention } from "../../utils/terminal-notifications";
import type { SliceCreatorWithClientAndStorage } from "../types";
import {
  type TerminalTab,
  type PaneNode,
  type SplitDirection,
  type DropEdge,
  makeTab,
  splitLeaf,
  movePane,
  removeLeaf,
  pruneLeaves,
  collectLeafIds,
  expandedLeafIds,
  firstLeafId,
  setLeafCollapsed,
  setSizesAtPath,
  reorderTabs,
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
   */
  terminalTabs: TerminalTab[];
  /** The tab the panel is showing. */
  activeTabId: string | null;
  /**
   * When each tab was last brought to the front, as a counter rather than a
   * clock — the only question asked of it is "which of these is most recent",
   * and two tabs activated in the same millisecond still have an order.
   * Window-local: a tab id is too.
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
  /**
   * Tab id → the work item it is attached to, as `item:<id>` (persisted). A tab
   * with no entry is unclaimed, which the sidebar's band is the list of.
   *
   * Written under the tab's own id *and* under every session in it, because a
   * tab id is window-local while a session id is not: a reload rebuilds the tab
   * list from the daemon's session list, one tab per session, using the session
   * id as the tab id (see `ingestTabs`). Recording both is what lets each of
   * those rebuilt tabs find the attachment its old tab had.
   */
  terminalAttachments: Record<string, string>;

  /** Which surface holds the content region's focus (persisted). */
  contentFocus: ContentFocus;
  /** Panel width in px (persisted) — the vertical pane's own width. */
  terminalPanelWidth: number;
  /** Which side of the content region the panel docks on (persisted). */
  terminalDockSide: TerminalDockSide;
  /**
   * Whether the panel is showing the all-terminals overview instead of the
   * active tab's panes. Window-local, not persisted — the overview is a place
   * you glance at, not a place you live.
   */
  terminalOverviewOpen: boolean;
  /** Whether the current backend can host terminals (probed on mount). */
  terminalsSupported: boolean;

  // ----- Actions -----

  /** Load persisted panel preferences (open/width). */
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

  /** Show `tabId` in the panel, and record it as this tab's latest use. */
  setActiveTab: (tabId: string) => void;
  /**
   * Show the work item's most recently used tab — what activating a card does.
   * Selects; it never opens the panel or hides another item's tabs, because the
   * strip is one list and every tab in it stays where it was.
   */
  selectItemTab: (itemId: string) => void;
  /**
   * Attach the tab holding `terminalId` to a work item — the drag of a terminal
   * onto a card, and the menu verb. Panes travel with their tab, so naming any
   * one of them names the tab.
   */
  attachTerminalToItem: (terminalId: string, itemId: string) => void;
  /** Detach that tab from whatever item holds it; it returns to the band. */
  detachTerminal: (terminalId: string) => void;
  /**
   * Fold the persisted attachments onto the current work items and tabs: keep
   * what an item still claims, convert what older installs stored, and give a
   * tab whose keys disagree one answer. Idempotent, so it can run whenever the
   * item list is known rather than needing a one-shot flag.
   */
  migrateTerminalAttachments: (items: WorkItem[]) => void;
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
  /** ⌘`: focus code ↔ split — the terminal in and out of view. */
  toggleTerminalPanel: () => void;
  /** Show/hide the all-terminals overview inside the panel. */
  setTerminalOverviewOpen: (open: boolean) => void;
  /** Toggle the overview, bringing the terminal into view if it's railed. */
  toggleTerminalOverview: () => void;
  /** ⇧⌘↵: focus terminal ↔ split — full width from wherever it starts. */
  toggleTerminalFocus: () => void;
  setTerminalPanelWidth: (width: number) => void;
  setTerminalDockSide: (side: TerminalDockSide) => void;
  /** Flip the panel between the left and right of the content region. */
  toggleTerminalDockSide: () => void;

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
   * Fold the daemon's session list into the session maps and the tab list:
   * wrap any session no tab holds into one of its own, and drop panes whose
   * session this window no longer knows about at all.
   */
  ingestTerminalList: (sessions: TerminalSessionInfo[]) => void;
}

export type TerminalDockSide = "left" | "right";

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
export const TERMINAL_DOCK_SIDE_DEFAULT: TerminalDockSide = "left";

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
  /**
   * The repo's main row — the row owning the repo root. Orphaned sessions are
   * attributed here: their own directory is gone, but the shell is still alive
   * and may hold work, so it needs a row that always exists.
   *
   * On a detached HEAD nothing owns the repo root (git reports no current
   * branch), so this falls back to the row owning the repo's first checkout —
   * see `buildCheckoutIndex`.
   */
  rootKey: string;
  /** Every checkout root in the repo, innermost-wins ordering applied later. */
  roots: string[];
  /** Checkout root → the review key whose row owns it. */
  owners: Record<string, string>;
  /** Every review key this repo can show a row for. */
  rows: Set<string>;
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
      repo = {
        rootKey: makeReviewKey(repoPath, ""),
        roots: [repoPath],
        owners: {},
        rows: new Set(),
      };
      index[repoPath] = repo;
    }
    return repo;
  };

  const add = (
    repo: RepoCheckouts,
    path: string | null | undefined,
    key: string,
  ) => {
    // Every key seen is a row, checkout or not: a row with no directory still
    // exists in the sidebar, so a session attributed there is still nameable.
    repo.rows.add(key);
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

  // Anchor each repo *after* every owner is known, so the answer doesn't depend
  // on which listing happened to mention the repo root.
  //
  // Whatever owns the repo root is the main row, and normally that is the
  // current branch. A detached HEAD has no current branch — git names no branch
  // as checked out — so nothing owns the root, and the placeholder key
  // `repoPath:""` would name a row no view draws. Fall back to the row owning
  // the repo's first checkout instead. The placeholder survives only for a repo
  // with no checkouts at all, which has no rows either way.
  for (const [repoPath, repo] of Object.entries(index)) {
    repo.rootKey =
      repo.owners[repoPath] ??
      repo.roots.map((root) => repo.owners[root]).find((key) => key != null) ??
      makeReviewKey(repoPath, "");
  }

  return index;
}

/**
 * The review key owning the innermost checkout a session's start cwd falls in.
 *
 * A cwd that matches no known checkout means the checkout was removed while the
 * shell kept running (see `isOrphanedSession`), so it is attributed to the
 * repo's root row rather than to nothing. `fallback` covers a repo the index has
 * not seen at all — nothing is known yet, so the caller's guess is the best
 * answer.
 */
export function sessionReviewKey(
  index: CheckoutIndex,
  repoPath: string,
  cwd: string,
  fallback: string,
): string {
  const repo = index[repoPath];
  if (!repo) return fallback;
  const checkout = sessionCheckout(cwd, repo.roots);
  return (checkout && repo.owners[checkout]) || repo.rootKey;
}

/**
 * `key` if a row can still show it, otherwise the repo's root key.
 *
 * A derived key outlives the row it names — the review gets marked done, the
 * branch is deleted — and a key no routed view reads is one a session would
 * disappear behind. Checked against every repo's rows, not just the session's
 * own. A repo the index has never seen returns the key untouched: an empty
 * index is not evidence that a row is gone.
 */
export function reachableKey(
  index: CheckoutIndex,
  repoPath: string,
  key: string,
): string {
  const repo = index[repoPath];
  if (!repo) return key;
  if (repo.rows.has(key)) return key;
  return repoOfKey(index, key) ? key : repo.rootKey;
}

/**
 * The repo whose sidebar shows the row named by `key`, or null if no indexed
 * repo has that row. The key alone can't be split back into repo and ref (a
 * path may itself contain `:`), so ownership is found by asking each repo.
 */
export function repoOfKey(index: CheckoutIndex, key: string): string | null {
  for (const [repoPath, repo] of Object.entries(index)) {
    if (repo.rows.has(key)) return repoPath;
  }
  return null;
}

/**
 * The row a session belongs to: the checkout its cwd falls in, rescued to a row
 * that still exists. What the overview groups by.
 */
export function sessionHomeKey(
  index: CheckoutIndex,
  session: TerminalSessionInfo,
  fallback: string,
): string {
  return reachableKey(
    index,
    session.repoPath,
    sessionReviewKey(index, session.repoPath, session.cwd, fallback),
  );
}

/**
 * Prefix marking an attachment value as a work item id.
 *
 * The map held review keys before work items existed, and both are opaque
 * strings — the prefix is what lets `migrateTabAttachments` tell a value it
 * wrote from one an older install did.
 */
export const WORK_ITEM_HOME_PREFIX = "item:";

/** The stored form of an attachment to `itemId`. */
export function itemHome(itemId: string): string {
  return `${WORK_ITEM_HOME_PREFIX}${itemId}`;
}

/** The item a stored attachment names, or null if it names something else. */
export function homeItemId(value: string | undefined): string | null {
  if (!value?.startsWith(WORK_ITEM_HOME_PREFIX)) return null;
  return value.slice(WORK_ITEM_HOME_PREFIX.length);
}

/** Every key a tab's attachment is written under — see `terminalAttachments`. */
function attachmentKeys(tab: TerminalTab): string[] {
  return [tab.id, ...collectLeafIds(tab.root)];
}

/**
 * The attachments map as it should look given `tabs` and `items`.
 *
 * Three jobs, all of them "make the stored map mean what it says now":
 *
 * - an attachment naming an item the list no longer has is dropped, because an
 *   unclaimed terminal shows up in the band, which the user can see and act on,
 *   unlike an attachment pointing at nothing;
 * - a value from before work items existed named the sidebar row a terminal was
 *   dragged onto, so an item that has bound that same ref inherits it;
 * - a tab whose keys disagree — only reachable from the session-keyed map older
 *   installs wrote — takes its first pane's answer, and every one of its keys is
 *   brought into line behind it.
 */
export function migrateTabAttachments(
  attachments: Record<string, string>,
  tabs: TerminalTab[],
  items: WorkItem[],
): Record<string, string> {
  const byId = new Set(items.map((item) => item.id));
  const byRefKey = new Map<string, string>();
  for (const item of items) {
    for (const ref of item.refs) {
      byRefKey.set(makeReviewKey(ref.repoPath, ref.ref), item.id);
    }
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(attachments)) {
    const attached = homeItemId(value);
    if (attached != null) {
      if (byId.has(attached)) out[key] = value;
      continue;
    }
    const matched = byRefKey.get(value);
    if (matched) out[key] = itemHome(matched);
  }

  for (const tab of tabs) {
    const keys = attachmentKeys(tab);
    // The tab's own id comes first, so its own answer wins over a pane's.
    const value = keys.map((key) => out[key]).find((v) => v != null);
    for (const key of keys) {
      if (value) out[key] = value;
      else delete out[key];
    }
  }

  return out;
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
 * Review-managed worktrees live outside the repo (`~/.review/worktrees/...`),
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
 * Whether two statuses say the same thing about a session.
 *
 * Every field is a primitive, so this is a plain field-wise compare rather
 * than anything structural. It exists because the same status is delivered on
 * three channels (per-session, per-pane, global roll-up) and the redundant
 * copies must not each allocate a new `terminalStatuses` map — see
 * `applyTerminalStatus` on the slice.
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

// ----- Pure tab reducers (exported for unit testing) -----

/** The active tab, re-picked when the old answer is gone. */
export function resolveActiveTabId(
  tabs: TerminalTab[],
  previous: string | null,
): string | null {
  if (previous && tabs.some((tab) => tab.id === previous)) return previous;
  return tabs[0]?.id ?? null;
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
 * The one place the "collapse the tree and repair the focus" rule is written:
 * closing a pane, moving one to another tab, and reconciling against the
 * daemon's session list all end up here, so a tab can't pick its next focused
 * pane three different ways.
 */
export function tabWithoutPane(
  tab: TerminalTab,
  sourceId: string,
): TerminalTab | null {
  return withRepairedFocus(tab, removeLeaf(tab.root, sourceId));
}

/** `tab` re-rooted at `root`, keeping its focus if that pane survived. Null
 *  when nothing survived. */
function withRepairedFocus(
  tab: TerminalTab,
  root: PaneNode | null,
): TerminalTab | null {
  if (!root) return null;
  // Repaired against the panes still *drawn*, not merely still present: a
  // folded pane holds no keyboard focus and shows no cursor, so landing focus
  // there leaves the tab with a dimmed terminal and nothing typing into it.
  const showing = expandedLeafIds(root);
  return {
    ...tab,
    root,
    focused: showing.includes(tab.focused)
      ? tab.focused
      : (showing[0] ?? firstLeafId(root)),
  };
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
  state: TabState,
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
  state: TabState,
  id: string,
): Partial<TabState> {
  // A tab that has nothing left is dropped, which is what the nulls are.
  const terminalTabs = state.terminalTabs
    .map((tab) => tabWithoutPane(tab, id))
    .filter((tab): tab is TerminalTab => tab !== null);
  return {
    terminalTabs,
    activeTabId: resolveActiveTabId(terminalTabs, state.activeTabId),
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
 * the same tabs — and what lets a rebuilt tab find the attachment its old tab
 * had (see `terminalAttachments`).
 */
export function ingestTabs(
  state: TabState,
  sessions: TerminalSessionInfo[],
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
    if (placed.has(session.id)) continue;
    terminalTabs.push(makeTab(session.id, session.id));
    placed.add(session.id);
  }

  return {
    terminalTabs,
    activeTabId: resolveActiveTabId(terminalTabs, state.activeTabId),
  };
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

type AttachState = Pick<TerminalSlice, "terminalTabs" | "terminalAttachments">;

/** The work item a tab is attached to, or null. */
export function tabItemId(
  attachments: Record<string, string>,
  tabId: string,
): string | null {
  return homeItemId(attachments[tabId]);
}

/**
 * Tab ids grouped by the work item they're attached to, in strip order — what a
 * card's terminal rows read.
 *
 * One pass for the whole section rather than one scan per card.
 */
export function selectTabsByItemId(
  state: AttachState,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const tab of state.terminalTabs) {
    const itemId = tabItemId(state.terminalAttachments, tab.id);
    if (itemId == null) continue;
    (out[itemId] ??= []).push(tab.id);
  }
  return out;
}

/**
 * The tabs no work item accounts for — the band's membership rule.
 *
 * `itemIds` is what makes an attachment count: one naming an item that has been
 * removed would otherwise leave its terminal attached to nothing and invisible
 * in both places.
 */
export function selectUnattachedTabIds(
  state: AttachState,
  itemIds: Set<string>,
): string[] {
  const out: string[] = [];
  for (const tab of state.terminalTabs) {
    const itemId = tabItemId(state.terminalAttachments, tab.id);
    if (itemId != null && itemIds.has(itemId)) continue;
    out.push(tab.id);
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

/**
 * Every session grouped by the checkout-derived row it sits in — what the
 * terminal overview groups by.
 *
 * One pass rather than one scan per group, and one rule: asking each consumer
 * to attribute sessions itself is what let two views disagree.
 *
 * Includes exited sessions, which still have a pane and still belong to a row
 * until they are closed.
 */
export function selectSessionsByHomeKey(
  state: Pick<TerminalSlice, "terminalSessions" | "terminalCheckouts">,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const session of Object.values(state.terminalSessions)) {
    const key = sessionHomeKey(
      state.terminalCheckouts,
      session,
      makeReviewKey(session.repoPath, ""),
    );
    (out[key] ??= []).push(session.id);
  }
  return out;
}

export const createTerminalSlice: SliceCreatorWithClientAndStorage<
  TerminalSlice
> = (client, storage) => (set, get) => {
  // Per-session unsubscribe fns (status + exit). Module-of-closure state, not
  // store state — these are non-serializable and window-local.
  const sessionUnsubs = new Map<string, () => void>();

  /** Monotonic stamp for tab recency — see `terminalTabUsedAt`. */
  let useCounter = 0;

  function subscribeSession(id: string): void {
    if (sessionUnsubs.has(id)) return;
    const unsubStatus = client.onTerminalStatus(id, (status) =>
      get().applyTerminalStatus(status),
    );
    const unsubExit = client.onTerminalExit(id, (exit) =>
      get().applyTerminalExit(exit),
    );
    sessionUnsubs.set(id, () => {
      unsubStatus();
      unsubExit();
    });
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

  /**
   * Drop attachment keys for things that are gone, as the partial to spread.
   *
   * Attachments are persisted, so a key naming a tab or session that is never
   * coming back would otherwise sit in the Tauri store forever — one entry per
   * terminal ever closed, and per tab ever emptied by a pane being dragged out
   * of it.
   */
  function forgetAttachments(keys: string[]): Partial<TerminalSlice> {
    const current = get().terminalAttachments;
    if (!keys.some((key) => key in current)) return {};
    const terminalAttachments = { ...current };
    for (const key of keys) delete terminalAttachments[key];
    return writeAttachments(terminalAttachments);
  }

  /** Drop a gone session from every map that holds it. */
  function teardownSession(id: string): void {
    unsubscribeSession(id);
    const g = get();
    const tab = findTabForTerminal(g.terminalTabs, id);
    set({
      ...removeTerminalFromState(g, id),
      ...removeTerminalFromTabs(g, id),
      // The tab goes with its last pane, and its id is window-local.
      ...forgetAttachments(
        tab && collectLeafIds(tab.root).length === 1 ? [id, tab.id] : [id],
      ),
    });
  }

  /** Persist an attachments map and publish it. The one way it is written. */
  function writeAttachments(terminalAttachments: Record<string, string>): {
    terminalAttachments: Record<string, string>;
  } {
    storage.set("terminalAttachments", terminalAttachments);
    return { terminalAttachments };
  }

  /**
   * Record which item a tab is attached to, and persist it. A null item
   * detaches it — "attached to nothing" is the absence of an entry, not an
   * entry of its own.
   */
  function rememberAttachment(
    tabId: string,
    itemId: string | null,
  ): Record<string, string> {
    const g = get();
    const tab = findTab(g.terminalTabs, tabId);
    const keys = tab ? attachmentKeys(tab) : [tabId];
    const terminalAttachments = { ...g.terminalAttachments };
    for (const key of keys) {
      if (itemId === null) delete terminalAttachments[key];
      else terminalAttachments[key] = itemHome(itemId);
    }
    storage.set("terminalAttachments", terminalAttachments);
    return terminalAttachments;
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
    terminalAttachments: {},
    contentFocus: "code",
    terminalPanelWidth: TERMINAL_PANEL_WIDTH_DEFAULT,
    terminalDockSide: TERMINAL_DOCK_SIDE_DEFAULT,
    terminalOverviewOpen: false,
    terminalsSupported: false,

    hydrateTerminalPrefs: async () => {
      const [
        focus,
        legacyMode,
        legacyOpen,
        width,
        dockSide,
        attachments,
        legacyHomes,
      ] = await Promise.all([
        storage.get<ContentFocus>("contentFocus"),
        // Pre-focus installs persisted the same three states under the
        // panel's own names; map them once so the layout survives upgrade.
        storage.get<"closed" | "split" | "maximized">("terminalPanelMode"),
        // And pre-mode installs persisted an open/closed boolean.
        storage.get<boolean>("terminalPanelOpen"),
        storage.get<number>("terminalPanelWidth"),
        storage.get<TerminalDockSide>("terminalDockSide"),
        storage.get<Record<string, string>>("terminalAttachments"),
        // Pre-tab installs keyed attachments by session id. That is the same
        // namespace a tab id lives in — a rebuilt tab takes its session's id
        // — so the old map is a valid attachments map as it stands.
        storage.get<Record<string, string>>("terminalHomes"),
      ]);
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
        terminalDockSide: dockSide ?? TERMINAL_DOCK_SIDE_DEFAULT,
        // Sessions outlive the app, so attachments written in an earlier run
        // are still the answer for the tabs rebuilt from them.
        terminalAttachments: attachments ?? legacyHomes ?? {},
      });
    },

    setTerminalsSupported: (supported) =>
      set({ terminalsSupported: supported }),

    startTerminal: async (repoPath, cwd, cols, rows, shell) => {
      const id = crypto.randomUUID();
      const tabId = crypto.randomUUID();
      // Subscribe BEFORE starting so the first status/exit can't race us.
      subscribeSession(id);
      try {
        const session = await client.terminalStart({
          terminalId: id,
          repoPath,
          cwd,
          cols,
          rows,
          shell,
        });
        const g = get();
        // It starts attached to nothing: a new shell is one more live thing
        // the band will surface until the user says which work it belongs to.
        set({
          ...addTerminalToState(g, session),
          ...addTabForTerminal(g, session.id, tabId),
          ...activateTab(tabId),
        });
        runLaunchCommand(session.id);
        return id;
      } catch (err) {
        unsubscribeSession(id);
        console.error("[terminal] Failed to start terminal:", err);
        toast.error("Failed to start terminal");
        return null;
      }
    },

    splitTerminal: async (tabId, targetTerminalId, direction) => {
      const target = get().terminalSessions[targetTerminalId];
      if (!target) return null;
      const id = crypto.randomUUID();
      subscribeSession(id);
      try {
        const session = await client.terminalStart({
          terminalId: id,
          repoPath: target.repoPath,
          // New pane inherits the split pane's cwd; it refits on mount.
          cwd: target.cwd,
          cols: 80,
          rows: 24,
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
        // A split joins the tab it was opened from, so it takes on that tab's
        // attachment — the two panes are one place of work, and leaving the new
        // pane out of the record would cost it that attachment on the next
        // reload, when the tab fragments back into one tab per session.
        const itemId = tabItemId(get().terminalAttachments, tabId);
        if (itemId) {
          set({ terminalAttachments: rememberAttachment(tabId, itemId) });
        }
        runLaunchCommand(session.id);
        return id;
      } catch (err) {
        unsubscribeSession(id);
        console.error("[terminal] Failed to split terminal:", err);
        toast.error("Failed to start terminal");
        return null;
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

    setActiveTab: (tabId) => set(activateTab(tabId)),

    selectItemTab: (itemId) => {
      const g = get();
      const tabIds = selectTabsByItemId(g)[itemId] ?? [];
      const tabId = mostRecentTabId(tabIds, g.terminalTabUsedAt);
      if (tabId) set(activateTab(tabId));
    },

    setTerminalCheckouts: (activity, reviews) =>
      set({ terminalCheckouts: buildCheckoutIndex(activity, reviews) }),

    attachTerminalToItem: (terminalId, itemId) => {
      const tab = findTabForTerminal(get().terminalTabs, terminalId);
      if (!tab) return;
      set({ terminalAttachments: rememberAttachment(tab.id, itemId) });
    },

    detachTerminal: (terminalId) => {
      const tab = findTabForTerminal(get().terminalTabs, terminalId);
      if (!tab) return;
      set({ terminalAttachments: rememberAttachment(tab.id, null) });
    },

    migrateTerminalAttachments: (items) => {
      const g = get();
      const terminalAttachments = migrateTabAttachments(
        g.terminalAttachments,
        g.terminalTabs,
        items,
      );
      if (jsonEqual(terminalAttachments, g.terminalAttachments)) return;
      set(writeAttachments(terminalAttachments));
    },

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
      const source = findTabForTerminal(g.terminalTabs, sourceTerminalId);
      const next = movePaneToTabTree(g, sourceTerminalId, targetTabId);
      if (!next.terminalTabs) return;
      set({ ...next, ...activateTab(targetTabId) });
      // The pane belongs to the tab it joined now, so it takes on that tab's
      // attachment rather than keeping the one it arrived with — including
      // "none", which is what makes a pane dragged onto an unclaimed tab
      // unclaimed too.
      const itemId = tabItemId(get().terminalAttachments, targetTabId);
      set({ terminalAttachments: rememberAttachment(targetTabId, itemId) });
      // The gesture is a merge when the pane was its old tab's only one, and
      // that tab is gone now.
      if (source && !findTab(get().terminalTabs, source.id)) {
        set(forgetAttachments([source.id]));
      }
    },

    movePaneToNewTab: (sourceTerminalId) => {
      const g = get();
      const source = findTabForTerminal(g.terminalTabs, sourceTerminalId);
      if (!source) return null;
      const tabId = crypto.randomUUID();
      const next = extractPaneToTab(g, sourceTerminalId, tabId);
      if (!next.terminalTabs) return null;
      set({ ...next, ...activateTab(tabId) });
      // A pane pulled out of an attached tab is still that item's work, so the
      // tab it became carries the attachment too.
      const itemId = tabItemId(g.terminalAttachments, source.id);
      if (itemId) {
        set({ terminalAttachments: rememberAttachment(tabId, itemId) });
      }
      return tabId;
    },

    setPaneCollapsed: (tabId, terminalId, collapsed) =>
      set(setPaneCollapsedInTab(get(), tabId, terminalId, collapsed)),

    resizeSplit: (tabId, path, sizes) =>
      set(resizeSplitInTab(get(), tabId, path, sizes)),

    setContentFocus: (focus) => setFocus(focus),

    toggleTerminalPanel: () => {
      // From terminal focus this lands on "code", not "split" — hiding the
      // terminal means the code gets everything, and the way back reopens as
      // a split so the code can't stay hidden behind a panel that isn't
      // showing.
      setFocus(get().contentFocus === "code" ? "split" : "code");
    },

    setTerminalOverviewOpen: (open) => set({ terminalOverviewOpen: open }),

    toggleTerminalOverview: () => {
      const g = get();
      const open = !g.terminalOverviewOpen;
      set({ terminalOverviewOpen: open });
      // "Show me all my terminals" while the code has focus means bring the
      // terminal into view too — an overview toggled on inside a railed panel
      // would read as a no-op.
      if (open && g.contentFocus === "code") setFocus("split");
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

    setTerminalDockSide: (side) => {
      set({ terminalDockSide: side });
      storage.set("terminalDockSide", side);
    },

    toggleTerminalDockSide: () => {
      const side: TerminalDockSide =
        get().terminalDockSide === "left" ? "right" : "left";
      set({ terminalDockSide: side });
      storage.set("terminalDockSide", side);
    },

    consumeFreshTerminal: (id) =>
      set({
        freshTerminalIds: get().freshTerminalIds.filter((x) => x !== id),
      }),

    ensureTerminalSubscription: (id) => subscribeSession(id),

    applyTerminalStatus: (status) => {
      // Edge detection lives at the write, not on any one event channel: the
      // per-session and global status streams both land here, in transport
      // order, and only the first to arrive still sees the phase being
      // replaced. A second delivery of the same status finds prev === next
      // and stays quiet.
      const prev = get().terminalStatuses[status.id];
      notifyTerminalAttention(prev, status);
      // ...and the redundant deliveries stop here rather than reaching the
      // store. Three channels carry each status, and a write allocates a new
      // `terminalStatuses` map, so every surface that summarizes sessions --
      // both rails, the tab strip, the sidebar badge, the overview grid --
      // would re-render two extra times per change. Titles are the field that
      // moves most (an agent rewrites its own on every turn), so those extra
      // renders are the steady-state cost of an idle window, not a rare one.
      if (prev && sameTerminalStatus(prev, status)) return;
      set(applyTerminalStatus(get(), status));
    },
    applyTerminalExit: (exit) => set(applyTerminalExit(get(), exit)),

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
        ),
      });
    },
  };
};
