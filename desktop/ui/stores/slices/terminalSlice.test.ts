import { describe, it, expect } from "vitest";
import {
  applyTerminalStatus,
  sameTerminalStatus,
  applyTerminalExit,
  addTerminalToState,
  removeTerminalFromState,
  mergeSessionList,
  selectSessionsByHomeKey,
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
  sessionReviewKey,
  isOrphanedSession,
  resolveActiveTabId,
  createTerminalSlice,
  TERMINAL_PANEL_WIDTH_DEFAULT,
  sessionHomeKey,
  reachableKey,
  migrateTabAttachments,
  mostRecentTabId,
  selectTabsByItemId,
  selectUnattachedTabIds,
  tabSessionIds,
  itemHome,
  terminalDockPresent,
} from "./terminalSlice";
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

describe("selectSessionsByHomeKey", () => {
  // A repo on `main` at its root, with `feature` in a linked worktree and
  // `idle` checked out nowhere.
  const INDEX = buildCheckoutIndex([
    {
      repoPath: "/r",
      repoName: "r",
      defaultBranch: "main",
      branches: [
        branch("main", { isCurrent: true }),
        branch("feature", { worktreePath: "/r/.worktrees/feature" }),
        branch("idle"),
      ],
      recentRemoteBranches: [],
    },
  ]);

  function grouped(state: TestState): Record<string, string[]> {
    return selectSessionsByHomeKey({
      terminalSessions: state.terminalSessions,
      terminalCheckouts: INDEX,
    });
  }

  function withSessions(...sessions: TerminalSessionInfo[]): TestState {
    let state = { ...emptyState() };
    for (const s of sessions) {
      state = { ...state, ...addTerminalToState(state, s) };
    }
    return state;
  }

  it("splits sessions between the rows that own their directories", () => {
    const state = withSessions(
      session("a", "/r", { cwd: "/r" }),
      session("b", "/r", { cwd: "/r/.worktrees/feature" }),
    );
    // A prefix test would hand the worktree's session to the repo root too;
    // the innermost checkout has to win.
    expect(grouped(state)).toEqual({ "/r:main": ["a"], "/r:feature": ["b"] });
  });

  it("attributes a session started in a subdirectory to its checkout", () => {
    const state = withSessions(
      session("a", "/r", { cwd: "/r/.worktrees/feature/src/deep" }),
    );
    expect(grouped(state)["/r:feature"]).toEqual(["a"]);
  });

  it("gives a row with no checkout nothing to show", () => {
    const state = withSessions(session("a", "/r", { cwd: "/r" }));
    expect(grouped(state)["/r:idle"]).toBeUndefined();
  });

  it("keeps each repo's sessions under its own keys", () => {
    const state = withSessions(
      session("a", "/r", { cwd: "/r" }),
      session("b", "/other", { cwd: "/other" }),
    );
    expect(grouped(state)["/r:main"]).toEqual(["a"]);
    expect(grouped(state)["/other:"]).toEqual(["b"]);
  });
});

describe("sessionHomeKey", () => {
  // Built rather than hand-written, so the shape can't drift from the builder.
  const index = buildCheckoutIndex([
    {
      repoPath: "/r",
      repoName: "r",
      defaultBranch: "main",
      branches: [
        branch("main", { isCurrent: true }),
        branch("feature", { worktreePath: "/wt/feature" }),
      ],
      recentRemoteBranches: [],
    },
    {
      repoPath: "/other",
      repoName: "other",
      defaultBranch: "dev",
      branches: [branch("dev", { isCurrent: true })],
      recentRemoteBranches: [],
    },
  ]);

  it("places a session by the checkout its directory falls in", () => {
    expect(
      sessionHomeKey(index, session("a", "/r", { cwd: "/wt/feature" }), ""),
    ).toBe("/r:feature");
  });

  it("adopts a session whose checkout is gone into the repo root", () => {
    expect(
      sessionHomeKey(index, session("a", "/r", { cwd: "/gone" }), ""),
    ).toBe("/r:main");
  });

  it("leaves a key alone for a repo nothing is known about", () => {
    // An empty index is not evidence the row went away.
    expect(reachableKey({}, "/other", "/other:branch")).toBe("/other:branch");
  });
});

