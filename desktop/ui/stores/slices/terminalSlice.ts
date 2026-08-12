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
 * Sessions are grouped by review key (`makeReviewKey(repoPath, ref)`) so the
 * panel can show the sessions belonging to the active review. `activeTerminalId`
 * is tracked per review key so switching reviews restores the right tab.
 */
export interface TerminalSlice {
  /** Live sessions by id. */
  terminalSessions: Record<string, TerminalSessionInfo>;
  /** Latest status per session id. */
  terminalStatuses: Record<string, TerminalStatus>;
  /** Exit code per session id; presence means the PTY child is gone (dead tab). */
  terminalExited: Record<string, number | null>;
  /** Session ids grouped by review key, in creation order. */
  terminalIdsByReviewKey: Record<string, string[]>;
  /** Active session id per review key. */
  activeTerminalIdByReviewKey: Record<string, string | null>;
  /**
   * Splittable tabs per review key. Each tab holds a pane tree (iTerm/tmux
   * style); this is the structure the panel renders. It layers on top of the
   * flat maps above — those still drive badges (selectTerminalIdsForRow) and
   * reattach (ingestTerminalList).
   */
  terminalTabsByReviewKey: Record<string, TerminalTab[]>;
  /** Active tab id per review key. */
  activeTabIdByReviewKey: Record<string, string | null>;
  /**
   * Ids of sessions created in THIS window that have not yet been opened by a
   * pane. A fresh session has no scrollback worth replaying, so the pane skips
   * the replay round-trip. Consumed (removed) on first pane mount.
   */
  freshTerminalIds: string[];
  /**
   * Every checkout the app currently knows about, per repo, and which review
   * key owns it. This is what a session's cwd is resolved against, so tab
   * placement and the sidebar's dot badges answer the same question the same
   * way instead of agreeing by coincidence.
   */
  terminalCheckouts: CheckoutIndex;
  /**
   * Terminal ids whose tab is pinned (persisted). Keyed by session id rather
   * than tab id because tab ids are window-local — a reload rebuilds the tab
   * list from the backend's session list, using the session id as the tab id.
   * Pinning has to survive that, so it is stored against the thing that does.
   */
  terminalPinnedIds: string[];
  /**
   * Session id → the review key its tab lives under (persisted).
   *
   * Written when the session is created and when the user drags its tab onto
   * another row; never re-derived. Keyed by session id for the same reason
   * `terminalPinnedIds` is — sessions outlive the window, tab ids don't.
   */
  terminalHomes: Record<string, string>;

  /** How the panel shares the content region with the diff (persisted). */
  terminalPanelMode: TerminalPanelMode;
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
   * Create a new session for `reviewKey` in a NEW tab. Generates the id,
   * subscribes to its events BEFORE starting (so no status/exit is missed),
   * then starts the PTY. Resolves to the new id, or null on failure (toasted).
   */
  startTerminal: (
    reviewKey: string,
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
    reviewKey: string,
    tabId: string,
    targetTerminalId: string,
    direction: SplitDirection,
  ) => Promise<string | null>;

  /** Kill a session and remove it from the store (flat maps + pane tree). */
  killTerminal: (id: string) => Promise<void>;

  /** Remove an already-dead session's pane without killing anything. */
  removeTerminal: (id: string) => void;

  setActiveTerminal: (reviewKey: string, id: string) => void;
  setActiveTab: (reviewKey: string, tabId: string) => void;
  /**
   * Pin/unpin a tab: a pinned tab shows in every repo and worktree while
   * keeping its home bucket, so unpinning simply stops showing it elsewhere.
   */
  toggleTabPinned: (tabId: string) => void;
  /**
   * Re-home a tab onto `reviewKey` — the drag from the tab strip onto a
   * sidebar row. Writes the home for every session in the tab, so the move
   * survives a reload and the row's badge counts it too.
   */
  setTabHome: (tabId: string, reviewKey: string) => void;
  /**
   * Re-home one session onto `reviewKey` — the drag from its sidebar row onto
   * another row. The tab-level counterpart is `setTabHome`; this exists because
   * a row can be dragged for a session that has no tab in this window at all
   * (another repo's, merged in so its row can be drawn).
   */
  setTerminalHome: (terminalId: string, reviewKey: string) => void;
  /**
   * Guarantee that `terminalId` has a tab the strip for `reviewKey` will show:
   * move the tab holding it into that bucket, or make one if this window has
   * none. What clicking a sidebar terminal row goes through, so the click can't
   * end pointed at a tab no view renders.
   */
  adoptTerminalTab: (terminalId: string, reviewKey: string) => void;
  /**
   * Publish the current checkout layout. Re-homes every tab against it, which
   * is how a terminal whose worktree was removed gets adopted by its repo's
   * root bucket instead of dropping out of the UI.
   */
  setTerminalCheckouts: (
    activity: RepoLocalActivity[],
    reviews: GlobalReviewSummary[],
  ) => void;
  /**
   * Drag-to-reorder: move a tab within the strip shown for `reviewKey`. Indices
   * are positions in that strip (`mergeVisibleTabs`), not in the stored bucket
   * — the caller drags what it can see.
   */
  moveTab: (reviewKey: string, fromIndex: number, toIndex: number) => void;
  /** Mark `terminalId` as the focused leaf in `tabId`. */
  setFocusedTerminalPane: (
    reviewKey: string,
    tabId: string,
    terminalId: string,
  ) => void;
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
   * dragged onto a tab in the strip. The pane takes on the tab it joined: its
   * home key and its pinned state now follow that tab's.
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
    reviewKey: string,
    tabId: string,
    terminalId: string,
    collapsed: boolean,
  ) => void;
  /**
   * Fold/unfold the pane holding `terminalId`, wherever it lives — the shape
   * the keyboard command needs, which knows a focused pane and not its tab.
   */
  togglePaneCollapsed: (terminalId: string) => void;
  /** Set the child fractions of the split node at `path` within `tabId`. */
  resizeSplit: (
    reviewKey: string,
    tabId: string,
    path: number[],
    sizes: number[],
  ) => void;
  /** Show/hide the panel. Hiding also drops a maximized layout. */
  toggleTerminalPanel: () => void;
  /** Show/hide the all-terminals overview inside the panel. */
  setTerminalOverviewOpen: (open: boolean) => void;
  /** Toggle the overview, opening the panel first if it's closed. */
  toggleTerminalOverview: () => void;
  /** Collapse/restore the diff beside the panel; opens the panel if closed. */
  toggleTerminalPanelMaximized: () => void;
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
   * Fold the authoritative session list for `repoPath` into the buckets its
   * sessions belong to. `fallbackKey` is used only for a repo the checkout
   * index has never seen (nothing loaded yet), so a reattach still lands
   * somewhere the panel can show.
   */
  ingestTerminalList: (
    sessions: TerminalSessionInfo[],
    repoPath: string,
    fallbackKey: string,
  ) => void;
  /**
   * Fold sessions into the flat session/status maps without touching any
   * review-key bucket. Used for sessions in repos other than the open one:
   * their sidebar rows need badges, but they own no tab layout here.
   */
  mergeTerminalSessions: (sessions: TerminalSessionInfo[]) => void;
}

