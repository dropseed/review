import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("../../api", () => ({ getApiClient: () => ({}) }));

import { useReviewStore } from "../../stores";
import { terminalSession } from "../../test/fixtures";
import { jumpToTab, jumpToTerminal } from "./jump";
import { leaf, makeTab, splitLeaf } from "./pane-tree";

const REPO = "/r";

/** Two sessions in one split tab, plus one in another repo's own tab. */
function seed(): void {
  const a = terminalSession("a", { repoPath: REPO, cwd: REPO });
  const b = terminalSession("b", { repoPath: REPO, cwd: REPO });
  const z = terminalSession("z", { repoPath: "/other", cwd: "/other" });
  useReviewStore.setState({
    repoPath: REPO,
    reviewRef: "main",
    terminalPanelMode: "split",
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
    terminalPanelMode: "closed",
    terminalOverviewOpen: false,
    terminalSessions: {},
    terminalStatuses: {},
    terminalTabs: [],
    activeTabId: null,
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

  it("shows another repo's terminal without changing what is being reviewed", () => {
    // One strip holds every tab, so there is no review to switch to first.
    seed();

    jumpToTerminal("z");

    const state = useReviewStore.getState();
    expect(state.activeTabId).toBe("tabZ");
    expect(state.repoPath).toBe(REPO);
    expect(state.reviewRef).toBe("main");
  });

  it("opens the panel and leaves the overview", () => {
    seed();
    useReviewStore.setState({
      terminalPanelMode: "closed",
      terminalOverviewOpen: true,
    });

    jumpToTerminal("a");

    const state = useReviewStore.getState();
    expect(state.terminalPanelMode).toBe("split");
    expect(state.terminalOverviewOpen).toBe(false);
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
