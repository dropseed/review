import { toast } from "sonner";
import type {
  TerminalSessionInfo,
  TerminalStatus,
  TerminalPhase,
  TerminalExit,
} from "../../types";
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
  ingestTerminalList: (
    sessions: TerminalSessionInfo[],
    reviewKey: string,
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
 * Rebuild the `reviewKey` bucket (and the session/status maps for its members)
 * from an authoritative session list. Other review keys are left untouched.
 * Sessions the list dropped are pruned from that bucket; a still-alive active
 * id is preserved, otherwise it falls back to the first session.
 */
export function ingestTerminalList(
  state: TerminalState,
  sessions: TerminalSessionInfo[],
  reviewKey: string,
): Partial<TerminalState> {
  const terminalSessions = { ...state.terminalSessions };
  const terminalStatuses = { ...state.terminalStatuses };
  const ids: string[] = [];
  for (const session of sessions) {
    terminalSessions[session.id] = session;
    // Don't clobber a live status we already hold with the (possibly staler)
    // list snapshot unless we have nothing yet.
    if (!terminalStatuses[session.id]) {
      terminalStatuses[session.id] = session.status;
    }
    ids.push(session.id);
  }

  const active = activeFallback(
    ids,
    state.activeTerminalIdByReviewKey[reviewKey] ?? null,
  );

  return {
    terminalSessions,
    terminalStatuses,
    terminalIdsByReviewKey: {
      ...state.terminalIdsByReviewKey,
      [reviewKey]: ids,
    },
    activeTerminalIdByReviewKey: {
      ...state.activeTerminalIdByReviewKey,
      [reviewKey]: active,
    },
  };
}

// ----- Pure tab-tree reducers (exported for unit testing) -----

/** Append a fresh single-leaf tab for `terminalId` and make it active. */
export function addTabForTerminal(
  state: TabState,
  terminalId: string,
  reviewKey: string,
  tabId: string,
): Partial<TabState> {
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];
  const tabs = existing.some((t) => t.id === tabId)
    ? existing
    : [...existing, makeTab(tabId, terminalId)];
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
 */
export function splitTabForTerminal(
  state: TabState,
  reviewKey: string,
  tabId: string,
  targetId: string,
  newId: string,
  direction: SplitDirection,
): Partial<TabState> {
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];
  const tabs = existing.map((tab) =>
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
      [reviewKey]: tabs,
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
  const activeTabIdByReviewKey = { ...state.activeTabIdByReviewKey };
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
    if (!out.some((t) => t.id === activeTabIdByReviewKey[key])) {
      activeTabIdByReviewKey[key] = out[0]?.id ?? null;
    }
  }
  return { terminalTabsByReviewKey, activeTabIdByReviewKey };
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
 * Reconcile a review key's tabs against an authoritative session list: prune
 * leaves whose session vanished (collapsing/dropping as needed), then wrap any
 * session not yet placed in a tab into its own single-leaf tab (deterministic
 * tab id = the session id). Keeps reattach/reload showing every session.
 */
export function ingestTabs(
  state: TabState,
  sessions: TerminalSessionInfo[],
  reviewKey: string,
): Partial<TabState> {
  const sessionIds = sessions.map((s) => s.id);
  const keep = new Set(sessionIds);
  const existing = state.terminalTabsByReviewKey[reviewKey] ?? [];

  const tabs: TerminalTab[] = [];
  const placed = new Set<string>();
  for (const tab of existing) {
    const root = pruneLeaves(tab.root, keep);
    if (!root) continue;
    const leaves = collectLeafIds(root);
    const focused = leaves.includes(tab.focused)
      ? tab.focused
      : firstLeafId(root);
    tabs.push({ ...tab, root, focused });
    for (const leafId of leaves) placed.add(leafId);
  }

  for (const id of sessionIds) {
    if (placed.has(id)) continue;
    tabs.push(makeTab(id, id));
    placed.add(id);
  }

  const prevActive = state.activeTabIdByReviewKey[reviewKey] ?? null;
  const active = tabs.some((t) => t.id === prevActive)
    ? prevActive
    : (tabs[0]?.id ?? null);

  return {
    terminalTabsByReviewKey: {
      ...state.terminalTabsByReviewKey,
      [reviewKey]: tabs,
    },
    activeTabIdByReviewKey: {
      ...state.activeTabIdByReviewKey,
      [reviewKey]: active,
    },
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
 * Every checkout root in a repo: its working tree, every linked worktree, and
 * every review-managed worktree.
 *
 * Review worktrees have to come from `globalReviews`, not just `localActivity`.
 * `localActivity` maps worktrees by *local branch name*, so a materialized fork
 * PR — whose head branch doesn't exist in this repo, and whose worktree lives
 * under `~/.review/worktrees/` outside the repo entirely — never appears there.
 * Attributing from that list alone would leave exactly the case PR checkouts
 * exist for with no terminal badge at all.
 */
export function selectRepoCheckouts(
  repoPath: string,
  localActivity: readonly {
    repoPath: string;
    branches: readonly { worktreePath?: string | null }[];
  }[],
  globalReviews: readonly { repoPath: string; worktreePath?: string | null }[],
): string[] {
  const roots = new Set<string>([repoPath]);
  const repo = localActivity.find((r) => r.repoPath === repoPath);
  for (const branch of repo?.branches ?? []) {
    if (branch.worktreePath) roots.add(branch.worktreePath);
  }
  for (const review of globalReviews) {
    if (review.repoPath === repoPath && review.worktreePath) {
      roots.add(review.worktreePath);
    }
  }
  return [...roots];
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

  return {
    terminalSessions: {},
    terminalStatuses: {},
    terminalExited: {},
    terminalIdsByReviewKey: {},
    activeTerminalIdByReviewKey: {},
    terminalTabsByReviewKey: {},
    activeTabIdByReviewKey: {},
    freshTerminalIds: [],
    terminalPanelMode: "closed",
    terminalPanelWidth: TERMINAL_PANEL_WIDTH_DEFAULT,
    terminalDockSide: TERMINAL_DOCK_SIDE_DEFAULT,
    terminalsSupported: false,

    hydrateTerminalPrefs: async () => {
      const [mode, legacyOpen, width, dockSide] = await Promise.all([
        storage.get<TerminalPanelMode>("terminalPanelMode"),
        // Pre-mode installs persisted an open/closed boolean; honor it once so
        // the panel doesn't silently close on upgrade.
        storage.get<boolean>("terminalPanelOpen"),
        storage.get<number>("terminalPanelWidth"),
        storage.get<TerminalDockSide>("terminalDockSide"),
      ]);
      set({
        terminalPanelMode: mode ?? (legacyOpen ? "split" : "closed"),
        terminalPanelWidth: width ?? TERMINAL_PANEL_WIDTH_DEFAULT,
        terminalDockSide: dockSide ?? TERMINAL_DOCK_SIDE_DEFAULT,
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
        set({
          ...addTerminalToState(g, session, reviewKey),
          ...addTabForTerminal(g, session.id, reviewKey, tabId),
        });
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
          ...addTerminalToState(g, session, reviewKey),
          ...splitTabForTerminal(
            g,
            reviewKey,
            tabId,
            targetTerminalId,
            session.id,
            direction,
          ),
        });
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

    ingestTerminalList: (sessions, reviewKey) => {
      const g = get();
      set({
        ...ingestTerminalList(g, sessions, reviewKey),
        ...ingestTabs(g, sessions, reviewKey),
      });
    },
  };
};