export type TerminalDockSide = "left" | "right";

/**
 * How the terminal panel shares the content region with the diff. One value
 * rather than open/maximized booleans, because "maximized while closed" is not
 * a state the UI has — as two flags it would be an invariant every action had
 * to re-assert.
 */
export type TerminalPanelMode = "closed" | "split" | "maximized";

export const TERMINAL_PANEL_WIDTH_DEFAULT = 480;
export const TERMINAL_PANEL_WIDTH_MIN = 320;
export const TERMINAL_PANEL_WIDTH_MAX = 1000;
export const TERMINAL_DOCK_SIDE_DEFAULT: TerminalDockSide = "left";

// ----- Checkout index (cwd → owning review key) -----

/** One repo's checkout layout, as terminals need to read it. */
export interface RepoCheckouts {
  /**
   * The repo's main row — the row owning the repo root. Orphaned sessions are
   * adopted here: their own directory is gone, but the shell is still alive and
   * may hold work, so it needs a row that always exists.
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
  /**
   * Every review key this repo can show a row for. A stored home naming a key
   * outside this set has no row left to be seen on, which is what
   * `reachableKey` rescues.
   */
  rows: Set<string>;
}

export type CheckoutIndex = Record<string, RepoCheckouts>;

/**
 * Build the checkout index from the same listings the sidebar rows are built
 * from, so a terminal's tab and its sidebar badge can never disagree about
 * which row owns it.
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
    // exists in the sidebar, so a tab homed there is still reachable.
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
  // `repoPath:""` would be a bucket no routed view ever reads: sessions adopted
  // into it would vanish while their PTYs kept running. Fall back to the row
  // owning the repo's first checkout instead. A row with a directory is one the
  // sidebar always shows, so the adopted session stays reachable. The
  // placeholder survives only for a repo with no checkouts at all, which has no
  // rows to be reachable from either.
  for (const [repoPath, repo] of Object.entries(index)) {
    repo.rootKey =
      repo.owners[repoPath] ??
      repo.roots.map((root) => repo.owners[root]).find((key) => key != null) ??
      makeReviewKey(repoPath, "");
  }

  return index;
}

/**
 * The review key a session's tab belongs under *when nothing has been stored
 * for it*: the key owning the innermost checkout its start cwd falls in.
 *
 * This is the initial answer, not a standing one — see `sessionHomeKey`, which
 * is what placement actually goes through.
 *
 * A cwd that matches no known checkout means the checkout was removed while the
 * shell kept running (see `isOrphanedSession`), so it is adopted by the repo's
 * root bucket rather than being left in whichever bucket happened to be
 * selected when it started. `fallback` covers a repo the index has not seen at
 * all — nothing is known yet, so the caller's guess is the best answer.
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
 * A stored home outlives the row it names — the review gets marked done, the
 * branch is deleted — and a bucket no routed view reads is one where a tab
 * disappears while its PTY keeps running. So an unreachable home is *rendered*
 * at the root row; the stored value is deliberately left alone, and the tab
 * goes home if the row comes back.
 *
 * Checked against every repo's rows, not just the session's own: a home is
 * wherever the user dropped the terminal, which can be another repo's row.
 *
 * A repo the index has never seen returns the key untouched: an empty index is
 * not evidence that a row is gone.
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
 * Where a session's tab lives: its stored home if it has one, otherwise the
 * checkout its cwd falls in.
 *
 * Homes are written once, when the terminal is created, and after that only by
 * the user dragging a tab onto a row. Deriving on every ingest instead would
 * mean a `git checkout` in the main working tree silently relocated every shell
 * running in it — the terminal moving under you because of something you did to
 * the repo, not to the terminal.
 *
 * Derivation still answers for a session with no stored home: one this window
 * did not create, reattached from the daemon.
 */
export function sessionHomeKey(
  index: CheckoutIndex,
  homes: Record<string, string>,
  session: TerminalSessionInfo,
  fallback: string,
): string {
  const stored = homes[session.id];
  if (stored) return reachableKey(index, session.repoPath, stored);
  return sessionReviewKey(index, session.repoPath, session.cwd, fallback);
}

/**
 * The bucket the panel reads for what is currently on screen.
 *
 * A repo-level view (no ref resolved yet) is looking at the repo root, which is
 * the main row's checkout — so it reads that row's bucket rather than a key of
 * its own. Without this, a terminal opened from a repo-level view would be
 * filed under the row that owns the repo root and then not shown by the view
 * that started it.
 */
export function panelReviewKey(
  index: CheckoutIndex,
  repoPath: string,
  reviewRef: string | null | undefined,
): string {
  if (reviewRef) return makeReviewKey(repoPath, reviewRef);
  return index[repoPath]?.rootKey ?? makeReviewKey(repoPath, "");
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
 * removal, so it is quietly adopted by the root row instead of flagged — the
 * same place it would land anyway, just without the badge.
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

/** Pick a replacement active id when `current` is no longer in `ids`. */
export function activeFallback(
  ids: string[],
  current: string | null,
): string | null {
  if (current && ids.includes(current)) return current;
  return ids.length > 0 ? ids[0] : null;
}

// ----- Pure reducers (exported for unit testing) -----

type TerminalState = Pick<
  TerminalSlice,
  | "terminalSessions"
  | "terminalStatuses"
  | "terminalExited"
  | "terminalIdsByReviewKey"
  | "activeTerminalIdByReviewKey"
  | "freshTerminalIds"
>;

type TabState = Pick<
  TerminalSlice,
  "terminalTabsByReviewKey" | "activeTabIdByReviewKey"
>;

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
  state: TerminalState,
  status: TerminalStatus,
): Partial<TerminalState> {
  return {
    terminalStatuses: { ...state.terminalStatuses, [status.id]: status },
  };
}

export function applyTerminalExit(
  state: TerminalState,
  exit: TerminalExit,
): Partial<TerminalState> {
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
  state: TerminalState,
  session: TerminalSessionInfo,
  reviewKey: string,
): Partial<TerminalState> {
  const existing = state.terminalIdsByReviewKey[reviewKey] ?? [];
  const ids = existing.includes(session.id)
    ? existing
    : [...existing, session.id];
  return {
    terminalSessions: { ...state.terminalSessions, [session.id]: session },
    terminalStatuses: {
      ...state.terminalStatuses,
      [session.id]: session.status,
    },
    terminalIdsByReviewKey: {
      ...state.terminalIdsByReviewKey,
      [reviewKey]: ids,
    },
    activeTerminalIdByReviewKey: {
      ...state.activeTerminalIdByReviewKey,
      [reviewKey]: session.id,
    },
    freshTerminalIds: state.freshTerminalIds.includes(session.id)
      ? state.freshTerminalIds
      : [...state.freshTerminalIds, session.id],
  };
}

