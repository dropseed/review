import { describe, it, expect, vi, afterEach } from "vitest";
import {
  applyTerminalStatus,
  sameTerminalStatus,
  applyTerminalExit,
  addTerminalToState,
  removeTerminalFromState,
  mergeSessionList,
  sessionCheckout,
  terminalSeverity,
  addTabForTerminal,
  splitTabForTerminal,
  movePaneInTab,
  movePaneToTabTree,
  extractPaneToTab,
  removeTerminalFromTabs,
  setFocusedInTab,
  setPaneCollapsedInTab,
  resizeSplitInTab,
  ingestTabs,
  buildCheckoutIndex,
  isOrphanedSession,
  resolveActiveTabId,
  createTerminalSlice,
  TERMINAL_PANEL_WIDTH_DEFAULT,
  mostRecentTabId,
  selectTabsByWorkspaceId,
  tabWorkspaceId,
  withWorkspace,
  tabSessionIds,
  terminalDockPresent,
  restoreTabs,
  TAB_LAYOUT_KEY,
} from "./terminalSlice";
import type { PersistedTabLayout } from "./terminalSlice";
import {
  collectLeafIds,
  expandedLeafIds,
  leaf,
  makeTab,
  splitLeaf,
} from "../../components/Terminal/pane-tree";
import type { TerminalTab } from "../../components/Terminal/pane-tree";
import type {
  LocalBranchInfo,
  RepoLocalActivity,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalPhase,
} from "../../types";
import { terminalStatus } from "../../test/fixtures";

function status(
  id: string,
  phase: TerminalPhase = "idle",
  overrides: Partial<TerminalStatus> = {},
): TerminalStatus {
  return terminalStatus(phase, { id, ...overrides });
}

function session(
  id: string,
  repoPath: string,
  overrides: Partial<TerminalSessionInfo> = {},
): TerminalSessionInfo {
  return {
    id,
    repoPath,
    workspaceId: null,
    cwd: repoPath,
    title: `sh-${id}`,
    cols: 80,
    rows: 24,
    status: status(id),
    ...overrides,
  };
}

function branch(
  name: string,
  overrides: Partial<LocalBranchInfo> = {},
): LocalBranchInfo {
  return {
    name,
    isCurrent: false,
    commitsAhead: 0,
    unpushedCommits: 0,
    behindUpstream: 0,
    hasWorkingTreeChanges: false,
    lastCommitDate: "",
    lastCommitMessage: "",
    lastCommitByUser: false,
    worktreePath: null,
    lastModifiedAt: null,
    workingTreeStats: null,
    ...overrides,
  };
}

interface TestState {
  terminalSessions: Record<string, TerminalSessionInfo>;
  terminalStatuses: Record<string, TerminalStatus>;
  terminalExited: Record<string, number | null>;
  freshTerminalIds: string[];
}

function emptyState(): TestState {
  return {
    terminalSessions: {},
    terminalStatuses: {},
    terminalExited: {},
    freshTerminalIds: [],
  };
}

describe("terminalSlice reducers", () => {
  it("applyTerminalStatus records the status by id", () => {
    const next = applyTerminalStatus(emptyState(), status("a", "working"));
    expect(next.terminalStatuses).toEqual({ a: status("a", "working") });
  });

  it("sameTerminalStatus is true for a redundant redelivery", () => {
    expect(
      sameTerminalStatus(status("a", "working"), status("a", "working")),
    ).toBe(true);
  });

  it("sameTerminalStatus separates statuses that differ only by title", () => {
    // The field an agent rewrites every turn, and the reason the dedupe pays.
    expect(
      sameTerminalStatus(
        status("a", "working", { title: "npm test" }),
        status("a", "working", { title: "npm build" }),
      ),
    ).toBe(false);
  });

  it("sameTerminalStatus separates a phase change", () => {
    expect(
      sameTerminalStatus(
        status("a", "working"),
        status("a", "needs_attention"),
      ),
    ).toBe(false);
  });

  it("addTerminalToState records the session, its status and its freshness", () => {
    let state = { ...emptyState() };
    state = { ...state, ...addTerminalToState(state, session("a", "/r")) };
    state = { ...state, ...addTerminalToState(state, session("b", "/r")) };

    expect(state.terminalSessions["a"].repoPath).toBe("/r");
    expect(state.terminalStatuses["b"]).toBeDefined();
    expect(state.freshTerminalIds).toEqual(["a", "b"]);
  });

  it("applyTerminalExit records the exit code and idles the status", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...applyTerminalStatus(state, status("a", "working")),
    };
    state = { ...state, ...applyTerminalExit(state, { id: "a", exitCode: 1 }) };
    expect(state.terminalExited["a"]).toBe(1);
    expect(state.terminalStatuses["a"].phase).toBe("idle");
    expect(state.terminalStatuses["a"].lastExitCode).toBe(1);
  });

  it("removeTerminalFromState drops the session from every map", () => {
    let state = { ...emptyState() };
    state = { ...state, ...addTerminalToState(state, session("a", "/r")) };
    state = { ...state, ...addTerminalToState(state, session("b", "/r")) };
    state = { ...state, ...removeTerminalFromState(state, "b") };
    expect(state.terminalSessions["b"]).toBeUndefined();
    expect(state.terminalStatuses["b"]).toBeUndefined();
    expect(state.freshTerminalIds).toEqual(["a"]);
    expect(state.terminalSessions["a"]).toBeDefined();
  });

  it("mergeSessionList keeps a live status over the list's snapshot", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...applyTerminalStatus(state, status("a", "needs_attention")),
    };
    const next = mergeSessionList(state, [session("a", "/r")]);
    // The list carries an idle status; the pushed one we already hold is newer.
    expect(next.terminalStatuses!["a"].phase).toBe("needs_attention");
    expect(next.terminalSessions!["a"]).toBeDefined();
  });

  it("mergeSessionList leaves sessions the list doesn't mention alone", () => {
    // A session started in this window since the list was fetched still has a
    // title, a phase and a row.
    let state = { ...emptyState() };
    state = { ...state, ...addTerminalToState(state, session("new", "/r")) };
    const next = mergeSessionList(state, [session("old", "/r")]);
    expect(Object.keys(next.terminalSessions!).sort()).toEqual(["new", "old"]);
  });
});

