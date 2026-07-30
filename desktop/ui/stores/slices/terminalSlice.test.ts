import { describe, it, expect } from "vitest";
import {
  applyTerminalStatus,
  applyTerminalExit,
  addTerminalToState,
  removeTerminalFromState,
  ingestTerminalList,
  selectTerminalIdsForReview,
  selectSessionsByHomeKey,
  selectLiveSessionsByReviewKey,
  sessionCheckout,
  terminalSeverity,
  activeFallback,
  addTabForTerminal,
  splitTabForTerminal,
  removeTerminalFromTabs,
  setFocusedInTab,
  resizeSplitInTab,
  ingestTabs,
  buildCheckoutIndex,
  sessionReviewKey,
  isOrphanedSession,
  rehomeTabs,
  mergeVisibleTabs,
  reorderVisibleTabs,
  resolveActiveTabIds,
  createTerminalSlice,
  TERMINAL_PANEL_WIDTH_DEFAULT,
  sessionHomeKey,
  reachableKey,
  moveTabToKey,
  moveTerminalsToKey,
} from "./terminalSlice";
import { collectLeafIds, makeTab } from "../../components/Terminal/pane-tree";
import type { TerminalTab } from "../../components/Terminal/pane-tree";
import type {
  LocalBranchInfo,
  RepoLocalActivity,
  TerminalSessionInfo,
  TerminalStatus,
  TerminalPhase,
} from "../../types";

function status(
  id: string,
  phase: TerminalPhase = "idle",
  overrides: Partial<TerminalStatus> = {},
): TerminalStatus {
  return {
    id,
    phase,
    runningCommand: null,
    lastExitCode: null,
    cwd: null,
    title: null,
    enteredStateAt: 0,
    shellIntegrationActive: false,
    ...overrides,
  };
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
  terminalIdsByReviewKey: Record<string, string[]>;
  activeTerminalIdByReviewKey: Record<string, string | null>;
  freshTerminalIds: string[];
}

function emptyState(): TestState {
  return {
    terminalSessions: {},
    terminalStatuses: {},
    terminalExited: {},
    terminalIdsByReviewKey: {},
    activeTerminalIdByReviewKey: {},
    freshTerminalIds: [],
  };
}

describe("terminalSlice reducers", () => {
  it("applyTerminalStatus records the status by id", () => {
    const next = applyTerminalStatus(emptyState(), status("a", "working"));
    expect(next.terminalStatuses).toEqual({ a: status("a", "working") });
  });

  it("addTerminalToState groups by review key and makes the new one active", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/r"), "k1"),
    };

    expect(state.terminalIdsByReviewKey["k1"]).toEqual(["a", "b"]);
    expect(state.activeTerminalIdByReviewKey["k1"]).toBe("b");
    expect(state.terminalSessions["a"].repoPath).toBe("/r");
    expect(state.terminalStatuses["b"]).toBeDefined();
    expect(state.freshTerminalIds).toEqual(["a", "b"]);
  });

  it("keeps separate buckets per review key", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/r"), "k2"),
    };
    expect(state.terminalIdsByReviewKey["k1"]).toEqual(["a"]);
    expect(state.terminalIdsByReviewKey["k2"]).toEqual(["b"]);
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

  it("removeTerminalFromState falls the active id back to a survivor", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/r"), "k1"),
    };
    // active is "b"; removing it falls back to "a"
    state = { ...state, ...removeTerminalFromState(state, "b") };
    expect(state.terminalIdsByReviewKey["k1"]).toEqual(["a"]);
    expect(state.activeTerminalIdByReviewKey["k1"]).toBe("a");
    expect(state.terminalSessions["b"]).toBeUndefined();
  });

  it("removeTerminalFromState nulls the active id when the bucket empties", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = { ...state, ...removeTerminalFromState(state, "a") };
    expect(state.terminalIdsByReviewKey["k1"]).toEqual([]);
    expect(state.activeTerminalIdByReviewKey["k1"]).toBeNull();
  });

  it("ingestTerminalList rebuilds the bucket and session maps", () => {
    const state = emptyState();
    const next = ingestTerminalList(
      state,
      [session("a", "/r"), session("b", "/r")],
      "/r",
      () => "k1",
    );
    expect(next.terminalIdsByReviewKey!["k1"]).toEqual(["a", "b"]);
    expect(Object.keys(next.terminalSessions!)).toEqual(["a", "b"]);
    expect(next.activeTerminalIdByReviewKey!["k1"]).toBe("a");
  });

  it("ingestTerminalList preserves a still-present active id", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/r"), "k1"),
    };
    // active is "b"; re-ingesting both should keep "b" active, not reset to "a"
    const next = ingestTerminalList(
      state,
      [session("a", "/r"), session("b", "/r")],
      "/r",
      () => "k1",
    );
    expect(next.activeTerminalIdByReviewKey!["k1"]).toBe("b");
  });

  it("ingestTerminalList prunes sessions the list dropped from the bucket", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/r"), "k1"),
    };
    const next = ingestTerminalList(
      state,
      [session("a", "/r")],
      "/r",
      () => "k1",
    );
    expect(next.terminalIdsByReviewKey!["k1"]).toEqual(["a"]);
  });

  it("ingestTerminalList re-places a session whose bucket changed", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "stale"),
    };
    const next = ingestTerminalList(
      state,
      [session("a", "/r")],
      "/r",
      () => "owner",
    );
    expect(next.terminalIdsByReviewKey!["stale"]).toEqual([]);
    expect(next.terminalIdsByReviewKey!["owner"]).toEqual(["a"]);
  });

  it("ingestTerminalList leaves another repo's sessions in place", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("other", "/elsewhere"), "k2"),
    };
    const next = ingestTerminalList(state, [], "/r", () => "k1");
    expect(next.terminalIdsByReviewKey!["k2"]).toEqual(["other"]);
  });
});