export function removeTerminalFromState(
  state: TerminalState,
  id: string,
): Partial<TerminalState> {
  const terminalSessions = { ...state.terminalSessions };
  delete terminalSessions[id];
  const terminalStatuses = { ...state.terminalStatuses };
  delete terminalStatuses[id];
  const terminalExited = { ...state.terminalExited };
  delete terminalExited[id];

  const terminalIdsByReviewKey: Record<string, string[]> = {};
  const activeTerminalIdByReviewKey = {
    ...state.activeTerminalIdByReviewKey,
  };
  for (const [key, ids] of Object.entries(state.terminalIdsByReviewKey)) {
    const nextIds = ids.filter((x) => x !== id);
    terminalIdsByReviewKey[key] = nextIds;
    if (state.activeTerminalIdByReviewKey[key] === id) {
      activeTerminalIdByReviewKey[key] = activeFallback(nextIds, null);
    }
  }

  return {
    terminalSessions,
    terminalStatuses,
    terminalExited,
    terminalIdsByReviewKey,
    activeTerminalIdByReviewKey,
    freshTerminalIds: state.freshTerminalIds.filter((x) => x !== id),
  };
}

/**
 * Rebuild `repoPath`'s buckets (and the session/status maps for their members)
 * from an authoritative session list, placing each session in the bucket
 * `keyFor` attributes it to. Buckets belonging to other repos are left alone,
 * as are their members inside a shared bucket. A still-alive active id is
 * preserved, otherwise it falls back to the first session.
 */
export function ingestTerminalList(
  state: TerminalState,
  sessions: TerminalSessionInfo[],
  repoPath: string,
  keyFor: (session: TerminalSessionInfo) => string,
): Partial<TerminalState> {
  const terminalSessions = { ...state.terminalSessions };
  const terminalStatuses = { ...state.terminalStatuses };
  const live = new Set<string>();
  const idsByKey = new Map<string, string[]>();
  for (const session of sessions) {
    terminalSessions[session.id] = session;
    // Don't clobber a live status we already hold with the (possibly staler)
    // list snapshot unless we have nothing yet.
    if (!terminalStatuses[session.id]) {
      terminalStatuses[session.id] = session.status;
    }
    live.add(session.id);
    const key = keyFor(session);
    const ids = idsByKey.get(key) ?? [];
    ids.push(session.id);
    idsByKey.set(key, ids);
  }

  const terminalIdsByReviewKey: Record<string, string[]> = {};
  for (const [key, ids] of Object.entries(state.terminalIdsByReviewKey)) {
    terminalIdsByReviewKey[key] = ids.filter((id) => {
      const session = terminalSessions[id];
      // Only this repo's sessions are ours to prune or re-place here.
      if (!session || session.repoPath !== repoPath) return true;
      return live.has(id) && keyFor(session) === key;
    });
  }
  for (const [key, ids] of idsByKey) {
    const existing = terminalIdsByReviewKey[key] ?? [];
    const seen = new Set(existing);
    terminalIdsByReviewKey[key] = [
      ...existing,
      ...ids.filter((id) => !seen.has(id)),
    ];
  }

  return {
    terminalSessions,
    terminalStatuses,
    terminalIdsByReviewKey,
    activeTerminalIdByReviewKey: resolveActiveTerminalIds(
      terminalIdsByReviewKey,
      state.activeTerminalIdByReviewKey,
    ),
  };
}

/**
 * The active session per review key, re-picked wherever the old answer left its
 * bucket. The flat-map counterpart of `resolveActiveTabIds`.
 */
export function resolveActiveTerminalIds(
  idsByKey: Record<string, string[]>,
  previous: Record<string, string | null>,
): Record<string, string | null> {
  const out = { ...previous };
  for (const [key, ids] of Object.entries(idsByKey)) {
    out[key] = activeFallback(ids, out[key] ?? null);
  }
  return out;
}

// ----- Pure tab-tree reducers (exported for unit testing) -----

/**
 * The active tab per review key, re-picked wherever the old answer is gone.
 *
 * A key may point at a tab that lives in another bucket — that is what pinning
 * does — so a tab id counts as still valid if any pinned tab carries it, not
 * only if this key's own bucket does.
 */
export function resolveActiveTabIds(
  tabsByKey: Record<string, TerminalTab[]>,
  previous: Record<string, string | null>,
): Record<string, string | null> {
  const pinnedTabIds = new Set<string>();
  for (const tabs of Object.values(tabsByKey)) {
    for (const tab of tabs) if (tab.pinned) pinnedTabIds.add(tab.id);
  }
  const out: Record<string, string | null> = {};
  for (const key of new Set([
    ...Object.keys(tabsByKey),
    ...Object.keys(previous),
  ])) {
    const tabs = tabsByKey[key] ?? [];
    const current = previous[key] ?? null;
    out[key] =
      current &&
      (tabs.some((t) => t.id === current) || pinnedTabIds.has(current))
        ? current
        : (tabs[0]?.id ?? null);
  }
  return out;
}

/** Locate a tab by id across every bucket, with the key that owns it. */
export function findTab(
  tabsByKey: Record<string, TerminalTab[]>,
  tabId: string,
): { tab: TerminalTab; reviewKey: string } | null {
  for (const [reviewKey, tabs] of Object.entries(tabsByKey)) {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab) return { tab, reviewKey };
  }
  return null;
}

/** Locate the tab containing `terminalId`, with the key that owns it. */
export function findTabForTerminal(
  tabsByKey: Record<string, TerminalTab[]>,
  terminalId: string,
): { tab: TerminalTab; reviewKey: string } | null {
  for (const [reviewKey, tabs] of Object.entries(tabsByKey)) {
    const tab = tabs.find((t) => collectLeafIds(t.root).includes(terminalId));
    if (tab) return { tab, reviewKey };
  }
  return null;
}

/**
 * The tabs the panel shows for `reviewKey`: its own, plus every pinned tab from
 * any key. Pinned first, so the things that travel with you keep a stable
 * position as you move between repos; deduped when a pinned tab is already this
 * key's own.
 */
export function mergeVisibleTabs(
  tabsByKey: Record<string, TerminalTab[]>,
  reviewKey: string,
): { tab: TerminalTab; reviewKey: string }[] {
  const pinned: { tab: TerminalTab; reviewKey: string }[] = [];
  for (const [key, tabs] of Object.entries(tabsByKey)) {
    for (const tab of tabs)
      if (tab.pinned) pinned.push({ tab, reviewKey: key });
  }
  const seen = new Set(pinned.map((v) => v.tab.id));
  const own = (tabsByKey[reviewKey] ?? [])
    .filter((tab) => !seen.has(tab.id))
    .map((tab) => ({ tab, reviewKey }));
  return [...pinned, ...own];
}

/**
 * The stored tab order a strip drag should produce, or `{}` for a drag that
 * can't be honored.
 *
 * Indices are into the strip as rendered (`mergeVisibleTabs`), which is not the
 * stored order: pinned tabs are hoisted to the front on every render, and order
 * itself lives per bucket. So a drag is only writable when everything it passed
 * over shares one bucket *and* one side of the pinned boundary. Anything else
 * gets rejected rather than approximated — the re-sort would swallow the move,
 * leaving a drag that looks like a no-op but has quietly rewritten an order the
 * user will only see later, when the pinned tab is unpinned.
 *
 * The honored case permutes only the slots the moved run occupies, so tabs the
 * drag never appeared to touch keep the stored positions they had.
 */
