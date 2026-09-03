import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("../../api", () => ({ getApiClient: () => ({}) }));

import { useSpurStore } from "../../stores";
import {
  terminalSession,
  workspace as makeWorkspace,
} from "../../test/fixtures";
import type { Workspace } from "../../types";
import {
  adjacentTabId,
  jumpToTab,
  jumpToTerminal,
  stepTerminalTab,
} from "./jump";
import { leaf, makeTab, splitLeaf } from "./pane-tree";

const REPO = "/r";

function workspace(id: string): Workspace {
  return makeWorkspace(id, { title: id });
}

/**
 * Two sessions in one split tab, plus one in another repo's own tab — and the
 * two tabs live in *different workspaces*, which is the shape the panel filters
 * on.
 */
function seed(): void {
  const a = terminalSession("a", {
    repoPath: REPO,
    cwd: REPO,
    workspaceId: "ws-a",
  });
  const b = terminalSession("b", {
    repoPath: REPO,
    cwd: REPO,
    workspaceId: "ws-a",
  });
  const z = terminalSession("z", {
    repoPath: "/other",
    cwd: "/other",
    workspaceId: "ws-z",
  });
  useSpurStore.setState({
    repoPath: REPO,
    reviewRef: "main",
    contentFocus: "split",
    workspaces: [workspace("ws-a"), workspace("ws-z")],
    focusedWorkspaceId: "ws-a",
    terminalSessions: { a, b, z },
    terminalStatuses: { a: a.status, b: b.status, z: z.status },
    terminalTabs: [
      { ...makeTab("tabA", "a"), root: splitLeaf(leaf("a"), "a", "b", "row") },
      makeTab("tabZ", "z"),
    ],
    activeTabId: "tabA",
  });
}

afterEach(() => {
  useSpurStore.setState({
    repoPath: null,
    reviewRef: null,
    contentFocus: "code",
    terminalSessions: {},
    terminalStatuses: {},
    terminalTabs: [],
    activeTabId: null,
    workspaces: [],
    focusedWorkspaceId: null,
  });
  vi.clearAllMocks();
});

describe("jumping to a terminal", () => {
  it("activates its tab and focuses the pane within it", () => {
    seed();
    useSpurStore.setState({ activeTabId: "tabZ" });

    jumpToTerminal("b");

    const state = useSpurStore.getState();
    expect(state.activeTabId).toBe("tabA");
    expect(state.terminalTabs[0].focused).toBe("b");
  });

  /**
   * The panel draws only the focused workspace's tabs, so activating a tab
   * from another one used to leave it rendering nothing at all: the active id
   * pointed at a tab the strip had filtered out.
   */
  it("focuses the workspace the tab lives in", () => {
    seed();

    jumpToTerminal("z");

    const state = useSpurStore.getState();
    expect(state.focusedWorkspaceId).toBe("ws-z");
    expect(state.activeTabId).toBe("tabZ");
  });

  it("leaves the focus alone for a tab in the workspace already on screen", () => {
    seed();
    useSpurStore.setState({
      activeTabId: "tabZ",
      focusedWorkspaceId: "ws-a",
    });

    jumpToTerminal("b");

    const state = useSpurStore.getState();
    expect(state.focusedWorkspaceId).toBe("ws-a");
    expect(state.activeTabId).toBe("tabA");
  });

  it("brings the panel into view when the code has focus", () => {
    seed();
    useSpurStore.setState({ contentFocus: "code" });

    jumpToTerminal("a");

    expect(useSpurStore.getState().contentFocus).toBe("split");
  });

  it("jumpToTab lands on the tab's own focused pane", () => {
    seed();
    // The pane the user was last in, which is what the sidebar row stands for.
    jumpToTerminal("b");
    useSpurStore.setState({ activeTabId: "tabZ" });

    jumpToTab("tabA");

    const state = useSpurStore.getState();
    expect(state.activeTabId).toBe("tabA");
    expect(state.terminalTabs[0].focused).toBe("b");
  });

  it("does nothing for a tab that isn't there", () => {
    seed();
    jumpToTab("gone");
    expect(useSpurStore.getState().activeTabId).toBe("tabA");
  });
});

/** A second tab in the *focused* workspace, which is what the strip shows. */
function seedSiblingTab(): void {
  seed();
  const c = terminalSession("c", {
    repoPath: REPO,
    cwd: REPO,
    workspaceId: "ws-a",
  });
  const state = useSpurStore.getState();
  useSpurStore.setState({
    terminalSessions: { ...state.terminalSessions, c },
    terminalStatuses: { ...state.terminalStatuses, c: c.status },
    terminalTabs: [...state.terminalTabs, makeTab("tabC", "c")],
  });
}

describe("stepping along the strip", () => {
  const tabs = [
    makeTab("one", "1"),
    makeTab("two", "2"),
    makeTab("three", "3"),
  ];

  it("wraps at either end, the way Chrome's chord does", () => {
    expect(adjacentTabId(tabs, "one", 1)).toBe("two");
    expect(adjacentTabId(tabs, "three", 1)).toBe("one");
    expect(adjacentTabId(tabs, "one", -1)).toBe("three");
  });

  it("has nowhere to go with fewer than two tabs", () => {
    expect(adjacentTabId(tabs.slice(0, 1), "one", 1)).toBeNull();
    expect(adjacentTabId([], null, 1)).toBeNull();
  });

  it("enters from the end the step comes from when the active tab isn't here", () => {
    expect(adjacentTabId(tabs, "elsewhere", 1)).toBe("one");
    expect(adjacentTabId(tabs, "elsewhere", -1)).toBe("three");
  });

  it("moves to the next tab in the focused workspace", () => {
    seedSiblingTab();

    stepTerminalTab(1);

    expect(useSpurStore.getState().activeTabId).toBe("tabC");
  });

  /**
   * The whole reason this reads the strip rather than `terminalTabs`: tabZ
   * sits between them in the flat list and belongs to another workspace.
   */
  it("never steps into another workspace's tabs", () => {
    seedSiblingTab();
    useSpurStore.setState({ activeTabId: "tabC" });

    stepTerminalTab(1);

    const state = useSpurStore.getState();
    expect(state.activeTabId).toBe("tabA");
    expect(state.focusedWorkspaceId).toBe("ws-a");
  });

  it("does nothing when the workspace has one tab", () => {
    seed();

    stepTerminalTab(1);

    expect(useSpurStore.getState().activeTabId).toBe("tabA");
  });
});