describe("work item attachments", () => {
  const items = [
    {
      id: "one",
      title: "",
      refs: [{ repoPath: "/r", ref: "feature" }],
      createdAt: "",
    },
    { id: "two", title: "A note", refs: [], createdAt: "" },
  ];

  it("converts a legacy review-key attachment onto the item that bound that ref", () => {
    // The row a terminal was dragged onto, and the item that has since taken
    // that ref, are the same work — so the attachment carries over.
    expect(migrateTabAttachments({ a: "/r:feature" }, [], items)).toEqual({
      a: "item:one",
    });
  });

  it("drops a legacy attachment no item claims", () => {
    // Unattached is a state the band can show; an attachment pointing at
    // nothing is not.
    expect(migrateTabAttachments({ a: "/r:other" }, [], items)).toEqual({});
  });

  it("keeps attachments to items that still exist, drops the rest", () => {
    expect(
      migrateTabAttachments({ a: "item:two", b: "item:gone" }, [], items),
    ).toEqual({ a: "item:two" });
  });

  it("is idempotent, so it can run whenever the item list changes", () => {
    const once = migrateTabAttachments({ a: "/r:feature" }, [], items);
    expect(migrateTabAttachments(once, [], items)).toEqual(once);
  });

  it("gives a tab whose panes disagree its first answer, under every key", () => {
    // Only reachable from the session-keyed map older installs wrote, where
    // each pane carried an attachment of its own.
    const tab = {
      ...makeTab("a", "a"),
      root: splitLeaf(leaf("a"), "a", "b", "row"),
    };
    expect(
      migrateTabAttachments({ b: "item:two", a: "item:one" }, [tab], items),
    ).toEqual({ a: "item:one", b: "item:one" });
  });

  it("clears every key of a tab whose attachment no item claims", () => {
    const tab = {
      ...makeTab("a", "a"),
      root: splitLeaf(leaf("a"), "a", "b", "row"),
    };
    expect(
      migrateTabAttachments({ a: "item:gone", b: "item:gone" }, [tab], items),
    ).toEqual({});
  });

  it("groups tabs by the item holding them", () => {
    const state = {
      terminalTabs: [
        makeTab("t1", "a"),
        makeTab("t2", "b"),
        makeTab("t3", "c"),
      ],
      terminalAttachments: { t1: itemHome("one"), t2: itemHome("one") },
    };
    expect(selectTabsByItemId(state)).toEqual({ one: ["t1", "t2"] });
    // t3 has no attachment at all, and one naming a removed item counts as
    // none — otherwise its terminal would be attached to nothing and shown
    // nowhere.
    expect(selectUnattachedTabIds(state, new Set(["one"]))).toEqual(["t3"]);
    expect(selectUnattachedTabIds(state, new Set())).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
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

describe("resolveActiveTabId", () => {
  it("keeps the current tab when it is still there", () => {
    expect(resolveActiveTabId([makeTab("a", "a")], "a")).toBe("a");
  });
  it("re-picks the first when the remembered tab is gone", () => {
    expect(resolveActiveTabId([makeTab("b", "b")], "a")).toBe("b");
  });
  it("nulls when there are no tabs left", () => {
    expect(resolveActiveTabId([], "a")).toBeNull();
  });
});

interface TabTestState {
  terminalTabs: TerminalTab[];
  activeTabId: string | null;
}

function emptyTabState(): TabTestState {
  return { terminalTabs: [], activeTabId: null };
}

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

describe("slice actions", () => {
  // Minimal harness: drive the real slice actions with an in-memory store and a
  // stub storage that records writes, so we can assert persistence.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function makeSlice(client: any = {}) {
    const writes: Record<string, unknown> = {};
    const reads: Record<string, unknown> = {};
    const storage = {
      get: async (key: string) => reads[key],
      set: (key: string, value: unknown) => {
        writes[key] = value;
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let state: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const set = (partial: any) => {
      state = {
        ...state,
        ...(typeof partial === "function" ? partial(state) : partial),
      };
    };
    const get = () => state;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    state = createTerminalSlice(client, storage)(set, get, {} as any);
    return { get, set, writes, reads };
  }

  const startingClient = (started: TerminalSessionInfo) => ({
    terminalStart: async () => started,
    onTerminalStatus: () => () => {},
    onTerminalExit: () => () => {},
    terminalWrite: async () => {},
  });

  it("defaults dock side to left and width to the default", () => {
    const { get } = makeSlice();
    expect(get().terminalDockSide).toBe("left");
    expect(get().terminalPanelWidth).toBe(TERMINAL_PANEL_WIDTH_DEFAULT);
  });

  it("startTerminal opens a tab attached to nothing", async () => {
    const { get } = makeSlice(
      startingClient(session("a", "/r", { cwd: "/r" })),
    );

    await get().startTerminal("/r", "/r", 80, 24);

    expect(get().terminalTabs).toHaveLength(1);
    expect(get().activeTabId).toBe(get().terminalTabs[0].id);
    // A new shell is one more live thing until the user says what it's for —
    // the "Unclaimed terminals" band is where it shows up meanwhile.
    expect(get().terminalAttachments).toEqual({});
  });

  it("attachTerminalToItem records the tab and every session in it", () => {
    const { get, set, writes } = makeSlice();
    set({
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
    });

    get().attachTerminalToItem("b", "one");

    // Keyed by tab, and written under each session too: a reload rebuilds one
    // tab per session, taking the session's id as the tab id, and each of those
    // fragments has to find the attachment its old tab had.
    expect(get().terminalAttachments).toEqual({
      tabA: "item:one",
      a: "item:one",
      b: "item:one",
    });
    expect(writes.terminalAttachments).toEqual(get().terminalAttachments);

    get().detachTerminal("a");
    expect(get().terminalAttachments).toEqual({});
  });

  it("selectItemTab shows the item's most recently used tab", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabs: [
        makeTab("t1", "a"),
        makeTab("t2", "b"),
        makeTab("t3", "c"),
      ],
      terminalAttachments: { t1: itemHome("one"), t2: itemHome("one") },
    });

    get().setActiveTab("t1");
    get().setActiveTab("t2");
    get().setActiveTab("t3");

    get().selectItemTab("one");
    expect(get().activeTabId).toBe("t2");
    // The other item's tab is still in the strip — selecting never hides one.
    expect(get().terminalTabs.map((t: TerminalTab) => t.id)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("selectItemTab leaves the strip alone for an item with no terminals", () => {
    const { get, set } = makeSlice();
    set({ terminalTabs: [makeTab("t1", "a")], activeTabId: "t1" });
    get().selectItemTab("nobody");
    expect(get().activeTabId).toBe("t1");
  });

  it("movePaneToTab hands the pane the attachment of the tab it joined", async () => {
    const { get, set } = makeSlice();
    set({
      terminalTabs: [makeTab("tabA", "a"), makeTab("tabB", "b")],
      terminalAttachments: { tabB: itemHome("one"), b: itemHome("one") },
    });

    get().movePaneToTab("a", "tabB");

    expect(get().terminalAttachments).toEqual({
      tabB: "item:one",
      a: "item:one",
      b: "item:one",
    });
    expect(get().activeTabId).toBe("tabB");
  });

  it("movePaneToTab drops an attachment the pane arrived with", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabs: [makeTab("tabA", "a"), makeTab("tabB", "b")],
      terminalAttachments: { tabA: itemHome("one"), a: itemHome("one") },
    });

    // tabB is unclaimed, and a pane belongs to the tab it is in. tabA was that
    // pane's only one, so the move emptied it — and a key naming a tab no
    // window will ever have again would sit in storage forever.
    get().movePaneToTab("a", "tabB");

    expect(get().terminalAttachments).toEqual({});
  });

  it("movePaneToNewTab carries the old tab's attachment onto the new one", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
      terminalAttachments: {
        tabA: itemHome("one"),
        a: itemHome("one"),
        b: itemHome("one"),
      },
    });

    const newTabId = get().movePaneToNewTab("b");

    expect(newTabId).not.toBeNull();
    expect(get().terminalAttachments[newTabId!]).toBe("item:one");
    expect(get().activeTabId).toBe(newTabId);
  });

  it("splitTerminal gives the new pane its tab's attachment", async () => {
    const { get, set } = makeSlice(
      startingClient(session("b", "/r", { cwd: "/r" })),
    );
    set({
      terminalSessions: { a: session("a", "/r", { cwd: "/r" }) },
      terminalTabs: [makeTab("tabA", "a")],
      terminalAttachments: { tabA: itemHome("one"), a: itemHome("one") },
    });

    await get().splitTerminal("tabA", "a", "row");

    expect(collectLeafIds(get().terminalTabs[0].root)).toEqual(["a", "b"]);
    expect(get().terminalAttachments.b).toBe("item:one");
  });

  it("removeTerminal prunes the dead session's attachment, tab key included", () => {
    const { get, set, writes } = makeSlice();
    set({
      terminalTabs: [makeTab("tabA", "a")],
      terminalAttachments: {
        tabA: "item:one",
        a: "item:one",
        b: "item:two",
      },
    });

    get().removeTerminal("a");

    // The tab is gone with its last pane, and its id is window-local — an
    // entry under it would outlive every window that could ever read it.
    expect(get().terminalAttachments).toEqual({ b: "item:two" });
    expect(writes.terminalAttachments).toEqual({ b: "item:two" });
  });

  it("removeTerminal keeps the tab's attachment while other panes remain", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
      terminalAttachments: {
        tabA: "item:one",
        a: "item:one",
        b: "item:one",
      },
    });

    get().removeTerminal("a");

    expect(get().terminalAttachments).toEqual({
      tabA: "item:one",
      b: "item:one",
    });
  });

  it("migrateTerminalAttachments writes only when something changed", () => {
    const { get, set, writes } = makeSlice();
    set({
      terminalTabs: [makeTab("t1", "a")],
      terminalAttachments: { t1: itemHome("one"), a: itemHome("one") },
    });
    const items = [{ id: "one", title: "", refs: [], createdAt: "" }];

    get().migrateTerminalAttachments(items);
    expect(writes.terminalAttachments).toBeUndefined();

    get().migrateTerminalAttachments([]);
    expect(get().terminalAttachments).toEqual({});
    expect(writes.terminalAttachments).toEqual({});
  });

  it("hydrateTerminalPrefs restores the persisted attachments", async () => {
    const { get, reads } = makeSlice();
    reads.terminalAttachments = { a: "item:one" };
    await get().hydrateTerminalPrefs();
    expect(get().terminalAttachments).toEqual({ a: "item:one" });
  });

  it("hydrateTerminalPrefs reads the pre-tab session-keyed attachments", async () => {
    // A tab rebuilt from a session takes that session's id, so the old map is
    // already a valid attachments map.
    const { get, reads } = makeSlice();
    reads.terminalHomes = { a: "item:one" };
    await get().hydrateTerminalPrefs();
    expect(get().terminalAttachments).toEqual({ a: "item:one" });
  });

  it("toggleTerminalDockSide flips the side and persists it", () => {
    const { get, writes } = makeSlice();
    get().toggleTerminalDockSide();
    expect(get().terminalDockSide).toBe("right");
    expect(writes.terminalDockSide).toBe("right");
    get().toggleTerminalDockSide();
    expect(get().terminalDockSide).toBe("left");
    expect(writes.terminalDockSide).toBe("left");
  });

  it("setTerminalDockSide sets and persists the given side", () => {
    const { get, writes } = makeSlice();
    get().setTerminalDockSide("right");
    expect(get().terminalDockSide).toBe("right");
    expect(writes.terminalDockSide).toBe("right");
  });

  it("hydrateTerminalPrefs restores the persisted dock side", async () => {
    const { get, reads } = makeSlice();
    reads.terminalDockSide = "right";
    reads.contentFocus = "terminal";
    reads.terminalPanelWidth = 640;
    await get().hydrateTerminalPrefs();
    expect(get().terminalDockSide).toBe("right");
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
    expect(get().terminalCheckouts["/r"].rootKey).toBe("/r:main");
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
    expect(index["/r"].rootKey).toBe("/r:main");
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

  it("sessionReviewKey attributes a cwd to its innermost checkout", () => {
    const index = buildCheckoutIndex(activity);
    expect(sessionReviewKey(index, "/r", `${FEATURE_WT}/src`, "x")).toBe(
      "/r:feature",
    );
    expect(sessionReviewKey(index, "/r", "/r/src", "x")).toBe("/r:main");
  });

  it("sessionReviewKey adopts an orphan into the repo's root row", () => {
    const index = buildCheckoutIndex(activity);
    // The worktree was removed; the shell is still running in a gone directory.
    expect(
      sessionReviewKey(index, "/r", "/home/.review/worktrees/r/removed", "x"),
    ).toBe("/r:main");
  });

  it("anchors a detached HEAD on a row that exists, not on an unreachable key", () => {
    // Detached HEAD: git names no branch as checked out, so nothing owns the
    // repo root. `/r:` is a key no view reads, so anything attributed there
    // would be listed under a row that isn't drawn.
    const detached = buildCheckoutIndex([
      {
        repoPath: "/r",
        repoName: "r",
        defaultBranch: "main",
        branches: [branch("feature", { worktreePath: FEATURE_WT })],
        recentRemoteBranches: [],
      },
    ]);
    expect(detached["/r"].rootKey).toBe("/r:feature");
    // Both the orphan and a shell sitting in the detached main working tree
    // land somewhere the sidebar has a row for.
    expect(sessionReviewKey(detached, "/r", "/gone/elsewhere", "x")).toBe(
      "/r:feature",
    );
    expect(sessionReviewKey(detached, "/r", "/r/src", "x")).toBe("/r:feature");
  });

  it("anchors a detached HEAD on a review's worktree when there are no branches", () => {
    const index = buildCheckoutIndex(
      [
        {
          repoPath: "/r",
          repoName: "r",
          defaultBranch: "main",
          branches: [],
          recentRemoteBranches: [],
        },
      ],
      [
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
      ],
    );
    expect(index["/r"].rootKey).toBe("/r:pr-7");
  });

  it("keeps the placeholder key for a repo with no checkouts at all", () => {
    // No rows to be reachable from either.
    const index = buildCheckoutIndex([
      {
        repoPath: "/r",
        repoName: "r",
        defaultBranch: "main",
        branches: [],
        recentRemoteBranches: [],
      },
    ]);
    expect(index["/r"].rootKey).toBe("/r:");
  });

  it("sessionReviewKey falls back for a repo the index has never seen", () => {
    expect(sessionReviewKey({}, "/r", "/r", "fallback")).toBe("fallback");
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
