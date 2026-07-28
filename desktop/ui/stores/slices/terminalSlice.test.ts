import { describe, it, expect } from "vitest";
import {
  applyTerminalStatus,
  applyTerminalExit,
  addTerminalToState,
  removeTerminalFromState,
  ingestTerminalList,
  selectTerminalIdsForReview,
  selectTerminalIdsForRow,
  sessionCheckout,
  terminalSeverity,
  activeFallback,
  addTabForTerminal,
  splitTabForTerminal,
  removeTerminalFromTabs,
  setFocusedInTab,
  resizeSplitInTab,
  ingestTabs,
  createTerminalSlice,
  TERMINAL_PANEL_WIDTH_DEFAULT,
} from "./terminalSlice";
import { collectLeafIds } from "../../components/Terminal/pane-tree";
import type { TerminalTab } from "../../components/Terminal/pane-tree";
import type {
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
      "k1",
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
      "k1",
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
    const next = ingestTerminalList(state, [session("a", "/r")], "k1");
    expect(next.terminalIdsByReviewKey!["k1"]).toEqual(["a"]);
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

describe("selectTerminalIdsForRow", () => {
  const CHECKOUTS = ["/r", "/r/.worktrees/feature"];

  it("gives the repo-root row only the sessions started there", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r", { cwd: "/r" }), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(
        state,
        session("b", "/r", { cwd: "/r/.worktrees/feature" }),
        "k1",
      ),
    };
    // A prefix test would hand the worktree's session to the repo root too;
    // the innermost checkout has to win.
    expect(selectTerminalIdsForRow(state, "/r", "/r", CHECKOUTS)).toEqual([
      "a",
    ]);
  });

  it("scopes to sessions under the row's own worktree", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r", { cwd: "/r" }), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(
        state,
        session("b", "/r", { cwd: "/r/.worktrees/feature" }),
        "k1",
      ),
    };
    expect(
      selectTerminalIdsForRow(state, "/r", "/r/.worktrees/feature", CHECKOUTS),
    ).toEqual(["b"]);
  });

  it("attributes a session started in a subdirectory to its checkout", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(
        state,
        session("a", "/r", { cwd: "/r/.worktrees/feature/src/deep" }),
        "k1",
      ),
    };
    expect(
      selectTerminalIdsForRow(state, "/r", "/r/.worktrees/feature", CHECKOUTS),
    ).toEqual(["a"]);
  });

  it("gives a row with no checkout nothing", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r", { cwd: "/r" }), "k1"),
    };
    expect(selectTerminalIdsForRow(state, "/r", null, CHECKOUTS)).toEqual([]);
  });

  it("excludes sessions from other repos", () => {
    let state = { ...emptyState() };
    state = {
      ...state,
      ...addTerminalToState(state, session("a", "/r", { cwd: "/r" }), "k1"),
    };
    state = {
      ...state,
      ...addTerminalToState(
        state,
        session("b", "/other", { cwd: "/other" }),
        "k2",
      ),
    };
    expect(selectTerminalIdsForRow(state, "/r", "/r", CHECKOUTS)).toEqual([
      "a",
    ]);
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
      ...splitTabForTerminal(state, "k1", "tabA", "a", "b", "row"),
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
      ...splitTabForTerminal(state, "k1", "tabA", "a", "b", "row"),
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
      ...splitTabForTerminal(state, "k1", "tabA", "a", "b", "row"),
    };
    state = { ...state, ...setFocusedInTab(state, "k1", "tabA", "a") };
    expect(state.terminalTabsByReviewKey["k1"][0].focused).toBe("a");
  });

  it("resizeSplitInTab sets the root split's sizes", () => {
    let state = { ...emptyTabState() };
    state = { ...state, ...addTabForTerminal(state, "a", "k1", "tabA") };
    state = {
      ...state,
      ...splitTabForTerminal(state, "k1", "tabA", "a", "b", "row"),
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
  function makeSlice() {
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
    const client = {} as any;
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
  it("creates a single-leaf tab for each un-placed session (deterministic id)", () => {
    const next = ingestTabs(
      emptyTabState(),
      [session("a", "/r"), session("b", "/r")],
      "k1",
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
      ...splitTabForTerminal(state, "k1", "tabA", "a", "b", "row"),
    };
    // both "a" and "b" already live in tabA; ingesting them adds no new tabs
    const next = ingestTabs(
      state,
      [session("a", "/r"), session("b", "/r")],
      "k1",
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
      ...splitTabForTerminal(state, "k1", "tabA", "a", "b", "row"),
    };
    // "b" is gone from the authoritative list → collapse tabA to leaf "a"
    const next = ingestTabs(state, [session("a", "/r")], "k1");
    const tabs = next.terminalTabsByReviewKey!["k1"];
    expect(tabs).toHaveLength(1);
    expect(tabs[0].root).toEqual({ type: "leaf", terminalId: "a" });
  });
});