describe("workspace attribution", () => {
  it("groups tabs by the workspace their sessions are in", () => {
    const state = {
      terminalTabs: [
        makeTab("t1", "a"),
        makeTab("t2", "b"),
        makeTab("t3", "c"),
      ],
      terminalSessions: {
        a: session("a", "/r", { workspaceId: "one" }),
        b: session("b", "/r", { workspaceId: "one" }),
        c: session("c", "/r", { workspaceId: "two" }),
      },
    };
    expect(selectTabsByWorkspaceId(state)).toEqual({
      one: ["t1", "t2"],
      two: ["t3"],
    });
  });

  it("takes a split tab's answer from the first pane that has one", () => {
    const tab = {
      ...makeTab("t1", "a"),
      root: splitLeaf(leaf("a"), "a", "b", "row"),
    };
    const state = {
      terminalTabs: [tab],
      terminalSessions: {
        a: session("a", "/r", { workspaceId: "one" }),
        b: session("b", "/r", { workspaceId: "two" }),
      },
    };
    expect(tabWorkspaceId(state, tab)).toBe("one");

    // A session the list hasn't arrived for yet has no answer, and a tab with
    // no answer is in no bucket rather than in a wrong one.
    const unknown = { terminalTabs: [tab], terminalSessions: {} };
    expect(tabWorkspaceId(unknown, tab)).toBeNull();
    expect(selectTabsByWorkspaceId(unknown)).toEqual({});
  });

  it("re-attributes a whole tab's sessions at once", () => {
    const state = {
      terminalSessions: {
        a: session("a", "/r", { workspaceId: "one" }),
        b: session("b", "/r", { workspaceId: "one" }),
      },
    };
    const moved = withWorkspace(state, ["a", "b"], "two");
    expect(moved.a.workspaceId).toBe("two");
    expect(moved.b.workspaceId).toBe("two");
    // A session it doesn't know about is skipped rather than invented.
    expect(withWorkspace(state, ["gone"], "two")).toEqual(
      state.terminalSessions,
    );
  });

  it("mostRecentTabId picks the last activated, or the first never activated", () => {
    expect(mostRecentTabId(["a", "b"], { a: 1, b: 2 })).toBe("b");
    expect(mostRecentTabId(["a", "b"], { b: 2 })).toBe("b");
    expect(mostRecentTabId(["a", "b"], {})).toBe("a");
    expect(mostRecentTabId([], {})).toBeNull();
  });
});

describe("sessionCheckout", () => {
  it("picks the innermost containing checkout", () => {
    expect(
      sessionCheckout("/r/.worktrees/feature/src", [
        "/r",
        "/r/.worktrees/feature",
      ]),
    ).toBe("/r/.worktrees/feature");
  });

  it("returns null for a cwd outside every checkout", () => {
    expect(sessionCheckout("/elsewhere", ["/r"])).toBeNull();
  });

  it("does not treat a sibling path sharing a prefix as contained", () => {
    expect(sessionCheckout("/r-other/src", ["/r"])).toBeNull();
  });
});

describe("terminalSeverity", () => {
  it("returns null for no sessions", () => {
    expect(terminalSeverity([])).toBeNull();
  });

  it("ranks attention above waiting above working above idle", () => {
    expect(
      terminalSeverity([status("a", "idle"), status("b", "working")]),
    ).toBe("working");
    expect(
      terminalSeverity([
        status("a", "working"),
        status("b", "waiting_for_input"),
      ]),
    ).toBe("waiting_for_input");
    expect(
      terminalSeverity([
        status("a", "waiting_for_input"),
        status("b", "needs_attention"),
      ]),
    ).toBe("needs_attention");
  });
});

interface TabTestState {
  terminalTabs: TerminalTab[];
  activeTabId: string | null;
  terminalSessions: Record<string, TerminalSessionInfo>;
}

function emptyTabState(): TabTestState {
  return { terminalTabs: [], activeTabId: null, terminalSessions: {} };
}

/** A strip of single-pane tabs, each session attributed to a workspace. */
function strip(
  tabs: [tabId: string, workspaceId: string | null][],
  activeTabId: string | null,
): TabTestState {
  const terminalSessions: Record<string, TerminalSessionInfo> = {};
  for (const [tabId, workspaceId] of tabs) {
    terminalSessions[tabId] = { ...session(tabId, "/r"), workspaceId };
  }
  return {
    terminalTabs: tabs.map(([tabId]) => makeTab(tabId, tabId)),
    activeTabId,
    terminalSessions,
  };
}

/** `state` without the tabs named — the strip after a close. */
function without(state: TabTestState, ...tabIds: string[]): TerminalTab[] {
  return state.terminalTabs.filter((tab) => !tabIds.includes(tab.id));
}

describe("resolveActiveTabId", () => {
  it("keeps the current tab when it is still there", () => {
    const state = strip([["a", "w1"]], "a");
    expect(resolveActiveTabId(state, state.terminalTabs)).toBe("a");
  });

  it("takes the tab after the one that went away", () => {
    const state = strip(
      [
        ["a", "w1"],
        ["b", "w1"],
        ["c", "w1"],
      ],
      "b",
    );
    expect(resolveActiveTabId(state, without(state, "b"))).toBe("c");
  });

  it("falls back to the tab before it when it was the last", () => {
    const state = strip(
      [
        ["a", "w1"],
        ["b", "w1"],
      ],
      "b",
    );
    expect(resolveActiveTabId(state, without(state, "b"))).toBe("a");
  });

  // The panel draws one workspace's tabs, so a nearer tab belonging to another
  // one leaves a strip with nothing under it.
  it("prefers a tab of the same workspace over a nearer stranger", () => {
    const state = strip(
      [
        ["a", "w1"],
        ["b", "w1"],
        ["c", "w2"],
        ["d", "w1"],
      ],
      "b",
    );
    expect(resolveActiveTabId(state, without(state, "b"))).toBe("d");
  });

  it("takes the nearest survivor when the workspace has none left", () => {
    const state = strip(
      [
        ["a", "w2"],
        ["b", "w1"],
        ["c", "w2"],
      ],
      "b",
    );
    expect(resolveActiveTabId(state, without(state, "b"))).toBe("c");
  });

  it("re-picks the first when the remembered tab was never in the strip", () => {
    const state = { ...strip([["b", "w1"]], "a") };
    expect(resolveActiveTabId(state, state.terminalTabs)).toBe("b");
  });

  it("nulls when there are no tabs left", () => {
    const state = strip([["a", "w1"]], "a");
    expect(resolveActiveTabId(state, [])).toBeNull();
  });
});