describe("selectTerminalIdsForReview", () => {
  it("returns sessions for the repo in bucket order", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/r"), "k1"),
    };
    const ids = selectTerminalIdsForReview(state, "/r", "k1");
    expect(ids).toEqual(["a", "b"]);
  });

  it("includes matching sessions grouped under another key (reattach)", () => {
    let state = { ...emptyState() };
    // Session grouped under a stale key but same repoPath still surfaces.
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "old-key"),
    };
    const ids = selectTerminalIdsForReview(state, "/r", "current-key");
    expect(ids).toEqual(["a"]);
  });

  it("excludes sessions from other repos", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/other"), "k2"),
    };
    expect(selectTerminalIdsForReview(state, "/r", "k1")).toEqual(["a"]);
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

  function grouped(
    state: TestState,
    homes: Record<string, string> = {},
  ): Record<string, string[]> {
    return selectSessionsByHomeKey({
      terminalSessions: state.terminalSessions,
      terminalCheckouts: INDEX,
      terminalHomes: homes,
    });
  }

  function withSessions(...sessions: TerminalSessionInfo[]): TestState {
    let state = { ...emptyState() };
    for (const s of sessions) {
      state = { ...state, ...addTerminalToState(state, s, "k1") };
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

  it("counts a homed session on the row it was dropped on, not its directory", () => {
    const state = withSessions(
      session("a", "/r", { cwd: "/r/.worktrees/feature" }),
    );
    // The shell stays in the worktree; the badge has to follow the tab or the
    // two disagree about where the terminal is.
    expect(grouped(state, { a: "/r:main" })).toEqual({ "/r:main": ["a"] });
  });

  it("shows a homed session on a row with no checkout of its own", () => {
    const state = withSessions(session("a", "/r", { cwd: "/r" }));
    expect(grouped(state, { a: "/r:idle" })["/r:idle"]).toEqual(["a"]);
  });

  it("keeps each repo's sessions under its own keys", () => {
    const state = withSessions(
      session("a", "/r", { cwd: "/r" }),
      session("b", "/other", { cwd: "/other" }),
    );
    expect(grouped(state)["/r:main"]).toEqual(["a"]);
    expect(grouped(state)["/other:"]).toEqual(["b"]);
  });

  it("keeps an exited session on its row, unlike the live-only grouping", () => {
    const state = withSessions(session("a", "/r", { cwd: "/r" }));
    expect(grouped(state)["/r:main"]).toEqual(["a"]);
    expect(
      selectLiveSessionsByReviewKey({
        terminalSessions: state.terminalSessions,
        terminalExited: { a: 0 },
        terminalCheckouts: INDEX,
        terminalHomes: {},
      }),
    ).toEqual({});
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
  ]);

  it("prefers a stored home over the session's directory", () => {
    expect(
      sessionHomeKey(
        index,
        { a: "/r:main" },
        session("a", "/r", { cwd: "/wt/feature" }),
        "",
      ),
    ).toBe("/r:main");
  });

  it("falls back to the cwd's checkout for a session it has never seen", () => {
    expect(
      sessionHomeKey(index, {}, session("a", "/r", { cwd: "/wt/feature" }), ""),
    ).toBe("/r:feature");
  });

  it("rescues a stored home whose row is gone to the repo root", () => {
    expect(
      sessionHomeKey(index, { a: "/r:deleted" }, session("a", "/r"), ""),
    ).toBe("/r:main");
  });

  it("leaves a home alone for a repo nothing is known about", () => {
    // An empty index is not evidence the row went away.
    expect(reachableKey({}, "/other", "/other:branch")).toBe("/other:branch");
  });
});

