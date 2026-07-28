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
import type { SliceCreatorWithClientAndStorage } from "../types";
import {
  type TerminalTab,
  type SplitDirection,
  makeTab,
  splitLeaf,
  removeLeaf,
  pruneLeaves,
  collectLeafIds,
  firstLeafId,
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

  /** How the panel shares the content region with the diff (persisted). */
  terminalPanelMode: TerminalPanelMode;
  /** Panel width in px (persisted) — the vertical pane's own width. */
  terminalPanelWidth: number;
  /** Which side of the content region the panel docks on (persisted). */
  terminalDockSide: TerminalDockSide;
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
   * Publish the current checkout layout. Re-homes every tab against it, which
   * is how a terminal whose worktree was removed gets adopted by its repo's
   * root bucket instead of dropping out of the UI.
   */
  setTerminalCheckouts: (
    activity: RepoLocalActivity[],
    reviews: GlobalReviewSummary[],
  ) => void;
  /** Drag-to-reorder: move a tab within its review's tab strip. */
  moveTab: (reviewKey: string, fromIndex: number, toIndex: number) => void;
  /** Mark `terminalId` as the focused leaf in `tabId`. */
  setFocusedTerminalPane: (
    reviewKey: string,
    tabId: string,
    terminalId: string,
  ) => void;
  /** Set the child fractions of the split node at `path` within `tabId`. */
  resizeSplit: (
    reviewKey: string,
    tabId: string,
    path: number[],
    sizes: number[],
  ) => void;
  /** Show/hide the panel. Hiding also drops a maximized layout. */
  toggleTerminalPanel: () => void;
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
   * The repo's main row — the branch checked out at the repo root. Orphaned
   * sessions are adopted here: their own directory is gone, but the shell is
   * still alive and may hold work, so it needs a row that always exists.
   */
  rootKey: string;
  /** Every checkout root in the repo, innermost-wins ordering applied later. */
  roots: string[];
  /** Checkout root → the review key whose row owns it. */
  owners: Record<string, string>;
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
      if (branch.isCurrent) repo.rootKey = key;
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
 * The review key a session's tab belongs under: the key owning the innermost
 * checkout its start cwd falls in.
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
const PHASE_SEVERITY: Record<TerminalPhase, number> = {
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

  const activeTerminalIdByReviewKey = {
    ...state.activeTerminalIdByReviewKey,
  };
  for (const [key, ids] of Object.entries(terminalIdsByReviewKey)) {
    activeTerminalIdByReviewKey[key] = activeFallback(
      ids,
      activeTerminalIdByReviewKey[key] ?? null,
    );
  }

  return {
    terminalSessions,
    terminalStatuses,
    terminalIdsByReviewKey,
    activeTerminalIdByReviewKey,
  };
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
    const out: TerminalTab[] = [];
    for (const tab of tabs) {
      const root = removeLeaf(tab.root, id);
      if (!root) continue; // tab emptied → dropped
      const leaves = collectLeafIds(root);
      const focused = leaves.includes(tab.focused)
        ? tab.focused
        : firstLeafId(root);
      out.push({ ...tab, root, focused });
    }
    terminalTabsByReviewKey[key] = out;
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

/** Set the focused leaf of `tabId`. */
export function setFocusedInTab(
  state: TabState,
  reviewKey: string,
  tabId: string,
  terminalId: string,
): Partial<TabState> {
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];
  const tabs = existing.map((tab) =>
    tab.id === tabId ? { ...tab, focused: terminalId } : tab,
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
      const root = pruneLeaves(tab.root, keep);
      if (!root) continue;
      const leaves = collectLeafIds(root);
      const focused = leaves.includes(tab.focused)
        ? tab.focused
        : firstLeafId(root);
      out.push({
        ...tab,
        root,
        focused,
        pinned: tab.pinned || leaves.some(isPinned),
      });
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
 * Ordered session ids to render for a review — all sessions whose repoPath
 * matches, ordered by the review-key bucket first, then any stragglers. Keeps
 * the panel correct even after a reattach that grouped under a different key.
 */
export function selectTerminalIdsForReview(
  state: Pick<TerminalSlice, "terminalSessions" | "terminalIdsByReviewKey">,
  repoPath: string,
  reviewKey: string,
): string[] {
  const bucket = state.terminalIdsByReviewKey[reviewKey] ?? [];
  const ordered: string[] = [];
  const seen = new Set<string>();
  for (const id of bucket) {
    const session = state.terminalSessions[id];
    if (session && session.repoPath === repoPath) {
      ordered.push(id);
      seen.add(id);
    }
  }
  for (const [id, session] of Object.entries(state.terminalSessions)) {
    if (session.repoPath === repoPath && !seen.has(id)) {
      ordered.push(id);
    }
  }
  return ordered;
}

/**
 * Session ids for a TabRail row. When the row has a dedicated worktree
 * (`review.worktreePath`), scope to sessions whose cwd falls under it —
 * branch-level. Rows without one (e.g. the main checkout) fall back to every
 * live session for the repo — repo-level, and the default case.
 */
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

/**
 * Ids of the sessions belonging to one row.
 *
 * `checkoutPath` is the row's own directory — a linked worktree, or the repo
 * root for the main working-tree row. Rows without a checkout own no sessions
 * (they have nowhere to run one), so they get an empty list.
 *
 * `checkouts` is every checkout root in the repo, needed to attribute a
 * session to the *innermost* one: worktrees can live under the repo root, so a
 * plain prefix test would let the repo-root row claim every worktree's
 * terminals as well as its own.
 */
export function selectTerminalIdsForRow(
  state: Pick<TerminalSlice, "terminalSessions">,
  repoPath: string,
  checkoutPath: string | null | undefined,
  checkouts: readonly string[],
): string[] {
  if (!checkoutPath) return [];
  return Object.values(state.terminalSessions)
    .filter((s) => s.repoPath === repoPath)
    .filter((s) => sessionCheckout(s.cwd, checkouts) === checkoutPath)
    .map((s) => s.id);
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
   * Where a session's tab belongs. Every placement goes through here so tab
   * bucketing and the sidebar's per-row badges are the same computation, rather
   * than two that happen to agree.
   */
  function ownerKey(session: TerminalSessionInfo, fallback: string): string {
    return sessionReviewKey(
      get().terminalCheckouts,
      session.repoPath,
      session.cwd,
      fallback,
    );
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
    terminalPanelMode: "closed",
    terminalPanelWidth: TERMINAL_PANEL_WIDTH_DEFAULT,
    terminalDockSide: TERMINAL_DOCK_SIDE_DEFAULT,
    terminalsSupported: false,

    hydrateTerminalPrefs: async () => {
      const [mode, legacyOpen, width, dockSide, pinned] = await Promise.all([
        storage.get<TerminalPanelMode>("terminalPanelMode"),
        // Pre-mode installs persisted an open/closed boolean; honor it once so
        // the panel doesn't silently close on upgrade.
        storage.get<boolean>("terminalPanelOpen"),
        storage.get<number>("terminalPanelWidth"),
        storage.get<TerminalDockSide>("terminalDockSide"),
        storage.get<string[]>("terminalPinnedIds"),
      ]);
      set({
        terminalPanelMode: mode ?? (legacyOpen ? "split" : "closed"),
        terminalPanelWidth: width ?? TERMINAL_PANEL_WIDTH_DEFAULT,
        terminalDockSide: dockSide ?? TERMINAL_DOCK_SIDE_DEFAULT,
        terminalPinnedIds: pinned ?? [],
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
        const key = ownerKey(session, reviewKey);
        set({
          ...addTerminalToState(g, session, key),
          ...addTabForTerminal(g, session.id, key, tabId),
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
        set({
          // Same attribution as a new tab: the pane inherits the target's cwd,
          // so it lands in the target's checkout — which is the tab's home even
          // when the tab is being shown from somewhere else (pinned).
          ...addTerminalToState(g, session, ownerKey(session, reviewKey)),
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
      unsubscribeSession(id);
      const g = get();
      set({
        ...removeTerminalFromState(g, id),
        ...removeTerminalFromTabs(g, id),
      });
    },

    removeTerminal: (id) => {
      unsubscribeSession(id);
      const g = get();
      set({
        ...removeTerminalFromState(g, id),
        ...removeTerminalFromTabs(g, id),
      });
    },

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
      const leafIds = collectLeafIds(found.tab.root);
      const terminalPinnedIds = pinned
        ? [...new Set([...g.terminalPinnedIds, ...leafIds])]
        : g.terminalPinnedIds.filter((id) => !leafIds.includes(id));
      set({
        ...setTabPinned(g, tabId, pinned),
        terminalPinnedIds,
      });
      storage.set("terminalPinnedIds", terminalPinnedIds);
    },

    setTerminalCheckouts: (activity, reviews) => {
      const terminalCheckouts = buildCheckoutIndex(activity, reviews);
      const g = get();
      // Re-homing here is the whole point: this fires when the checkout listing
      // changed, which is exactly when a worktree may have disappeared out from
      // under a still-running shell.
      set({
        terminalCheckouts,
        ...rehomeTabs(g, g.terminalSessions, (session) =>
          // No fallback key to offer for a repo we know nothing about, so leave
          // those tabs alone rather than guessing.
          terminalCheckouts[session.repoPath]
            ? sessionReviewKey(
                terminalCheckouts,
                session.repoPath,
                session.cwd,
                "",
              )
            : null,
        ),
      });
    },

    moveTab: (reviewKey, fromIndex, toIndex) => {
      const byKey = get().terminalTabsByReviewKey;
      const existing = byKey[reviewKey] ?? [];
      const tabs = reorderTabs(existing, fromIndex, toIndex);
      // reorderTabs hands back the same array for a no-op, so a drag that
      // ends where it started doesn't re-render the panel.
      if (tabs === existing) return;
      set({ terminalTabsByReviewKey: { ...byKey, [reviewKey]: tabs } });
    },

    setFocusedTerminalPane: (reviewKey, tabId, terminalId) =>
      set(setFocusedInTab(get(), reviewKey, tabId, terminalId)),

    resizeSplit: (reviewKey, tabId, path, sizes) =>
      set(resizeSplitInTab(get(), reviewKey, tabId, path, sizes)),

    toggleTerminalPanel: () => {
      // Hiding a maximized panel returns to "split" on the next open, so the
      // diff can't stay hidden behind a panel that isn't showing.
      setPanelMode(get().terminalPanelMode === "closed" ? "split" : "closed");
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

    applyTerminalStatus: (status) => set(applyTerminalStatus(get(), status)),
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