describe("tab reducers", () => {
  it("addTabForTerminal appends a single-leaf tab and makes it active", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = { ...state, ...addTabForTerminal(state, "b", "tabB") };
    expect(state.terminalTabs.map((t) => t.id)).toEqual(["tabA", "tabB"]);
    expect(state.terminalTabs[0].root).toEqual({
      type: "leaf",
      terminalId: "a",
    });
    expect(state.activeTabId).toBe("tabB");
  });

  it("splitTabForTerminal splits the target leaf and focuses the new one", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    const tab = state.terminalTabs[0];
    expect(tab.root).toEqual({
      type: "split",
      direction: "row",
      children: [
        { type: "leaf", terminalId: "a" },
        { type: "leaf", terminalId: "b" },
      ],
      sizes: [0.5, 0.5],
    });
    expect(tab.focused).toBe("b");
  });

  it("tabSessionIds answers with the whole tab, or the terminal itself", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    expect(tabSessionIds(state.terminalTabs, "b")).toEqual(["a", "b"]);
    expect(tabSessionIds(state.terminalTabs, "zz")).toEqual(["zz"]);
  });

  it("removeTerminalFromTabs collapses a split and re-picks focus", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    // focused is "b"; removing it collapses to leaf "a" and re-focuses "a"
    state = { ...state, ...removeTerminalFromTabs(state, "b") };
    const tab = state.terminalTabs[0];
    expect(tab.root).toEqual({ type: "leaf", terminalId: "a" });
    expect(tab.focused).toBe("a");
  });

  it("removeTerminalFromTabs drops the tab and re-picks active when last pane closes", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = { ...state, ...addTabForTerminal(state, "b", "tabB") };
    // active is tabB; closing its only pane drops the tab, active → tabA
    state = { ...state, ...removeTerminalFromTabs(state, "b") };
    expect(state.terminalTabs.map((t) => t.id)).toEqual(["tabA"]);
    expect(state.activeTabId).toBe("tabA");
  });

  it("setFocusedInTab updates the focused leaf", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = { ...state, ...setFocusedInTab(state, "tabA", "a") };
    expect(state.terminalTabs[0].focused).toBe("a");
  });

  it("movePaneInTab rearranges the tab's panes and focuses the moved one", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = { ...state, ...setFocusedInTab(state, "tabA", "b") };
    // Drop "b" against the top of "a": the row becomes a column, b first.
    state = { ...state, ...movePaneInTab(state, "tabA", "b", "a", "top") };
    const tab = state.terminalTabs[0];
    expect(tab.root).toEqual({
      type: "split",
      direction: "column",
      children: [
        { type: "leaf", terminalId: "b" },
        { type: "leaf", terminalId: "a" },
      ],
      sizes: [0.5, 0.5],
    });
    expect(tab.focused).toBe("b");
  });

  it("movePaneInTab writes nothing for an unknown tab or a drop that changes nothing", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    expect(movePaneInTab(state, "nope", "b", "a", "left")).toEqual({});
    // "b" is already to the right of "a".
    expect(movePaneInTab(state, "tabA", "b", "a", "right")).toEqual({});
  });

  it("movePaneToTabTree moves a pane into another tab and shows it there", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = { ...state, ...addTabForTerminal(state, "c", "tabB") };
    state = { ...state, ...movePaneToTabTree(state, "b", "tabB") };

    const [tabA, tabB] = state.terminalTabs;
    expect(tabA.root).toEqual({ type: "leaf", terminalId: "a" });
    expect(tabA.focused).toBe("a");
    expect(collectLeafIds(tabB.root)).toEqual(["c", "b"]);
    expect(tabB.focused).toBe("b");
    expect(state.activeTabId).toBe("tabB");
  });

  it("movePaneToTabTree drops the tab a single pane left behind", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = { ...state, ...addTabForTerminal(state, "b", "tabB") };
    state = { ...state, ...movePaneToTabTree(state, "a", "tabB") };
    expect(state.terminalTabs.map((t) => t.id)).toEqual(["tabB"]);
    expect(collectLeafIds(state.terminalTabs[0].root)).toEqual(["b", "a"]);
  });

  it("movePaneToTabTree writes nothing for an unknown tab or the pane's own", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    expect(movePaneToTabTree(state, "b", "tabA")).toEqual({});
    expect(movePaneToTabTree(state, "b", "nope")).toEqual({});
    expect(movePaneToTabTree(state, "zz", "tabA")).toEqual({});
  });

  it("extractPaneToTab pulls a pane into its own tab beside the old one", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = { ...state, ...addTabForTerminal(state, "c", "tabB") };
    state = { ...state, ...extractPaneToTab(state, "b", "tabNew") };

    expect(state.terminalTabs.map((t) => t.id)).toEqual([
      "tabA",
      "tabNew",
      "tabB",
    ]);
    expect(state.terminalTabs[0].root).toEqual({
      type: "leaf",
      terminalId: "a",
    });
    expect(state.terminalTabs[1].root).toEqual({
      type: "leaf",
      terminalId: "b",
    });
    expect(state.activeTabId).toBe("tabNew");
  });

  it("extractPaneToTab declines a pane that is already its tab's only one", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    expect(extractPaneToTab(state, "a", "tabNew")).toEqual({});
    expect(extractPaneToTab(state, "zz", "tabNew")).toEqual({});
  });

  it("resizeSplitInTab sets the root split's sizes", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = { ...state, ...resizeSplitInTab(state, "tabA", [], [0.7, 0.3]) };
    const root = state.terminalTabs[0].root;
    if (root.type !== "split") throw new Error("expected split");
    expect(root.sizes).toEqual([0.7, 0.3]);
  });

  /** A tab with panes "a" and "b" side by side, focused on "b". */
  function splitTab() {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    return { ...state, ...splitTabForTerminal(state, "tabA", "a", "b", "row") };
  }

  it("setPaneCollapsedInTab folds a pane and hands focus to one still showing", () => {
    let state = splitTab();
    expect(state.terminalTabs[0].focused).toBe("b");
    state = { ...state, ...setPaneCollapsedInTab(state, "tabA", "b", true) };
    const tab = state.terminalTabs[0];
    expect(expandedLeafIds(tab.root)).toEqual(["a"]);
    expect(tab.focused).toBe("a");
  });

  it("setPaneCollapsedInTab declines to fold the last pane showing", () => {
    let state = splitTab();
    state = { ...state, ...setPaneCollapsedInTab(state, "tabA", "b", true) };
    expect(setPaneCollapsedInTab(state, "tabA", "a", true)).toEqual({});
    expect(setPaneCollapsedInTab(state, "tabA", "zz", true)).toEqual({});
    expect(setPaneCollapsedInTab(state, "nope", "a", true)).toEqual({});
  });

  it("re-picks focus onto a pane still showing when one closes", () => {
    // The state folding leaves behind: "a" folded, focus handed to "b". Closing
    // "b" must not hand focus back to the folded "a" — the tab would draw only
    // "c", dimmed, with the keyboard pointed at a title bar.
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "b", "c", "row"),
    };
    state = { ...state, ...setFocusedInTab(state, "tabA", "a") };
    state = { ...state, ...setPaneCollapsedInTab(state, "tabA", "a", true) };
    const focusedAfterFold = state.terminalTabs[0].focused;
    state = { ...state, ...removeTerminalFromTabs(state, focusedAfterFold) };

    const tab = state.terminalTabs[0];
    expect(expandedLeafIds(tab.root)).toContain(tab.focused);
  });

  it("setFocusedInTab unfolds the pane it focuses", () => {
    let state = splitTab();
    state = { ...state, ...setPaneCollapsedInTab(state, "tabA", "b", true) };
    state = { ...state, ...setFocusedInTab(state, "tabA", "b") };
    const tab = state.terminalTabs[0];
    expect(tab.focused).toBe("b");
    expect(expandedLeafIds(tab.root)).toEqual(["a", "b"]);
  });

  it("folding leaves the split's sizes intact so unfolding restores them", () => {
    let state = splitTab();
    state = { ...state, ...resizeSplitInTab(state, "tabA", [], [0.7, 0.3]) };
    state = { ...state, ...setPaneCollapsedInTab(state, "tabA", "b", true) };
    state = { ...state, ...setPaneCollapsedInTab(state, "tabA", "b", false) };
    const root = state.terminalTabs[0].root;
    if (root.type !== "split") throw new Error("expected split");
    expect(root.sizes).toEqual([0.7, 0.3]);
  });
});