describe("moveTabToKey / moveTerminalsToKey", () => {
  it("moves the tab and makes it the target's active tab", () => {
    const state = {
      terminalTabsByReviewKey: {
        A: [makeTab("tabA", "a"), makeTab("tabB", "b")],
        B: [],
      },
      activeTabIdByReviewKey: { A: "tabA", B: null },
    };
    const next = moveTabToKey(state, "tabA", "B");
    expect(next.terminalTabsByReviewKey!.A.map((t) => t.id)).toEqual(["tabB"]);
    expect(next.terminalTabsByReviewKey!.B.map((t) => t.id)).toEqual(["tabA"]);
    expect(next.activeTabIdByReviewKey!.B).toBe("tabA");
    // The bucket it left re-picks rather than pointing at a tab it lost.
    expect(next.activeTabIdByReviewKey!.A).toBe("tabB");
  });

  it("does nothing for a tab already in the target bucket", () => {
    const state = {
      terminalTabsByReviewKey: { A: [makeTab("tabA", "a")] },
      activeTabIdByReviewKey: { A: "tabA" },
    };
    expect(moveTabToKey(state, "tabA", "A")).toEqual({});
  });

  it("moves the sessions between flat buckets too", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r"), "A"),
    };
    state = {
      ...state,
      ...addTerminalToState(state, session("b", "/r"), "A"),
    };
    const next = moveTerminalsToKey(state, ["a"], "B");
    expect(next.terminalIdsByReviewKey!.A).toEqual(["b"]);
    expect(next.terminalIdsByReviewKey!.B).toEqual(["a"]);
    expect(next.activeTerminalIdByReviewKey!.A).toBe("b");
    expect(next.activeTerminalIdByReviewKey!.B).toBe("a");
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

describe("activeFallback", () => {
  it("keeps the current id when still present", () => {
    expect(activeFallback(["a", "b"], "b")).toBe("b");
  });
  it("falls back to the first id when current is gone", () => {
    expect(activeFallback(["a", "b"], "z")).toBe("a");
  });
  it("returns null for an empty list", () => {
    expect(activeFallback([], "a")).toBeNull();
  });
});

interface TabTestState {
  terminalTabsByReviewKey: Record<string, TerminalTab[]>;
  activeTabIdByReviewKey: Record<string, string | null>;
}

function emptyTabState(): TabTestState {
  return { terminalTabsByReviewKey: {}, activeTabIdByReviewKey: {} };
}

describe("tab reducers", () => {
  it("addTabForTerminal appends a single-leaf tab and makes it active", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = { ...state, ...addTabForTerminal(state, "b", "k1", "tabB") };
    const tabs = state.terminalTabsByReviewKey["k1"];
    expect(tabs.map((t) => t.id)).toEqual(["tabA", "tabB"]);
    expect(tabs[0].root).toEqual({ type: "leaf", terminalId: "a" });
    expect(state.activeTabIdByReviewKey["k1"]).toBe("tabB");
  });

  it("splitTabForTerminal splits the target leaf and focuses the new one", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    const tab = state.terminalTabsByReviewKey["k1"][0];
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

  it("removeTerminalFromTabs collapses a split and re-picks focus", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    // focused is "b"; removing it collapses to leaf "a" and re-focuses "a"
    state = { ...state, ...removeTerminalFromTabs(state, "b") };
    const tab = state.terminalTabsByReviewKey["k1"][0];
    expect(tab.root).toEqual({ type: "leaf", terminalId: "a" });
    expect(tab.focused).toBe("a");
  });

  it("removeTerminalFromTabs drops the tab and re-picks active when last pane closes", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = { ...state, ...addTabForTerminal(state, "b", "k1", "tabB") };
    // active is tabB; closing its only pane drops the tab, active → tabA
    state = { ...state, ...removeTerminalFromTabs(state, "b") };
    expect(state.terminalTabsByReviewKey["k1"].map((t) => t.id)).toEqual([
      "tabA",
    ]);
    expect(state.activeTabIdByReviewKey["k1"]).toBe("tabA");
  });

  it("setFocusedInTab updates the focused leaf", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = { ...state, ...setFocusedInTab(state, "k1", "tabA", "a") };
    expect(state.terminalTabsByReviewKey["k1"][0].focused).toBe("a");
  });

  it("resizeSplitInTab sets the root split's sizes", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    state = {
      ...state,
      ...resizeSplitInTab(state, "k1", "tabA", [], [0.7, 0.3]),
    };
    const root = state.terminalTabsByReviewKey["k1"][0].root;
    if (root.type !== "split") throw new Error("expected split");
    expect(root.sizes).toEqual([0.7, 0.3]);
  });
});