export function reorderVisibleTabs(
  tabsByKey: Record<string, TerminalTab[]>,
  reviewKey: string,
  fromIndex: number,
  toIndex: number,
): Partial<TabState> {
  if (fromIndex === toIndex) return {};
  const visible = mergeVisibleTabs(tabsByKey, reviewKey);
  const source = visible[fromIndex];
  const target = visible[toIndex];
  if (!source || !target) return {};

  // Checked across the whole span, not just its ends: the question is what the
  // drag passed over, and a tab it skipped past is one it would displace.
  const pinnedSide = !!source.tab.pinned;
  for (
    let i = Math.min(fromIndex, toIndex);
    i <= Math.max(fromIndex, toIndex);
    i++
  ) {
    const entry = visible[i];
    if (entry.reviewKey !== source.reviewKey) return {};
    if (!!entry.tab.pinned !== pinnedSide) return {};
  }

  // The slots the moved run occupies in stored order. Reordering the run within
  // them leaves every other tab's stored position exactly where it was.
  const bucket = tabsByKey[source.reviewKey] ?? [];
  const slots: number[] = [];
  bucket.forEach((tab, i) => {
    if (!!tab.pinned === pinnedSide) slots.push(i);
  });
  const members = slots.map((i) => bucket[i]);
  const from = members.findIndex((tab) => tab.id === source.tab.id);
  const to = members.findIndex((tab) => tab.id === target.tab.id);
  if (from === -1 || to === -1) return {};
  const moved = reorderTabs(members, from, to);
  if (moved === members) return {};

  const tabs = [...bucket];
  slots.forEach((slot, i) => {
    tabs[slot] = moved[i];
  });
  return {
    terminalTabsByReviewKey: { ...tabsByKey, [source.reviewKey]: tabs },
  };
}

/** Append a fresh single-leaf tab for `terminalId` and make it active. */
export function addTabForTerminal(
  state: TabState,
  terminalId: string,
  reviewKey: string,
  tabId: string,
  pinned = false,
): Partial<TabState> {
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];
  const tabs = existing.some((t) => t.id === tabId)
    ? existing
    : [...existing, makeTab(tabId, terminalId, pinned)];
  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [reviewKey]: tabs,
    },
    activeTabIdByReviewKey: {
      ...state.activeTabIdByReviewKey,
      [reviewKey]: tabId,
    },
  };
}

/**
 * Insert `newId` as a split of the focused pane `targetId` within `tabId`, and
 * focus the new leaf. The flat maps are updated separately by
 * `addTerminalToState`.
 *
 * The tab is found by id across every bucket rather than looked up under the
 * caller's review key: a pinned tab is split from wherever it is being shown,
 * which is not where it lives.
 */
export function splitTabForTerminal(
  state: TabState,
  tabId: string,
  targetId: string,
  newId: string,
  direction: SplitDirection,
): Partial<TabState> {
  const found = findTab(state.terminalTabsByReviewKey, tabId);
  if (!found) return {};
  const tabs = (state.terminalTabsByReviewKey[found.reviewKey] ?? []).map(
    (tab) =>
      tab.id === tabId
        ? {
            ...tab,
            root: splitLeaf(tab.root, targetId, newId, direction),
            focused: newId,
          }
        : tab,
  );
  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [found.reviewKey]: tabs,
    },
  };
}

/**
 * Rearrange `tabId`'s panes: put `sourceId` against `edge` of `targetId` and
 * focus it there, because the pane you just placed is the one you meant to work
 * in.
 *
 * Found by tab id across every bucket for the same reason `splitTabForTerminal`
 * is: a pinned tab is dragged from wherever it is being shown, which is not
 * where it lives. A move the tree declines (either pane gone, or a drop that
 * would change nothing) writes nothing.
 */
export function movePaneInTab(
  state: TabState,
  tabId: string,
  sourceId: string,
  targetId: string,
  edge: DropEdge,
): Partial<TabState> {
  const found = findTab(state.terminalTabsByReviewKey, tabId);
  if (!found) return {};
  const root = movePane(found.tab.root, sourceId, targetId, edge);
  if (root === found.tab.root) return {};
  const tabs = (state.terminalTabsByReviewKey[found.reviewKey] ?? []).map(
    (tab) => (tab.id === tabId ? { ...tab, root, focused: sourceId } : tab),
  );
  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [found.reviewKey]: tabs,
    },
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
 * from the tab tree, and splitting a tab's focused pane. So the tab the pane
 * came from collapses (or is dropped when that pane was all it had, making this
 * gesture a merge) by exactly the rule that closing a pane follows.
 *
 * The pane lands focused, and its new tab becomes its key's active one — you
 * just put it there, so that is what should be on screen.
 */
export function movePaneToTabTree(
  state: TabState,
  sourceId: string,
  targetTabId: string,
): Partial<TabState> {
  const source = findTabForTerminal(state.terminalTabsByReviewKey, sourceId);
  const target = findTab(state.terminalTabsByReviewKey, targetTabId);
  if (!source || !target || source.tab.id === targetTabId) return {};

  const lifted = { ...state, ...removeTerminalFromTabs(state, sourceId) };
  const placed = {
    ...lifted,
    // Read from the tab as it was: the removal cannot have touched the target,
    // which is guaranteed above not to hold the pane being moved.
    ...splitTabForTerminal(
      lifted,
      targetTabId,
      target.tab.focused,
      sourceId,
      "row",
    ),
  };

  return {
    terminalTabsByReviewKey: placed.terminalTabsByReviewKey,
    activeTabIdByReviewKey: {
      ...placed.activeTabIdByReviewKey,
      [target.reviewKey]: targetTabId,
    },
  };
}

/**
 * Pull the pane `sourceId` out of its tab into a new tab of its own, placed
 * right after the tab it left — the drop onto the strip's "New tab" slot.
 *
 * Declines when the pane is its tab's only one: it already is its own tab, and
 * honoring the drop would swap one tab for an identical one at a new id,
 * throwing away its position in the strip for nothing.
 *
 * The new tab stays in the bucket the old one lives in and inherits its pinned
 * state, so pulling a pane out never quietly re-homes it.
 */
export function extractPaneToTab(
  state: TabState,
  sourceId: string,
  newTabId: string,
): Partial<TabState> {
  const source = findTabForTerminal(state.terminalTabsByReviewKey, sourceId);
  if (!source) return {};
  const sourceTab = tabWithoutPane(source.tab, sourceId);
  if (!sourceTab) return {};

  const tabs = [...(state.terminalTabsByReviewKey[source.reviewKey] ?? [])];
  const at = tabs.findIndex((tab) => tab.id === source.tab.id);
  tabs.splice(
    at,
    1,
    sourceTab,
    makeTab(newTabId, sourceId, source.tab.pinned ?? false),
  );

  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [source.reviewKey]: tabs,
    },
    activeTabIdByReviewKey: {
      ...state.activeTabIdByReviewKey,
      [source.reviewKey]: newTabId,
    },
  };
}