// Minimal harness: drive the real slice actions with an in-memory store and a
// stub storage that records writes and answers reads, so we can assert both
// halves of persistence.

function makeSlice(client: any = {}) {
  const writes: Record<string, unknown> = {};
  const reads: Record<string, unknown> = {};
  const storage = {
    get: async (key: string) => reads[key],
    set: (key: string, value: unknown) => {
      writes[key] = value;
    },
  } as any;

  let state: any = {};

  const set = (partial: any) => {
    state = {
      ...state,
      ...(typeof partial === "function" ? partial(state) : partial),
    };
  };
  const get = () => state;

  state = createTerminalSlice(client, storage)(set, get, {} as any);
  return { get, set, writes, reads };
}

describe("slice actions", () => {
  /**
   * A client whose `terminalStart` answers with `started` and the landing the
   * backend routed it to — the shape the real one returns.
   */
  const startingClient = (
    started: TerminalSessionInfo,
    workspace: { id: string; title: string; created: boolean } = {
      id: started.workspaceId ?? "one",
      title: "routed",
      created: false,
    },
    assigned: [string, string | null][] = [],
  ) => ({
    terminalStart: async () => ({ session: started, workspace }),
    terminalAssignWorkspace: async (id: string, ws: string | null) => {
      assigned.push([id, ws]);
    },
    onTerminalExit: () => () => {},
    terminalWrite: async () => {},
  });

  /** A client that only records reassignments. */
  const assigningClient = (assigned: [string, string | null][]) => ({
    terminalAssignWorkspace: async (id: string, ws: string | null) => {
      assigned.push([id, ws]);
    },
    onTerminalExit: () => () => {},
  });

  it("defaults dock side to left and width to the default", () => {
    const { get } = makeSlice();
    expect(get().terminalPanelWidth).toBe(TERMINAL_PANEL_WIDTH_DEFAULT);
  });

  it("startTerminal opens a tab in the workspace the backend routed it to", async () => {
    const { get } = makeSlice(
      startingClient(session("a", "/r", { cwd: "/r", workspaceId: "one" })),
    );

    await get().startTerminal("/r", "/r", 80, 24);

    expect(get().terminalTabs).toHaveLength(1);
    expect(get().activeTabId).toBe(get().terminalTabs[0].id);
    // Born routed: the session carries the workspace it belongs to, and that
    // is the only record of it this window keeps.
    expect(get().terminalSessions.a.workspaceId).toBe("one");
  });

  it("startTerminal places the session itself, whoever announced it first", async () => {
    let requested: string | null = null;
    let settle: ((value: unknown) => void) | null = null;
    const answered = new Promise((resolve) => {
      settle = resolve;
    });
    const { get } = makeSlice({
      terminalStart: async (req: { terminalId: string }) => {
        requested = req.terminalId;
        return answered;
      },
      onTerminalExit: () => () => {},
      terminalWrite: async () => {},
    });

    const start = get().startTerminal("/r", "/r", 80, 24);
    await Promise.resolve();
    const id = requested!;

    // The daemon's `started` frame, arriving before the start's own response.
    get().ingestTerminalList([session(id, "/r", { workspaceId: "one" })]);
    expect(get().terminalTabs).toEqual([]);

    settle!({
      session: session(id, "/r", { workspaceId: "one" }),
      workspace: { id: "one", title: "routed", created: false },
    });
    await start;

    // Exactly one tab, and it is the start path's own.
    expect(get().terminalTabs).toHaveLength(1);
    expect(collectLeafIds(get().terminalTabs[0].root)).toEqual([id]);
    expect(get().activeTabId).toBe(get().terminalTabs[0].id);

    // And the claim is released: a later list places it as usual.
    get().removeTerminal(id);
    get().ingestTerminalList([session(id, "/r", { workspaceId: "one" })]);
    expect(get().terminalTabs).toHaveLength(1);
  });

  it("startTerminal re-reads the queue when the router invented a workspace", async () => {
    let loads = 0;
    const { get, set } = makeSlice(
      startingClient(session("a", "/r", { cwd: "/r", workspaceId: "new" }), {
        id: "new",
        title: "r · main",
        created: true,
      }),
    );
    set({
      loadWorkspaces: async () => {
        loads += 1;
        return true;
      },
    });

    await get().startTerminal("/r", "/r", 80, 24);

    // A workspace the queue has never listed is a terminal with nowhere to be
    // drawn, so the list is re-read rather than waited for.
    expect(loads).toBe(1);
  });

  it("attachTerminalToWorkspace moves every session in the tab", async () => {
    const assigned: [string, string | null][] = [];
    const { get, set } = makeSlice(assigningClient(assigned));
    set({
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
      terminalSessions: {
        a: session("a", "/r", { workspaceId: "one" }),
        b: session("b", "/r", { workspaceId: "one" }),
      },
    });

    // Naming one pane moves the tab: panes travel together, and attribution
    // was never a per-pane fact.
    await get().attachTerminalToWorkspace("b", "two");

    expect(assigned).toEqual([
      ["a", "two"],
      ["b", "two"],
    ]);
    expect(get().terminalSessions.a.workspaceId).toBe("two");
    expect(get().terminalSessions.b.workspaceId).toBe("two");
  });

  it("attachTerminalToWorkspace leaves the store alone when the daemon refuses", async () => {
    const { get, set } = makeSlice({
      terminalAssignWorkspace: async () => {
        throw new Error("no such terminal");
      },
    });
    set({
      terminalTabs: [makeTab("tabA", "a")],
      terminalSessions: { a: session("a", "/r", { workspaceId: "one" }) },
    });

    await get().attachTerminalToWorkspace("a", "two");

    // The daemon's copy is the real one; a local write it did not accept would
    // put the row under a card it does not belong to.
    expect(get().terminalSessions.a.workspaceId).toBe("one");
  });

  it("selectWorkspaceTab shows the workspace's most recently used tab", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabs: [
        makeTab("t1", "a"),
        makeTab("t2", "b"),
        makeTab("t3", "c"),
      ],
      terminalSessions: {
        a: session("a", "/r", { workspaceId: "one" }),
        b: session("b", "/r", { workspaceId: "one" }),
        c: session("c", "/r", { workspaceId: "two" }),
      },
    });

    get().setActiveTab("t1");
    get().setActiveTab("t2");
    get().setActiveTab("t3");

    get().selectWorkspaceTab("one");
    expect(get().activeTabId).toBe("t2");
    // The other workspace's tab is still in the strip — selecting never hides
    // one.
    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("selectWorkspaceTab leaves the strip alone for a workspace with no terminals", () => {
    const { get, set } = makeSlice();
    set({ terminalTabs: [makeTab("t1", "a")], activeTabId: "t1" });
    get().selectWorkspaceTab("nobody");
    expect(get().activeTabId).toBe("t1");
  });

  it("movePaneToTab moves the pane into the workspace of the tab it joined", async () => {
    const assigned: [string, string | null][] = [];
    const { get, set } = makeSlice(assigningClient(assigned));
    set({
      terminalTabs: [makeTab("tabA", "a"), makeTab("tabB", "b")],
      terminalSessions: {
        a: session("a", "/r", { workspaceId: "one" }),
        b: session("b", "/r", { workspaceId: "two" }),
      },
    });

    get().movePaneToTab("a", "tabB");
    await Promise.resolve();

    expect(assigned).toEqual([["a", "two"]]);
    expect(get().activeTabId).toBe("tabB");
  });

  it("movePaneToNewTab reassigns nothing — the session took its workspace with it", () => {
    const assigned: [string, string | null][] = [];
    const { get, set } = makeSlice(assigningClient(assigned));
    set({
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
      terminalSessions: {
        a: session("a", "/r", { workspaceId: "one" }),
        b: session("b", "/r", { workspaceId: "one" }),
      },
    });

    const newTabId = get().movePaneToNewTab("b");

    expect(newTabId).not.toBeNull();
    expect(get().activeTabId).toBe(newTabId);
    expect(assigned).toEqual([]);
  });

  /**
   * The tab a split joins decides where it belongs — not the cwd, which may
   * route somewhere else entirely once the tab has been moved.
   *
   * Named at start rather than assigned afterwards: starting first and moving
   * second leaves behind a workspace the router minted for a cwd nothing is
   * running in any more.
   */
  it("splitTerminal names its tab's workspace when it starts the pane", async () => {
    const assigned: [string, string | null][] = [];
    const requests: { workspaceId?: string }[] = [];
    const started = session("b", "/r", { cwd: "/r", workspaceId: "one" });
    const { get, set } = makeSlice({
      terminalStart: async (req: { workspaceId?: string }) => {
        requests.push(req);
        return {
          session: started,
          workspace: { id: "one", title: "r · main", created: false },
        };
      },
      terminalAssignWorkspace: async (id: string, ws: string | null) => {
        assigned.push([id, ws]);
      },
      onTerminalExit: () => () => {},
      terminalWrite: async () => {},
    });
    set({
      terminalSessions: { a: session("a", "/r", { workspaceId: "one" }) },
      terminalTabs: [makeTab("tabA", "a")],
    });

    await get().splitTerminal("tabA", "a", "row");
    await Promise.resolve();

    expect(collectLeafIds(get().terminalTabs[0].root)).toEqual(["a", "b"]);
    expect(requests[0].workspaceId).toBe("one");
    expect(assigned).toEqual([]);
  });

  it("splitTerminal re-reads the queue when the router invented a workspace", async () => {
    let loads = 0;
    const { get, set } = makeSlice(
      startingClient(session("b", "/r", { cwd: "/r", workspaceId: "fresh" }), {
        id: "fresh",
        title: "r · main",
        created: true,
      }),
    );
    set({
      terminalSessions: { a: session("a", "/r", { workspaceId: null }) },
      terminalTabs: [makeTab("tabA", "a")],
      loadWorkspaces: async () => {
        loads += 1;
      },
    });

    await get().splitTerminal("tabA", "a", "row");
    await Promise.resolve();

    expect(loads).toBe(1);
  });

  it("terminalOverview starts off and toggles both ways", () => {
    const { get } = makeSlice();
    expect(get().terminalOverview).toBe(false);
    get().toggleTerminalOverview();
    expect(get().terminalOverview).toBe(true);
    get().toggleTerminalOverview();
    expect(get().terminalOverview).toBe(false);
    get().setTerminalOverview(true);
    expect(get().terminalOverview).toBe(true);
  });

  it("terminalOverview is never persisted", () => {
    const { get, writes } = makeSlice();
    get().toggleTerminalOverview();
    get().setTerminalOverview(false);
    // A look across the work, not a layout: a window that relaunched into the
    // overview would be hiding a workspace nobody asked to leave.
    expect(writes).toEqual({});
  });

  it("hydrateTerminalPrefs restores the persisted layout", async () => {
    const { get, reads } = makeSlice();
    reads.contentFocus = "terminal";
    reads.terminalPanelWidth = 640;
    await get().hydrateTerminalPrefs();
    expect(get().contentFocus).toBe("terminal");
    expect(get().terminalPanelWidth).toBe(640);
  });

  it("hydrateTerminalPrefs upgrades the pre-focus panel mode", async () => {
    const { get, reads } = makeSlice();
    reads.terminalPanelMode = "maximized";
    await get().hydrateTerminalPrefs();
    expect(get().contentFocus).toBe("terminal");
  });

  it("hydrateTerminalPrefs upgrades the pre-mode open/closed boolean", async () => {
    const { get, reads } = makeSlice();
    reads.terminalPanelOpen = true;
    await get().hydrateTerminalPrefs();
    expect(get().contentFocus).toBe("split");
  });

  it("moveTab reorders the strip and no-ops on an unchanged order", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabs: [
        makeTab("tabA", "a"),
        makeTab("tabB", "b"),
        makeTab("tabC", "c"),
      ],
    });

    get().moveTab(2, 0);
    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "tabC",
      "tabA",
      "tabB",
    ]);

    // A drag that ends where it started leaves the array untouched.
    const after = get().terminalTabs;
    get().moveTab(1, 1);
    expect(get().terminalTabs).toBe(after);
  });

  it("setTerminalCheckouts publishes the index", () => {
    const { get } = makeSlice();
    get().setTerminalCheckouts(
      [
        {
          repoPath: "/r",
          repoName: "r",
          defaultBranch: "main",
          branches: [branch("main", { isCurrent: true })],
          recentRemoteBranches: [],
        },
      ],
      [],
    );
    expect(get().terminalCheckouts["/r"].owners).toEqual({ "/r": "/r:main" });
  });

  it("focusing code from a focused terminal reopens as a split", () => {
    const { get, writes } = makeSlice();
    get().toggleTerminalFocus();
    expect(get().contentFocus).toBe("terminal");

    get().toggleTerminalPanel();
    expect(get().contentFocus).toBe("code");
    expect(writes.contentFocus).toBe("code");

    get().toggleTerminalPanel();
    expect(get().contentFocus).toBe("split");
  });

  it("ingestTerminalList takes every repo's sessions into the one strip", () => {
    const { get } = makeSlice();
    get().ingestTerminalList([session("a", "/r"), session("z", "/other")]);
    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "a",
      "z",
    ]);
    expect(Object.keys(get().terminalSessions).sort()).toEqual(["a", "z"]);
  });

  // The daemon's list never carries exited sessions, but the app keeps them —
  // an exited pane stays on screen showing its exit code until the user closes
  // it. Sessions and panes therefore have to leave together.
  it("ingestTerminalList keeps an exited session's tab across a refresh", () => {
    const { get } = makeSlice();
    get().ingestTerminalList([session("a", "/r"), session("b", "/r")]);
    get().applyTerminalExit({ id: "b", exitCode: 1 });

    get().ingestTerminalList([session("a", "/r")]);

    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "a",
      "b",
    ]);
    expect(get().terminalSessions["b"]).toBeDefined();
    expect(get().terminalExited["b"]).toBe(1);
  });

  // A restarted daemon answers the first list with nothing. Wiping the strip
  // while keeping the sessions left the overview drawing cards that jumped
  // nowhere and the needs-you hotkey pointing at no tab.
  it("ingestTerminalList survives a daemon restart answering with []", () => {
    const { get } = makeSlice();
    get().ingestTerminalList([session("a", "/r"), session("b", "/r")]);

    get().ingestTerminalList([]);

    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "a",
      "b",
    ]);
    expect(get().activeTabId).toBe("a");
  });

  // The invariant both of the above rest on, stated directly: nothing outside
  // an explicit close removes a session, and a close removes its pane too.
  it("every session the store holds is reachable from some tab", () => {
    const { get } = makeSlice();
    get().ingestTerminalList([session("a", "/r"), session("b", "/r")]);
    get().applyTerminalExit({ id: "b", exitCode: 0 });
    get().ingestTerminalList([]);

    const placed = new Set(
      get().terminalTabs.flatMap((t: TerminalTab) => collectLeafIds(t.root)),
    );
    for (const id of Object.keys(get().terminalSessions)) {
      expect(placed.has(id)).toBe(true);
    }

    get().removeTerminal("b");
    expect(get().terminalSessions["b"]).toBeUndefined();
    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual(["a"]);
  });
});