describe("panel preferences (dock side + width persistence)", () => {
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

  it("defaults dock side to left and width to the default", () => {
    const { get } = makeSlice();
    expect(get().terminalDockSide).toBe("left");
    expect(get().terminalPanelWidth).toBe(TERMINAL_PANEL_WIDTH_DEFAULT);
  });

  it("toggleTabPinned flips the flag and persists the tab's terminal ids", () => {
    const { get, set, writes } = makeSlice();
    set({ terminalTabsByReviewKey: { home: [makeTab("tabA", "a")] } });

    get().toggleTabPinned("tabA");
    expect(get().terminalTabsByReviewKey.home[0].pinned).toBe(true);
    // Persisted by session id, which is what survives a reload.
    expect(writes.terminalPinnedIds).toEqual(["a"]);

    get().toggleTabPinned("tabA");
    expect(get().terminalTabsByReviewKey.home[0].pinned).toBe(false);
    expect(writes.terminalPinnedIds).toEqual([]);
  });

  it("unpinning a visiting tab re-points the viewing key at a tab it can see", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabsByReviewKey: {
        A: [{ ...makeTab("tabA", "a"), pinned: true }],
        B: [makeTab("tabB", "b")],
      },
      // Viewing B and looking at A's pinned tab, which visits every key.
      activeTabIdByReviewKey: { A: "tabA", B: "tabA" },
      terminalPinnedIds: ["a"],
    });

    get().toggleTabPinned("tabA");

    // B can no longer see tabA, so leaving it aimed there would render no
    // active tab at all — a blank panel with every tab body hidden.
    expect(get().activeTabIdByReviewKey.B).toBe("tabB");
    expect(get().activeTabIdByReviewKey.A).toBe("tabA");
  });

  it("unpinning nulls a viewing key that has no tabs of its own", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabsByReviewKey: {
        A: [{ ...makeTab("tabA", "a"), pinned: true }],
        B: [],
      },
      activeTabIdByReviewKey: { B: "tabA" },
      terminalPinnedIds: ["a"],
    });
    get().toggleTabPinned("tabA");
    expect(get().activeTabIdByReviewKey.B).toBeNull();
  });

  it("killTerminal prunes the closed session from the persisted pinned ids", async () => {
    const { get, set, writes } = makeSlice({
      terminalKill: async () => undefined,
    });
    set({
      terminalTabsByReviewKey: { k1: [{ ...makeTab("a", "a"), pinned: true }] },
      terminalPinnedIds: ["a", "b"],
    });

    await get().killTerminal("a");

    // The session is gone for good — its pin must not outlive it in the store.
    expect(get().terminalPinnedIds).toEqual(["b"]);
    expect(writes.terminalPinnedIds).toEqual(["b"]);
  });

  it("removeTerminal prunes the dead session from the persisted pinned ids", () => {
    const { get, set, writes } = makeSlice();
    set({
      terminalTabsByReviewKey: { k1: [{ ...makeTab("a", "a"), pinned: true }] },
      terminalPinnedIds: ["a"],
    });

    get().removeTerminal("a");

    expect(get().terminalPinnedIds).toEqual([]);
    expect(writes.terminalPinnedIds).toEqual([]);
  });

  it("teardown of an unpinned session doesn't rewrite the pinned ids", () => {
    const { get, set, writes } = makeSlice();
    set({
      terminalTabsByReviewKey: { k1: [makeTab("a", "a")] },
      terminalPinnedIds: ["b"],
    });
    get().removeTerminal("a");
    expect(get().terminalPinnedIds).toEqual(["b"]);
    expect(writes.terminalPinnedIds).toBeUndefined();
  });

  it("pinning leaves the tab in its home bucket", () => {
    const { get, set } = makeSlice();
    set({ terminalTabsByReviewKey: { home: [makeTab("tabA", "a")] } });
    get().toggleTabPinned("tabA");
    expect(Object.keys(get().terminalTabsByReviewKey)).toEqual(["home"]);
  });

  it("hydrateTerminalPrefs restores the persisted pinned ids", async () => {
    const { get, reads } = makeSlice();
    reads.terminalPinnedIds = ["a"];
    await get().hydrateTerminalPrefs();
    expect(get().terminalPinnedIds).toEqual(["a"]);
  });

  it("setTerminalCheckouts adopts a tab whose worktree disappeared", () => {
    const { get, set } = makeSlice();
    const cwd = "/home/.review/worktrees/r/feature";
    set({
      terminalSessions: { a: session("a", "/r", { cwd }) },
      terminalTabsByReviewKey: { "/r:feature": [makeTab("tabA", "a")] },
    });
    // Listing no longer has the feature worktree.
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
    expect(
      get().terminalTabsByReviewKey["/r:main"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabA"]);
    expect(get().terminalTabsByReviewKey["/r:feature"]).toEqual([]);
  });

  /** The listing for a repo whose main working tree is on `current`. */
  function activityOn(current: string, others: string[] = []) {
    return [
      {
        repoPath: "/r",
        repoName: "r",
        defaultBranch: "main",
        branches: [
          branch(current, { isCurrent: true }),
          ...others.map((name) => branch(name)),
        ],
        recentRemoteBranches: [],
      },
    ];
  }

  it("startTerminal records where the session started", async () => {
    const started = session("a", "/r", { cwd: "/r" });
    const { get } = makeSlice({
      terminalStart: async () => started,
      onTerminalStatus: () => () => {},
      onTerminalExit: () => () => {},
      terminalWrite: async () => {},
    });
    get().setTerminalCheckouts(activityOn("main"), []);

    await get().startTerminal("/r:main", "/r", "/r", 80, 24);

    expect(get().terminalHomes.a).toBe("/r:main");
  });

  it("a checkout in the main working tree leaves its terminals where they are", () => {
    const { get, set } = makeSlice();
    set({
      terminalSessions: { a: session("a", "/r", { cwd: "/r" }) },
      terminalTabsByReviewKey: { "/r:main": [makeTab("tabA", "a")] },
      terminalHomes: { a: "/r:main" },
    });

    // `git checkout feature` in the repo root: the row owning that directory
    // is now feature's. The shell is genuinely on feature now, but it was
    // opened as a main terminal and nobody asked for it to move.
    get().setTerminalCheckouts(activityOn("feature", ["main"]), []);

    expect(
      get().terminalTabsByReviewKey["/r:main"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabA"]);
    expect(get().terminalTabsByReviewKey["/r:feature"] ?? []).toEqual([]);
  });

  it("shows a tab whose row is gone at the repo root, without forgetting its home", () => {
    const { get, set } = makeSlice();
    set({
      terminalSessions: {
        a: session("a", "/r", { cwd: "/wt/feature" }),
      },
      terminalTabsByReviewKey: { "/r:feature": [makeTab("tabA", "a")] },
      terminalHomes: { a: "/r:feature" },
    });

    // The feature row is gone — a bucket no view reads, so the tab would
    // vanish while its shell kept running.
    get().setTerminalCheckouts(activityOn("main"), []);
    expect(
      get().terminalTabsByReviewKey["/r:main"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabA"]);
    // Rendered elsewhere, not re-homed: the stored answer is still feature.
    expect(get().terminalHomes.a).toBe("/r:feature");

    // ...so it goes home when the row comes back.
    get().setTerminalCheckouts(activityOn("main", ["feature"]), []);
    expect(
      get().terminalTabsByReviewKey["/r:feature"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabA"]);
  });

  it("setTabHome moves the tab, its sessions, and the persisted home", () => {
    const { get, set, writes } = makeSlice();
    set({
      terminalSessions: { a: session("a", "/r", { cwd: "/r" }) },
      terminalTabsByReviewKey: { "/r:main": [makeTab("tabA", "a")] },
      terminalIdsByReviewKey: { "/r:main": ["a"] },
      activeTerminalIdByReviewKey: { "/r:main": "a" },
      activeTabIdByReviewKey: { "/r:main": "tabA" },
      terminalHomes: { a: "/r:main" },
    });

    get().setTabHome("tabA", "/r:feature");

    expect(get().terminalHomes.a).toBe("/r:feature");
    expect(writes.terminalHomes).toEqual({ a: "/r:feature" });
    expect(
      get().terminalTabsByReviewKey["/r:feature"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabA"]);
    expect(get().terminalTabsByReviewKey["/r:main"]).toEqual([]);
    expect(get().terminalIdsByReviewKey["/r:feature"]).toEqual(["a"]);
    expect(get().terminalIdsByReviewKey["/r:main"]).toEqual([]);
    // The row you dropped it on shows it when you get there.
    expect(get().activeTabIdByReviewKey["/r:feature"]).toBe("tabA");
  });

  it("a re-homed tab survives the next checkout listing", () => {
    const { get, set } = makeSlice();
    set({
      terminalSessions: {
        a: session("a", "/r", { cwd: "/wt/feature" }),
      },
      terminalTabsByReviewKey: { "/r:feature": [makeTab("tabA", "a")] },
      terminalHomes: { a: "/r:feature" },
    });

    get().setTabHome("tabA", "/r:main");
    get().setTerminalCheckouts(
      [
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
      ],
      [],
    );

    // Its cwd still says feature; the drag says main, and the drag wins.
    expect(
      get().terminalTabsByReviewKey["/r:main"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabA"]);
  });

  it("removeTerminal prunes the dead session's persisted home", () => {
    const { get, set, writes } = makeSlice();
    set({
      terminalTabsByReviewKey: { "/r:main": [makeTab("a", "a")] },
      terminalHomes: { a: "/r:main", b: "/r:other" },
    });

    get().removeTerminal("a");

    expect(get().terminalHomes).toEqual({ b: "/r:other" });
    expect(writes.terminalHomes).toEqual({ b: "/r:other" });
  });

  it("hydrateTerminalPrefs restores the persisted homes", async () => {
    const { get, reads } = makeSlice();
    reads.terminalHomes = { a: "/r:feature" };
    await get().hydrateTerminalPrefs();
    expect(get().terminalHomes).toEqual({ a: "/r:feature" });
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
    reads.terminalPanelMode = "maximized";
    reads.terminalPanelWidth = 640;
    await get().hydrateTerminalPrefs();
    expect(get().terminalDockSide).toBe("right");
    expect(get().terminalPanelMode).toBe("maximized");
    expect(get().terminalPanelWidth).toBe(640);
  });

  it("hydrateTerminalPrefs upgrades the pre-mode open/closed boolean", async () => {
    const { get, reads } = makeSlice();
    reads.terminalPanelOpen = true;
    await get().hydrateTerminalPrefs();
    expect(get().terminalPanelMode).toBe("split");
  });

  it("moveTab reorders a review's tabs and no-ops on an unchanged order", () => {
    const { get, set } = makeSlice();
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = { ...state, ...addTabForTerminal(state, "b", "k1", "tabB") };
    state = { ...state, ...addTabForTerminal(state, "c", "k1", "tabC") };
    set({ terminalTabsByReviewKey: state.terminalTabsByReviewKey });

    const before = get().terminalTabsByReviewKey;
    get().moveTab("k1", 2, 0);
    expect(
      get().terminalTabsByReviewKey["k1"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabC", "tabA", "tabB"]);

    // A drag that ends where it started leaves the map object untouched.
    const after = get().terminalTabsByReviewKey;
    expect(after).not.toBe(before);
    get().moveTab("k1", 1, 1);
    expect(get().terminalTabsByReviewKey).toBe(after);
  });

  it("moveTab refuses a drag across the pinned boundary instead of scrambling", () => {
    const { get, set } = makeSlice();
    // Renders as [B, A, C] — pinned first — so dragging A onto B is a move the
    // strip's own sort would immediately undo.
    set({
      terminalTabsByReviewKey: {
        k1: [
          makeTab("tabA", "a"),
          { ...makeTab("tabB", "b"), pinned: true },
          makeTab("tabC", "c"),
        ],
      },
    });
    const before = get().terminalTabsByReviewKey;

    get().moveTab("k1", 1, 0);

    // Nothing appeared to move, so nothing may have been written — the old
    // mapping quietly reordered the bucket to [B, A, C], visible only later
    // when B was unpinned.
    expect(get().terminalTabsByReviewKey).toBe(before);
  });

  it("moveTab moves a tab past a pinned neighbour without moving the neighbour", () => {
    const { get, set } = makeSlice();
    set({
      terminalTabsByReviewKey: {
        k1: [
          makeTab("tabA", "a"),
          { ...makeTab("tabB", "b"), pinned: true },
          makeTab("tabC", "c"),
        ],
      },
    });

    // Strip is [B, A, C]; drag A onto C.
    get().moveTab("k1", 1, 2);

    // A and C swap the slots they held; B keeps its own.
    expect(
      get().terminalTabsByReviewKey["k1"].map((t: TerminalTab) => t.id),
    ).toEqual(["tabC", "tabB", "tabA"]);
    expect(
      mergeVisibleTabs(get().terminalTabsByReviewKey, "k1").map(
        (v) => v.tab.id,
      ),
    ).toEqual(["tabB", "tabC", "tabA"]);
  });

  it("hiding a maximized panel reopens as a split, not over the diff", () => {
    const { get, writes } = makeSlice();
    get().toggleTerminalPanelMaximized();
    expect(get().terminalPanelMode).toBe("maximized");

    get().toggleTerminalPanel();
    expect(get().terminalPanelMode).toBe("closed");
    expect(writes.terminalPanelMode).toBe("closed");

    get().toggleTerminalPanel();
    expect(get().terminalPanelMode).toBe("split");
  });
});

describe("ingestTabs", () => {
  /** `known` map for the sessions a case declares. */
  function knownOf(
    sessions: TerminalSessionInfo[],
  ): Record<string, TerminalSessionInfo> {
    return Object.fromEntries(sessions.map((s) => [s.id, s]));
  }

  const unpinned = () => false;

  it("creates a single-leaf tab for each un-placed session (deterministic id)", () => {
    const sessions = [session("a", "/r"), session("b", "/r")];
    const next = ingestTabs(
      emptyTabState(),
      sessions,
      knownOf(sessions),
      "/r",
      () => "k1",
      unpinned,
    );
    const tabs = next.terminalTabsByReviewKey!["k1"];
    expect(tabs.map((t) => t.id)).toEqual(["a", "b"]);
    expect(tabs.map((t) => collectLeafIds(t.root))).toEqual([["a"], ["b"]]);
    expect(next.activeTabIdByReviewKey!["k1"]).toBe("a");
  });

  it("does not duplicate a session already placed in a tab", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    // both "a" and "b" already live in tabA; ingesting them adds no new tabs
    const sessions = [session("a", "/r"), session("b", "/r")];
    const next = ingestTabs(
      state,
      sessions,
      knownOf(sessions),
      "/r",
      () => "k1",
      unpinned,
    );
    expect(next.terminalTabsByReviewKey!["k1"].map((t) => t.id)).toEqual([
      "tabA",
    ]);
  });

  it("prunes leaves whose session vanished from the list", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "tabA", "a", "b", "row"),
    };
    // "b" is gone from the authoritative list → collapse tabA to leaf "a"
    const gone = [session("a", "/r"), session("b", "/r")];
    const next = ingestTabs(
      state,
      [session("a", "/r")],
      knownOf(gone),
      "/r",
      () => "k1",
      unpinned,
    );
    const tabs = next.terminalTabsByReviewKey!["k1"];
    expect(tabs).toHaveLength(1);
    expect(tabs[0].root).toEqual({ type: "leaf", terminalId: "a" });
  });

  it("re-homes a restored tab to the bucket its cwd belongs to", () => {
    let state = { ...emptyTabState() };
    // Created while a different row was selected — the bug this fixes.
    state = { ...state, ...addTabForTerminal(state, "a", "selected", "tabA") };
    const sessions = [
      session("a", "/r", { cwd: "/home/.review/worktrees/r/feature" }),
    ];
    const next = ingestTabs(
      state,
      sessions,
      knownOf(sessions),
      "/r",
      () => "owner",
      unpinned,
    );
    expect(next.terminalTabsByReviewKey!["selected"]).toEqual([]);
    expect(next.terminalTabsByReviewKey!["owner"].map((t) => t.id)).toEqual([
      "tabA",
    ]);
  });

  it("restores a tab's pinned flag from the persisted terminal ids", () => {
    const sessions = [session("a", "/r")];
    const next = ingestTabs(
      emptyTabState(),
      sessions,
      knownOf(sessions),
      "/r",
      () => "k1",
      (id) => id === "a",
    );
    expect(next.terminalTabsByReviewKey!["k1"][0].pinned).toBe(true);
  });

  it("leaves another repo's tabs untouched", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "z", "k2", "tabZ") };
    const other = [session("z", "/elsewhere")];
    const next = ingestTabs(
      state,
      [],
      knownOf(other),
      "/r",
      () => "k1",
      unpinned,
    );
    expect(next.terminalTabsByReviewKey!["k2"].map((t) => t.id)).toEqual([
      "tabZ",
    ]);
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

  it("sessionReviewKey adopts an orphan into the repo's root bucket", () => {
    const index = buildCheckoutIndex(activity);
    // The worktree was removed; the shell is still running in a gone directory.
    expect(
      sessionReviewKey(index, "/r", "/home/.review/worktrees/r/removed", "x"),
    ).toBe("/r:main");
  });

  it("anchors a detached HEAD on a row that exists, not on an unreachable key", () => {
    // Detached HEAD: git names no branch as checked out, so nothing owns the
    // repo root. `/r:` is a bucket no routed view ever reads, so anything
    // adopted into it would disappear while its PTY kept running.
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
    // No rows to be reachable from either — the repo-level view reads this key.
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

  it("rehomeTabs moves an orphaned tab to the root bucket", () => {
    let state = { ...emptyTabState() };
    state = {
      ...state,
      ...addTabForTerminal(state, "a", "/r:feature", "tabA"),
    };
    const sessions = {
      a: session("a", "/r", { cwd: "/home/.review/worktrees/r/feature" }),
    };
    // The feature worktree is gone from the listing.
    const index = buildCheckoutIndex([
      {
        repoPath: "/r",
        repoName: "r",
        defaultBranch: "main",
        branches: [branch("main", { isCurrent: true })],
        recentRemoteBranches: [],
      },
    ]);
    const next = rehomeTabs(state, sessions, (s) =>
      sessionReviewKey(index, s.repoPath, s.cwd, ""),
    );
    expect(next.terminalTabsByReviewKey!["/r:feature"]).toEqual([]);
    expect(next.terminalTabsByReviewKey!["/r:main"].map((t) => t.id)).toEqual([
      "tabA",
    ]);
    expect(next.activeTabIdByReviewKey!["/r:main"]).toBe("tabA");
  });

  it("rehomeTabs is a no-op when nothing moved", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "/r:main", "tabA") };
    const sessions = { a: session("a", "/r", { cwd: "/r" }) };
    expect(rehomeTabs(state, sessions, () => "/r:main")).toEqual({});
  });
});

describe("mergeVisibleTabs", () => {
  function pinnedTab(id: string, terminalId: string): TerminalTab {
    return { ...makeTab(id, terminalId), pinned: true };
  }

  it("shows the current key's tabs plus every pinned tab, pinned first", () => {
    const tabsByKey = {
      k1: [makeTab("own", "a")],
      k2: [pinnedTab("far", "b"), makeTab("hidden", "c")],
    };
    expect(mergeVisibleTabs(tabsByKey, "k1")).toEqual([
      { tab: tabsByKey.k2[0], reviewKey: "k2" },
      { tab: tabsByKey.k1[0], reviewKey: "k1" },
    ]);
  });

  it("does not show a pinned tab twice in its own bucket", () => {
    const tabsByKey = { k1: [pinnedTab("own", "a")] };
    const visible = mergeVisibleTabs(tabsByKey, "k1");
    expect(visible.map((v) => v.tab.id)).toEqual(["own"]);
    expect(visible[0].reviewKey).toBe("k1");
  });

  it("keeps a pinned tab's home key so unpinning is lossless", () => {
    const tabsByKey = { home: [pinnedTab("t", "a")] };
    expect(mergeVisibleTabs(tabsByKey, "elsewhere")[0].reviewKey).toBe("home");
  });
});

describe("reorderVisibleTabs", () => {
  const pin = (tab: TerminalTab): TerminalTab => ({ ...tab, pinned: true });

  it("rejects a drag between tabs living in different buckets", () => {
    const tabsByKey = {
      k1: [makeTab("own", "a")],
      k2: [pin(makeTab("far", "b"))],
    };
    // Strip for k1 is [far, own]; the two have no shared order to write.
    expect(reorderVisibleTabs(tabsByKey, "k1", 1, 0)).toEqual({});
  });

  it("rejects a drag that skips past a tab on the other side of the boundary", () => {
    const tabsByKey = {
      k1: [makeTab("a", "a"), pin(makeTab("b", "b")), makeTab("c", "c")],
    };
    // Strip [b, a, c]: dragging c to the front passes over pinned b.
    expect(reorderVisibleTabs(tabsByKey, "k1", 2, 0)).toEqual({});
  });

  it("is a no-op for a drag that ends where it started", () => {
    const tabsByKey = { k1: [makeTab("a", "a"), makeTab("b", "b")] };
    expect(reorderVisibleTabs(tabsByKey, "k1", 1, 1)).toEqual({});
  });

  it("reorders a pinned visitor within its own bucket", () => {
    const tabsByKey = {
      home: [pin(makeTab("p1", "a")), pin(makeTab("p2", "b"))],
      viewing: [makeTab("local", "c")],
    };
    // Strip for "viewing" is [p1, p2, local]; both pinned tabs are home's.
    const next = reorderVisibleTabs(tabsByKey, "viewing", 0, 1);
    expect(next.terminalTabsByReviewKey!.home.map((t) => t.id)).toEqual([
      "p2",
      "p1",
    ]);
    // The bucket being viewed is untouched.
    expect(next.terminalTabsByReviewKey!.viewing).toBe(tabsByKey.viewing);
  });
});

describe("resolveActiveTabIds", () => {
  it("keeps a key pointed at a pinned tab that lives elsewhere", () => {
    const tabsByKey = {
      home: [{ ...makeTab("t", "a"), pinned: true }],
      other: [],
    };
    const next = resolveActiveTabIds(tabsByKey, { other: "t" });
    expect(next.other).toBe("t");
  });

  it("re-picks when the remembered tab is gone", () => {
    const next = resolveActiveTabIds({ k1: [makeTab("b", "b")] }, { k1: "a" });
    expect(next.k1).toBe("b");
  });

  it("nulls a key whose bucket emptied", () => {
    expect(resolveActiveTabIds({ k1: [] }, { k1: "a" }).k1).toBeNull();
  });
});