/**
 * Remove terminal `id` from every tab's tree: collapse single-child splits,
 * re-pick a tab's focus if it lost the focused leaf, drop a tab that empties,
 * and re-pick the active tab per review key if it went away.
 */
export function removeTerminalFromTabs(
  state: TabState,
  id: string,
): Partial<TabState> {
  const terminalTabsByReviewKey: Record<string, TerminalTab[]> = {};
  for (const [key, tabs] of Object.entries(state.terminalTabsByReviewKey)) {
    // A tab that has nothing left is dropped, which is what the nulls are.
    terminalTabsByReviewKey[key] = tabs
      .map((tab) => tabWithoutPane(tab, id))
      .filter((tab): tab is TerminalTab => tab !== null);
  }
  return {
    terminalTabsByReviewKey,
    activeTabIdByReviewKey: resolveActiveTabIds(
      terminalTabsByReviewKey,
      state.activeTabIdByReviewKey,
    ),
  };
}

/** Flip a tab's pinned flag, wherever it lives. */
export function setTabPinned(
  state: TabState,
  tabId: string,
  pinned: boolean,
): Partial<TabState> {
  const found = findTab(state.terminalTabsByReviewKey, tabId);
  if (!found) return {};
  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [found.reviewKey]: (
        state.terminalTabsByReviewKey[found.reviewKey] ?? []
      ).map((tab) => (tab.id === tabId ? { ...tab, pinned } : tab)),
    },
  };
}

/**
 * Move one tab into `targetKey`'s bucket, appended at the end.
 *
 * The tab becomes the target key's active tab: the user just put it there, so
 * that row should be showing it the next time they open it. The bucket it left
 * re-picks its own active tab.
 */
export function moveTabToKey(
  state: TabState,
  tabId: string,
  targetKey: string,
): Partial<TabState> {
  const found = findTab(state.terminalTabsByReviewKey, tabId);
  if (!found || found.reviewKey === targetKey) return {};

  const terminalTabsByReviewKey = { ...state.terminalTabsByReviewKey };
  terminalTabsByReviewKey[found.reviewKey] = (
    terminalTabsByReviewKey[found.reviewKey] ?? []
  ).filter((tab) => tab.id !== tabId);
  terminalTabsByReviewKey[targetKey] = [
    ...(terminalTabsByReviewKey[targetKey] ?? []),
    found.tab,
  ];

  return {
    terminalTabsByReviewKey,
    activeTabIdByReviewKey: {
      ...resolveActiveTabIds(
        terminalTabsByReviewKey,
        state.activeTabIdByReviewKey,
      ),
      [targetKey]: tabId,
    },
  };
}

/**
 * Move `ids` into `targetKey`'s flat bucket. The tab tree is what the panel
 * renders, but these buckets still order the panel's sessions and hold the
 * per-key active id, so a re-homed tab has to move in both.
 */
export function moveTerminalsToKey(
  state: TerminalState,
  ids: string[],
  targetKey: string,
): Partial<TerminalState> {
  const moving = new Set(ids);
  const terminalIdsByReviewKey: Record<string, string[]> = {};
  for (const [key, bucket] of Object.entries(state.terminalIdsByReviewKey)) {
    terminalIdsByReviewKey[key] = bucket.filter((id) => !moving.has(id));
  }
  const existing = terminalIdsByReviewKey[targetKey] ?? [];
  terminalIdsByReviewKey[targetKey] = [...existing, ...ids];

  return {
    terminalIdsByReviewKey,
    activeTerminalIdByReviewKey: resolveActiveTerminalIds(
      terminalIdsByReviewKey,
      state.activeTerminalIdByReviewKey,
    ),
  };
}

/**
 * Move each tab into the bucket its session now belongs to. `homeFor` returns
 * null for a session it has no opinion about, leaving that tab where it is.
 *
 * This is what adopts a terminal whose worktree was removed: its cwd stops
 * matching any checkout, `homeFor` sends it to the repo's root bucket, and the
 * tab follows the session instead of being stranded wherever it was created.
 */
export function rehomeTabs(
  state: TabState,
  sessions: Record<string, TerminalSessionInfo>,
  homeFor: (session: TerminalSessionInfo) => string | null,
): Partial<TabState> {
  const homeOf = (tab: TerminalTab, currentKey: string): string => {
    const session = collectLeafIds(tab.root)
      .map((id) => sessions[id])
      .find((s) => s != null);
    // Panes in a tab all start from the same directory, so the first known one
    // answers for the tab. An unknown session leaves it put.
    if (!session) return currentKey;
    return homeFor(session) ?? currentKey;
  };

  const terminalTabsByReviewKey: Record<string, TerminalTab[]> = {};
  for (const key of Object.keys(state.terminalTabsByReviewKey)) {
    terminalTabsByReviewKey[key] = [];
  }
  let moved = false;
  for (const [key, tabs] of Object.entries(state.terminalTabsByReviewKey)) {
    for (const tab of tabs) {
      const home = homeOf(tab, key);
      if (home !== key) moved = true;
      (terminalTabsByReviewKey[home] ??= []).push(tab);
    }
  }
  if (!moved) return {};

  return {
    terminalTabsByReviewKey,
    activeTabIdByReviewKey: resolveActiveTabIds(
      terminalTabsByReviewKey,
      state.activeTabIdByReviewKey,
    ),
  };
}

/**
 * Set the focused leaf of `tabId`. Focusing a collapsed pane unfolds it —
 * every route to a pane (a click, ⌥⌘`, an overview card) goes through here, so
 * none of them can land the keyboard on a title bar.
 */
export function setFocusedInTab(
  state: TabState,
  reviewKey: string,
  tabId: string,
  terminalId: string,
): Partial<TabState> {
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];
  const tabs = existing.map((tab) =>
    tab.id === tabId
      ? {
          ...tab,
          focused: terminalId,
          root: setLeafCollapsed(tab.root, terminalId, false),
        }
      : tab,
  );
  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [reviewKey]: tabs,
    },
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
  reviewKey: string,
  tabId: string,
  terminalId: string,
  collapsed: boolean,
): Partial<TabState> {
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];
  const tab = existing.find((t) => t.id === tabId);
  if (!tab) return {};

  const root = setLeafCollapsed(tab.root, terminalId, collapsed);
  if (root === tab.root) return {};
  const stillShowing = expandedLeafIds(root);
  if (stillShowing.length === 0) return {};

  const tabs = existing.map((t) =>
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
  );
  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [reviewKey]: tabs,
    },
  };
}

/** Set the child fractions of the split at `path` within `tabId`. */
export function resizeSplitInTab(
  state: TabState,
  reviewKey: string,
  tabId: string,
  path: number[],
  sizes: number[],
): Partial<TabState> {
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];
  const tabs = existing.map((tab) =>
    tab.id === tabId
      ? { ...tab, root: setSizesAtPath(tab.root, path, sizes) }
      : tab,
  );
  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [reviewKey]: tabs,
    },
  };
}