describe("ingestTabs", () => {
  it("creates a single-leaf tab for each un-placed session (deterministic id)", () => {
    const next = ingestTabs(emptyTabState(), [
      session("a", "/r"),
      session("b", "/r"),
    ]);
    expect(next.terminalTabs!.map((t) => t.id)).toEqual(["a", "b"]);
    expect(next.terminalTabs!.map((t) => collectLeafIds(t.root))).toEqual([
      ["a"],
      ["b"],
    ]);
    expect(next.activeTabId).toBe("a");
  });

  // The events channel announces a birth to the window that asked for it too,
  // and that frame routinely beats `terminalStart`'s own response back. The
  // start path claims the id before it asks, so the announcement finds it
  // already spoken for — two tabs for one shell is not self-healing, since
  // every later ingest sees both holding a live session and keeps them.
  it("leaves a session this window is placing tab-less", () => {
    const next = ingestTabs(
      emptyTabState(),
      [session("a", "/r")],
      new Set(["a"]),
    );
    expect(next.terminalTabs).toEqual([]);
    expect(next.activeTabId).toBeNull();
  });

  it("does not duplicate a session already placed in a tab", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    // both "a" and "b" already live in tabA; ingesting them adds no new tabs
    const next = ingestTabs(state, [session("a", "/r"), session("b", "/r")]);
    expect(next.terminalTabs!.map((t) => t.id)).toEqual(["tabA"]);
  });

  it("prunes panes whose session is not in the set it is given", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    // "b" is not a known session → collapse tabA to leaf "a"
    const next = ingestTabs(state, [session("a", "/r")]);
    expect(next.terminalTabs).toHaveLength(1);
    expect(next.terminalTabs![0].root).toEqual({
      type: "leaf",
      terminalId: "a",
    });
  });

  it("keeps a still-present active tab", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "tabA") };
    state = { ...state, ...addTabForTerminal(state, "b", "tabB") };
    const next = ingestTabs(state, [session("a", "/r"), session("b", "/r")]);
    expect(next.activeTabId).toBe("tabB");
  });

  // Note the caller never passes an empty set for a live strip — see
  // `ingestTerminalList`, which reconciles against the merged sessions.
  it("drops every tab when it is given no sessions at all", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "z", "tabZ") };
    expect(ingestTabs(state, []).terminalTabs).toEqual([]);
  });
});

