import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("../../api", () => ({ getApiClient: () => ({}) }));

import { useReviewStore } from "../../stores";
import {
  terminalSession,
  workspace as makeWorkspace,
} from "../../test/fixtures";
import type { Workspace } from "../../types";
import { jumpToTab, jumpToTerminal } from "./jump";
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
  useReviewStore.setState({
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
  useReviewStore.setState({
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
    useReviewStore.setState({ activeTabId: "tabZ" });

    jumpToTerminal("b");

    const state = useReviewStore.getState();
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

    const state = useReviewStore.getState();
    expect(state.focusedWorkspaceId).toBe("ws-z");
    expect(state.activeTabId).toBe("tabZ");
  });

  it("leaves the focus alone for a tab in the workspace already on screen", () => {
    seed();
    useReviewStore.setState({
      activeTabId: "tabZ",
      focusedWorkspaceId: "ws-a",
    });

    jumpToTerminal("b");

    const state = useReviewStore.getState();
    expect(state.focusedWorkspaceId).toBe("ws-a");
    expect(state.activeTabId).toBe("tabA");
  });

  it("brings the panel into view when the code has focus", () => {
    seed();
    useReviewStore.setState({ contentFocus: "code" });

    jumpToTerminal("a");

    expect(useReviewStore.getState().contentFocus).toBe("split");
  });

  it("jumpToTab lands on the tab's own focused pane", () => {
    seed();
    // The pane the user was last in, which is what the sidebar row stands for.
    jumpToTerminal("b");
    useReviewStore.setState({ activeTabId: "tabZ" });

    jumpToTab("tabA");

    const state = useReviewStore.getState();
    expect(state.activeTabId).toBe("tabA");
    expect(state.terminalTabs[0].focused).toBe("b");
  });

  it("does nothing for a tab that isn't there", () => {
    seed();
    jumpToTab("gone");
    expect(useReviewStore.getState().activeTabId).toBe("tabA");
  });
});