/**
 * Reconcile `repoPath`'s tabs against an authoritative session list: prune
 * leaves whose session vanished (collapsing/dropping as needed), wrap any
 * session not yet placed into its own single-leaf tab (deterministic tab id =
 * the session id, which is what makes a reload rebuild the same tabs), and
 * re-home every tab against `keyFor`.
 *
 * `known` is every session the store holds, needed to tell this repo's leaves
 * from another repo's inside the same pass.
 */
export function ingestTabs(
  state: TabState,
  sessions: TerminalSessionInfo[],
  known: Record<string, TerminalSessionInfo>,
  repoPath: string,
  keyFor: (session: TerminalSessionInfo) => string,
  isPinned: (terminalId: string) => boolean,
): Partial<TabState> {
  const live = new Set(sessions.map((s) => s.id));
  const byId: Record<string, TerminalSessionInfo> = { ...known };
  for (const session of sessions) byId[session.id] = session;

  // Only drop leaves we can positively say belong to this repo and are gone —
  // an unknown leaf may be another repo's, and this list says nothing about it.
  const keep = new Set<string>();
  for (const tabs of Object.values(state.terminalTabsByReviewKey)) {
    for (const tab of tabs) {
      for (const leafId of collectLeafIds(tab.root)) {
        const session = byId[leafId];
        const gone =
          session != null && session.repoPath === repoPath && !live.has(leafId);
        if (!gone) keep.add(leafId);
      }
    }
  }

  const terminalTabsByReviewKey: Record<string, TerminalTab[]> = {};
  const placed = new Set<string>();
  for (const [key, tabs] of Object.entries(state.terminalTabsByReviewKey)) {
    const out: TerminalTab[] = [];
    for (const tab of tabs) {
      const pruned = withRepairedFocus(tab, pruneLeaves(tab.root, keep));
      if (!pruned) continue;
      const leaves = collectLeafIds(pruned.root);
      out.push({ ...pruned, pinned: tab.pinned || leaves.some(isPinned) });
      for (const leafId of leaves) placed.add(leafId);
    }
    terminalTabsByReviewKey[key] = out;
  }

  for (const session of sessions) {
    if (placed.has(session.id)) continue;
    const key = keyFor(session);
    (terminalTabsByReviewKey[key] ??= []).push(
      makeTab(session.id, session.id, isPinned(session.id)),
    );
    placed.add(session.id);
  }

  const rehomed = rehomeTabs(
    { terminalTabsByReviewKey, activeTabIdByReviewKey: {} },
    byId,
    (session) => (session.repoPath === repoPath ? keyFor(session) : null),
  );

  const tabsByKey = rehomed.terminalTabsByReviewKey ?? terminalTabsByReviewKey;
  return {
    terminalTabsByReviewKey: tabsByKey,
    activeTabIdByReviewKey: resolveActiveTabIds(
      tabsByKey,
      state.activeTabIdByReviewKey,
    ),
  };
}

/**
 * The checkout a session belongs to: the longest known checkout root
 * containing its cwd, or null if it started outside all of them.
 *
 * A shell is bound to a directory, so a *checkout* is what owns a session —
 * not a branch name. That makes ownership survive everything a branch can't:
 * a row disappearing, a branch being renamed, a review being deleted. The
 * trade is that `git checkout` in the main working tree visibly moves its
 * terminals to whichever row now holds that directory, which is honest —
 * those shells really are sitting on the new branch.
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

type HomeState = Pick<
  TerminalSlice,
  "terminalSessions" | "terminalCheckouts" | "terminalHomes"
>;

function groupByHomeKey(
  sessions: TerminalSessionInfo[],
  state: HomeState,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const session of sessions) {
    const key = sessionHomeKey(
      state.terminalCheckouts,
      state.terminalHomes,
      session,
      makeReviewKey(session.repoPath, ""),
    );
    (out[key] ??= []).push(session.id);
  }
  return out;
}

/**
 * Every session grouped by the row that owns it — the answer the sidebar's
 * per-row badges read.
 *
 * One pass for the whole sidebar rather than one scan per row, and one rule:
 * asking each row to attribute sessions itself is what let a row's badge and
 * the tab strip disagree about a terminal that had been re-homed.
 *
 * Includes exited sessions, which still have a tab and still belong to a row
 * until they are closed.
 */
export function selectSessionsByHomeKey(
  state: HomeState,
): Record<string, string[]> {
  return groupByHomeKey(Object.values(state.terminalSessions), state);
}

/**
 * Live (not yet exited) session ids grouped by the review key that owns them.
 *
 * Resolved through the checkout index rather than the sidebar tree, so the
 * answer doesn't depend on a presentation structure — and so the tree can take
 * this as an input without either one needing the other first. A session whose
 * checkout is gone lands in its repo's root bucket, the same place
 * `sessionHomeKey` puts it everywhere else.
 */
export function selectLiveSessionsByReviewKey(
  state: HomeState & Pick<TerminalSlice, "terminalExited">,
): Record<string, string[]> {
  return groupByHomeKey(
    Object.values(state.terminalSessions).filter(
      (s) => !(s.id in state.terminalExited),
    ),
    state,
  );
}

export const createTerminalSlice: SliceCreatorWithClientAndStorage<
  TerminalSlice