describe("checkout attribution", () => {
  // Review-managed worktrees live under ~/.review/worktrees, outside the repo.
  const FEATURE_WT = "/home/.review/worktrees/r/feature";
  const activity: RepoLocalActivity[] = [
    {
      repoPath: "/r",
      repoName: "r",
      defaultBranch: "main",
      branches: [
        branch("main", { isCurrent: true }),
        branch("feature", { worktreePath: FEATURE_WT }),
      ],
      recentRemoteBranches: [],
    },
  ];

  it("buildCheckoutIndex maps each checkout to the row that owns it", () => {
    const index = buildCheckoutIndex(activity);
    expect(index["/r"].owners).toEqual({
      "/r": "/r:main",
      [FEATURE_WT]: "/r:feature",
    });
    expect(index["/r"].roots).toEqual(["/r", FEATURE_WT]);
  });

  it("buildCheckoutIndex includes worktrees owned by non-branch reviews", () => {
    const index = buildCheckoutIndex(activity, [
      {
        repoPath: "/r",
        repoName: "r",
        ref: "pr-7",
        worktreePath: "/home/.review/worktrees/r/pr-7",
        tier: "materialized",
        totalHunks: 0,
        trustedHunks: 0,
        approvedHunks: 0,
        reviewedHunks: 0,
        rejectedHunks: 0,
        savedForLaterHunks: 0,
        state: null,
        updatedAt: "",
      },
    ]);
    expect(index["/r"].owners["/home/.review/worktrees/r/pr-7"]).toBe(
      "/r:pr-7",
    );
  });

  it("isOrphanedSession is true only for a cwd outside every checkout", () => {
    const index = buildCheckoutIndex(activity);
    expect(isOrphanedSession(index, "/r", FEATURE_WT)).toBe(false);
    expect(
      isOrphanedSession(index, "/r", "/home/.review/worktrees/r/removed"),
    ).toBe(true);
    // Unknown repo: an empty index is not evidence of anything.
    expect(isOrphanedSession({}, "/r", "/r/gone")).toBe(false);
  });
});

describe("terminalDockPresent", () => {
  const tab: TerminalTab = { id: "t1", root: leaf("a"), focused: "a" };

  it("keeps the dock wherever a tab is, review or no review", () => {
    expect(
      terminalDockPresent({
        terminalsSupported: true,
        terminalTabs: [tab],
        repoPath: null,
      }),
    ).toBe(true);
  });

  it("keeps it for a repo with no tabs yet — that is what the + is for", () => {
    expect(
      terminalDockPresent({
        terminalsSupported: true,
        terminalTabs: [],
        repoPath: "/r",
      }),
    ).toBe(true);
  });

  it("shows nothing with neither, or with no backend to run a shell", () => {
    expect(
      terminalDockPresent({
        terminalsSupported: true,
        terminalTabs: [],
        repoPath: null,
      }),
    ).toBe(false);
    expect(
      terminalDockPresent({
        terminalsSupported: false,
        terminalTabs: [tab],
        repoPath: "/r",
      }),
    ).toBe(false);
  });
});

describe("tab layout across relaunches", () => {
  /** The layout a window with one split tab and one plain tab would save. */
  const savedLayout = {
    tabs: [
      {
        id: "tab1",
        focused: "b",
        root: {
          type: "split",
          direction: "row",
          children: [leaf("a"), leaf("b")],
          sizes: [0.6, 0.4],
        },
      },
      { id: "tab2", focused: "c", root: leaf("c") },
    ],
    activeTabId: "tab2",
    usedAt: { tab1: 4, tab2: 9 },
  };

  afterEach(() => vi.useRealTimers());

  /** The layout last written to storage. */
  const written = (writes: Record<string, unknown>) =>
    writes[TAB_LAYOUT_KEY] as PersistedTabLayout | undefined;

  /** Its tabs, as stored. */
  const savedTabs = (writes: Record<string, unknown>): TerminalTab[] =>
    (written(writes)?.tabs as TerminalTab[] | undefined) ?? [];

  /** Let the debounced save land. */
  const settle = () => vi.advanceTimersByTime(1_000);

  /** The slice harness on fake timers, primed with `savedLayout` on disk. */

  function relaunched(): any {
    vi.useFakeTimers();
    const slice = makeSlice();
    slice.reads[TAB_LAYOUT_KEY] = savedLayout;
    return slice;
  }

  it("regroups the daemon's sessions into the panes they were in", async () => {
    const { get } = relaunched();

    await get().hydrateTerminalPrefs();
    get().ingestTerminalList([
      session("a", "/r"),
      session("b", "/r"),
      session("c", "/r"),
    ]);

    // Without the restore this is three tabs: the daemon lists sessions, and
    // which of them shared a pane tree is only ever this window's answer.
    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "tab1",
      "tab2",
    ]);
    expect(collectLeafIds(get().terminalTabs[0].root)).toEqual(["a", "b"]);
    expect(get().terminalTabs[0].focused).toBe("b");
    expect(get().activeTabId).toBe("tab2");
  });

  it("restores whichever of the two halves lands second", async () => {
    // The list is a round trip and the layout is an async read, so the order
    // is not ours to pick.
    const { get } = relaunched();

    get().ingestTerminalList([session("a", "/r"), session("b", "/r")]);
    expect(get().terminalTabs).toHaveLength(2);

    await get().hydrateTerminalPrefs();

    expect(get().terminalTabs).toHaveLength(1);
    expect(collectLeafIds(get().terminalTabs[0].root)).toEqual(["a", "b"]);
  });

  it("drops panes whose session died and adopts ones it never saw", async () => {
    const { get } = relaunched();

    await get().hydrateTerminalPrefs();
    // "b" is gone (the shell exited while the app was closed) and "d" is new
    // (the CLI started it meanwhile).
    get().ingestTerminalList([session("a", "/r"), session("d", "/r")]);

    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "tab1",
      "d",
    ]);
    // The split folds back up around the pane that survived.
    expect(get().terminalTabs[0].root).toEqual(leaf("a"));
  });

  it("keeps tab recency, and stays ahead of it", async () => {
    const { get } = relaunched();

    await get().hydrateTerminalPrefs();
    get().ingestTerminalList([session("a", "/r"), session("c", "/r")]);
    expect(get().terminalTabUsedAt).toEqual({ tab1: 4, tab2: 9 });

    get().setActiveTab("tab1");

    // A tab activated now is the latest, not older than one last touched in a
    // previous run.
    expect(get().terminalTabUsedAt.tab1).toBeGreaterThan(9);
  });

  it("saves nothing until the restore has happened", async () => {
    const { get, writes } = relaunched();

    get().ingestTerminalList([session("a", "/r"), session("b", "/r")]);

    // Startup lays every session out as its own tab on the way to being
    // regrouped; saving that would overwrite the layout still being restored.
    settle();
    expect(writes[TAB_LAYOUT_KEY]).toBeUndefined();

    await get().hydrateTerminalPrefs();
    settle();

    expect(savedTabs(writes)).toHaveLength(1);
  });

  it("saves every later move of a pane", async () => {
    const { get, writes } = relaunched();

    await get().hydrateTerminalPrefs();
    get().ingestTerminalList([session("a", "/r"), session("b", "/r")]);
    get().movePaneToNewTab("b");
    settle();

    const tabs = savedTabs(writes);
    expect(tabs).toHaveLength(2);
    expect(written(writes)?.activeTabId).toBe(tabs[1].id);
  });

  it("saves the plain layout of a window that had none stored", async () => {
    vi.useFakeTimers();
    const { get, writes } = makeSlice();

    // Storage answering "nothing stored" settles the restore just as a layout
    // does — otherwise a first run would never save one.
    await get().hydrateTerminalPrefs();
    get().ingestTerminalList([session("a", "/r")]);
    settle();

    expect(savedTabs(writes)).toHaveLength(1);
  });

  it("writes a divider drag once, at where it was let go", async () => {
    const { get, writes } = relaunched();

    await get().hydrateTerminalPrefs();
    get().ingestTerminalList([session("a", "/r"), session("b", "/r")]);
    settle();

    // A drag calls this per frame; the file only wants the last one.
    get().resizeSplit("tab1", [], [0.5, 0.5]);
    get().resizeSplit("tab1", [], [0.8, 0.2]);
    const midDrag = savedTabs(writes)[0].root;
    settle();

    expect(midDrag).toMatchObject({ sizes: [0.6, 0.4] });
    expect(savedTabs(writes)[0].root).toMatchObject({ sizes: [0.8, 0.2] });
  });

  it("restoreTabs ignores a layout that isn't one", () => {
    const state = {
      terminalTabs: [],
      activeTabId: null,
      terminalSessions: { a: session("a", "/r") },
    };
    // A settings file edited by hand, or written by a version that stored
    // something else under this key: the sessions still get their tabs.
    const restored = restoreTabs(state, {
      tabs: "sideways",
      activeTabId: null,
      usedAt: {},
    });
    expect(restored.terminalTabs).toEqual([makeTab("a", "a")]);
  });
});