> = (client, storage) => (set, get) => {
  // Per-session unsubscribe fns (status + exit). Module-of-closure state, not
  // store state — these are non-serializable and window-local.
  const sessionUnsubs = new Map<string, () => void>();

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

  function setPanelMode(mode: TerminalPanelMode): void {
    set({ terminalPanelMode: mode });
    storage.set("terminalPanelMode", mode);
  }

  function unsubscribeSession(id: string): void {
    const unsub = sessionUnsubs.get(id);
    if (unsub) {
      unsub();
      sessionUnsubs.delete(id);
    }
  }

  /**
   * Drop a gone session from every map that holds it.
   *
   * Including the pinned list: it is keyed by session id and persisted, so a
   * session that is never coming back would otherwise leave an entry in the
   * Tauri store forever — one per pinned terminal ever closed.
   */
  function teardownSession(id: string): void {
    unsubscribeSession(id);
    const g = get();
    const next: Partial<TerminalSlice> = {
      ...removeTerminalFromState(g, id),
      ...removeTerminalFromTabs(g, id),
      terminalPinnedIds: setPinned([id], false),
    };
    if (id in g.terminalHomes) {
      const terminalHomes = { ...g.terminalHomes };
      delete terminalHomes[id];
      next.terminalHomes = terminalHomes;
      storage.set("terminalHomes", terminalHomes);
    }
    set(next);
  }

  /**
   * Where a session's tab belongs. Every placement goes through here so tab
   * bucketing and the sidebar's per-row badges are the same computation, rather
   * than two that happen to agree.
   */
  function ownerKey(session: TerminalSessionInfo, fallback: string): string {
    const g = get();
    return sessionHomeKey(
      g.terminalCheckouts,
      g.terminalHomes,
      session,
      fallback,
    );
  }

  /** Record where these sessions live, and persist it. */
  function rememberHome(
    ids: string[],
    reviewKey: string,
  ): Record<string, string> {
    const terminalHomes = { ...get().terminalHomes };
    for (const id of ids) terminalHomes[id] = reviewKey;
    storage.set("terminalHomes", terminalHomes);
    return terminalHomes;
  }

  /**
   * Record whether these sessions' tabs are pinned, and persist the change.
   *
   * The one way this list is written. It is keyed by session id and outlives
   * the window, so anything that changes which tab a session sits in has to say
   * so here — a pane carrying a stale pin into an unpinned tab would pin that
   * tab on the next reload, when the tab list is rebuilt from this list.
   *
   * Only the named sessions are touched, never the whole list: pins are global
   * and this window only knows the tabs of the repos it has opened.
   */
  function setPinned(ids: string[], pinned: boolean): string[] {
    const current = get().terminalPinnedIds;
    const next = pinned
      ? [...new Set([...current, ...ids])]
      : current.filter((id) => !ids.includes(id));
    if (next.length === current.length) return current;
    storage.set("terminalPinnedIds", next);
    return next;
  }

  return {
    terminalSessions: {},
    terminalStatuses: {},
    terminalExited: {},
    terminalIdsByReviewKey: {},
    activeTerminalIdByReviewKey: {},
    terminalTabsByReviewKey: {},
    activeTabIdByReviewKey: {},
    freshTerminalIds: [],
    terminalCheckouts: {},
    terminalPinnedIds: [],
    terminalHomes: {},
    terminalPanelMode: "closed",
    terminalPanelWidth: TERMINAL_PANEL_WIDTH_DEFAULT,
    terminalDockSide: TERMINAL_DOCK_SIDE_DEFAULT,
    terminalOverviewOpen: false,
    terminalsSupported: false,

    hydrateTerminalPrefs: async () => {
      const [mode, legacyOpen, width, dockSide, pinned, homes] =
        await Promise.all([
          storage.get<TerminalPanelMode>("terminalPanelMode"),
          // Pre-mode installs persisted an open/closed boolean; honor it once so
          // the panel doesn't silently close on upgrade.
          storage.get<boolean>("terminalPanelOpen"),
          storage.get<number>("terminalPanelWidth"),
          storage.get<TerminalDockSide>("terminalDockSide"),
          storage.get<string[]>("terminalPinnedIds"),
          storage.get<Record<string, string>>("terminalHomes"),
        ]);
      set({
        terminalPanelMode: mode ?? (legacyOpen ? "split" : "closed"),
        terminalPanelWidth: width ?? TERMINAL_PANEL_WIDTH_DEFAULT,
        terminalDockSide: dockSide ?? TERMINAL_DOCK_SIDE_DEFAULT,
        terminalPinnedIds: pinned ?? [],
        // Sessions outlive the app, so homes written in an earlier run are
        // still the answer for the sessions the daemon hands back.
        terminalHomes: homes ?? {},
      });
    },

    setTerminalsSupported: (supported) =>
      set({ terminalsSupported: supported }),

    startTerminal: async (reviewKey, repoPath, cwd, cols, rows, shell) => {
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
        // The terminal belongs to the checkout it was started in, not to
        // whatever row happened to be selected — those differ the moment you
        // open a shell in a worktree and then click back to the repo row.
        //
        // Recorded once, here: where it started is the answer for the rest of
        // its life, unless the user says otherwise by dragging its tab.
        const key = ownerKey(session, reviewKey);
        set({
          ...addTerminalToState(g, session, key),
          ...addTabForTerminal(g, session.id, key, tabId),
          terminalHomes: rememberHome([session.id], key),
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

    splitTerminal: async (reviewKey, tabId, targetTerminalId, direction) => {
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
        // A split joins the tab it was opened from, so it inherits the pane's
        // home rather than deriving one — otherwise splitting a re-homed tab
        // would drag half of it back to the directory's own row.
        const homeKey =
          g.terminalHomes[targetTerminalId] ?? ownerKey(session, reviewKey);
        set({
          ...addTerminalToState(
            g,
            session,
            reachableKey(g.terminalCheckouts, session.repoPath, homeKey),
          ),
          terminalHomes: rememberHome([session.id], homeKey),
          ...splitTabForTerminal(
            g,
            tabId,
            targetTerminalId,
            session.id,
            direction,
          ),
        });
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

    setActiveTerminal: (reviewKey, id) =>
      set({
        activeTerminalIdByReviewKey: {
          ...get().activeTerminalIdByReviewKey,
          [reviewKey]: id,
        },
      }),

    setActiveTab: (reviewKey, tabId) =>
      set({
        activeTabIdByReviewKey: {
          ...get().activeTabIdByReviewKey,
          [reviewKey]: tabId,
        },
      }),

    toggleTabPinned: (tabId) => {
      const g = get();
      const found = findTab(g.terminalTabsByReviewKey, tabId);
      if (!found) return;
      const pinned = !found.tab.pinned;
      // Persisted against the session ids, not the tab id: tab ids are
      // window-local and a reload re-derives them from the session list.
      const terminalPinnedIds = setPinned(
        collectLeafIds(found.tab.root),
        pinned,
      );
      const next = setTabPinned(g, tabId, pinned);
      const tabsByKey =
        next.terminalTabsByReviewKey ?? g.terminalTabsByReviewKey;
      set({
        ...next,
        // Unpinning takes the tab off every other key's strip, so any key that
        // was pointing at it as a visitor has to be re-pointed here — a key
        // left aimed at a tab it can no longer see renders no active tab at
        // all, which reads as an empty panel.
        activeTabIdByReviewKey: resolveActiveTabIds(
          tabsByKey,
          g.activeTabIdByReviewKey,
        ),
        terminalPinnedIds,
      });
    },

    setTerminalCheckouts: (activity, reviews) => {
      const terminalCheckouts = buildCheckoutIndex(activity, reviews);
      const g = get();
      // This fires when the checkout listing changed, which is when a row a tab
      // was homed on may have stopped existing. For a session with a stored
      // home that is all this does — rescue it to a row that exists, without
      // touching what was stored. Sessions with no home (reattached from the
      // daemon) are still placed by their cwd here.
      set({
        terminalCheckouts,
        ...rehomeTabs(g, g.terminalSessions, (session) =>
          // No fallback key to offer for a repo we know nothing about, so leave
          // those tabs alone rather than guessing.
          terminalCheckouts[session.repoPath]
            ? sessionHomeKey(terminalCheckouts, g.terminalHomes, session, "")
            : null,
        ),
      });
    },

    setTabHome: (tabId, reviewKey) => {
      const g = get();
      const found = findTab(g.terminalTabsByReviewKey, tabId);
      if (!found) return;
      const leafIds = collectLeafIds(found.tab.root);
      // Stored even when the tab is already in this bucket: it may be sitting
      // here only because its own row is gone, and dropping it here is the
      // user saying this is where it belongs now.
      const terminalHomes = rememberHome(leafIds, reviewKey);
      set({
        terminalHomes,
        ...moveTabToKey(g, tabId, reviewKey),
        ...moveTerminalsToKey(g, leafIds, reviewKey),
      });
    },

    setTerminalHome: (terminalId, reviewKey) => {
      const g = get();
      // Panes in a tab travel together, so a row dragged onto another row takes
      // the whole tab with it — the same move dragging that tab would make.
      const found = findTabForTerminal(g.terminalTabsByReviewKey, terminalId);
      if (found) {
        get().setTabHome(found.tab.id, reviewKey);
        return;
      }
      // No tab here to move: the session belongs to a repo this window hasn't
      // opened, so the stored home (which its own window reads) is the move.
      set({
        terminalHomes: rememberHome([terminalId], reviewKey),
        ...moveTerminalsToKey(g, [terminalId], reviewKey),
      });
    },

    adoptTerminalTab: (terminalId, reviewKey) => {
      const g = get();
      const found = findTabForTerminal(g.terminalTabsByReviewKey, terminalId);
      // A pinned tab is already in every strip; moving it would relocate a tab
      // the user can see either way.
      if (found?.tab.pinned) return;
      if (found) {
        if (found.reviewKey === reviewKey) return;
        set({
          ...moveTabToKey(g, found.tab.id, reviewKey),
          ...moveTerminalsToKey(g, collectLeafIds(found.tab.root), reviewKey),
        });
        return;
      }
      const session = g.terminalSessions[terminalId];
      if (!session) return;
      // Nothing has placed this session in this window — same tab id a reattach
      // would give it, so the tab made here is the tab the next ingest keeps.
      // Deliberately no `rememberHome`: this is a rendering rescue, not the
      // user saying where the terminal belongs.
      set({
        ...addTabForTerminal(
          g,
          terminalId,
          reviewKey,
          terminalId,
          g.terminalPinnedIds.includes(terminalId),
        ),
        ...moveTerminalsToKey(g, [terminalId], reviewKey),
      });
    },

    moveTab: (reviewKey, fromIndex, toIndex) => {
      // reorderVisibleTabs hands back nothing for a drag it won't honor (a
      // no-op, or one the strip's pinned-first sort would swallow), so those
      // don't re-render the panel — or rewrite an order they didn't touch.
      const next = reorderVisibleTabs(
        get().terminalTabsByReviewKey,
        reviewKey,
        fromIndex,
        toIndex,
      );
      if (!next.terminalTabsByReviewKey) return;
      set(next);
    },

    setFocusedTerminalPane: (reviewKey, tabId, terminalId) =>
      set(setFocusedInTab(get(), reviewKey, tabId, terminalId)),

    dropPaneOn: (sourceTerminalId, targetTerminalId, edge) => {
      const g = get();
      const found = findTabForTerminal(
        g.terminalTabsByReviewKey,
        targetTerminalId,
      );
      if (!found) return;
      set(
        movePaneInTab(
          g,
          found.tab.id,
          sourceTerminalId,
          targetTerminalId,
          edge,
        ),
      );
    },

    movePaneToTab: (sourceTerminalId, targetTabId) => {
      const g = get();
      const target = findTab(g.terminalTabsByReviewKey, targetTabId);
      if (!target) return;
      const next = movePaneToTabTree(g, sourceTerminalId, targetTabId);
      if (!next.terminalTabsByReviewKey) return;
      // The pane belongs to the tab it joined now — the same fact `setTabHome`
      // records when a whole tab is dragged onto a sidebar row, and the reason
      // its flat bucket has to move with it.
      set({
        ...next,
        ...moveTerminalsToKey(g, [sourceTerminalId], target.reviewKey),
        terminalHomes: rememberHome([sourceTerminalId], target.reviewKey),
        terminalPinnedIds: setPinned([sourceTerminalId], !!target.tab.pinned),
      });
    },

    movePaneToNewTab: (sourceTerminalId) => {
      const g = get();
      const source = findTabForTerminal(
        g.terminalTabsByReviewKey,
        sourceTerminalId,
      );
      if (!source) return null;
      const tabId = crypto.randomUUID();
      const next = extractPaneToTab(g, sourceTerminalId, tabId);
      if (!next.terminalTabsByReviewKey) return null;
      set({
        ...next,
        // The new tab inherits the old one's pinning, so the pane has to be
        // recorded as pinned itself — a pane split off a pinned tab was never
        // added to this list, and the list is what survives a reload.
        terminalPinnedIds: setPinned([sourceTerminalId], !!source.tab.pinned),
      });
      return tabId;
    },

    setPaneCollapsed: (reviewKey, tabId, terminalId, collapsed) =>
      set(
        setPaneCollapsedInTab(get(), reviewKey, tabId, terminalId, collapsed),
      ),

    togglePaneCollapsed: (terminalId) => {
      const g = get();
      const found = findTabForTerminal(g.terminalTabsByReviewKey, terminalId);
      if (!found) return;
      const isCollapsed = !expandedLeafIds(found.tab.root).includes(terminalId);
      set(
        setPaneCollapsedInTab(
          g,
          found.reviewKey,
          found.tab.id,
          terminalId,
          !isCollapsed,
        ),
      );
    },

    resizeSplit: (reviewKey, tabId, path, sizes) =>
      set(resizeSplitInTab(get(), reviewKey, tabId, path, sizes)),

    toggleTerminalPanel: () => {
      // Hiding a maximized panel returns to "split" on the next open, so the
      // diff can't stay hidden behind a panel that isn't showing.
      setPanelMode(get().terminalPanelMode === "closed" ? "split" : "closed");
    },

    setTerminalOverviewOpen: (open) => set({ terminalOverviewOpen: open }),

    toggleTerminalOverview: () => {
      const g = get();
      const open = !g.terminalOverviewOpen;
      set({ terminalOverviewOpen: open });
      // "Show me all my terminals" from a closed panel means open it too —
      // an overview toggled on inside a hidden panel would read as a no-op.
      if (open && g.terminalPanelMode === "closed") setPanelMode("split");
    },

    toggleTerminalPanelMaximized: () => {
      // From closed this opens maximized — the shortcut reads as "show me the
      // terminal, full size" whichever state it starts from.
      setPanelMode(
        get().terminalPanelMode === "maximized" ? "split" : "maximized",
      );
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
    mergeTerminalSessions: (sessions) => {
      if (sessions.length === 0) return;
      const g = get();
      const terminalSessions = { ...g.terminalSessions };
      const terminalStatuses = { ...g.terminalStatuses };
      for (const session of sessions) {
        terminalSessions[session.id] = session;
        // A live status already in hand beats the list snapshot, which may be
        // staler than the events we've been receiving.
        terminalStatuses[session.id] ??= session.status;
      }
      set({ terminalSessions, terminalStatuses });
    },

    ingestTerminalList: (sessions, repoPath, fallbackKey) => {
      const g = get();
      const keyFor = (session: TerminalSessionInfo) =>
        ownerKey(session, fallbackKey);
      const pinned = new Set(g.terminalPinnedIds);
      set({
        ...ingestTerminalList(g, sessions, repoPath, keyFor),
        ...ingestTabs(g, sessions, g.terminalSessions, repoPath, keyFor, (id) =>
          pinned.has(id),
        ),
      });
    },
  };
};
