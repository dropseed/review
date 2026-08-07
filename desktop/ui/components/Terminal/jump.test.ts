import { vi, describe, it, expect, afterEach } from "vitest";

vi.mock("../../api", () => ({ getApiClient: () => ({}) }));

const { error } = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error } }));

import { useReviewStore } from "../../stores";
import { buildCheckoutIndex } from "../../stores/slices/terminalSlice";
import { terminalSession } from "../../test/fixtures";
import { jumpToTerminal } from "./jump";
import { makeTab } from "./pane-tree";

const REPO = "/r";

/** A repo whose only row is `main`, checked out at the repo root. */
function checkoutsWithMainOnly() {
  return buildCheckoutIndex(
    [
      {
        repoPath: REPO,
        repoName: "r",
        defaultBranch: "main",
        branches: [
          {
            name: "main",
            isCurrent: true,
            commitsAhead: 0,
            hasWorkingTreeChanges: false,
            lastCommitDate: "",
            lastCommitMessage: "",
            lastCommitByUser: false,
            worktreePath: null,
            lastModifiedAt: null,
            workingTreeStats: null,
          },
        ],
        recentRemoteBranches: [],
      },
    ],
    [],
  );
}

/** Viewing `main`, with one session whose own worktree row is gone. */
function seedOrphan(tabs: Record<string, ReturnType<typeof makeTab>[]>): void {
  const session = terminalSession("a", { repoPath: REPO, cwd: "/wt/feature" });
  useReviewStore.setState({
    repoPath: REPO,
    reviewRef: "main",
    terminalPanelMode: "split",
    terminalSessions: { a: session },
    terminalStatuses: { a: session.status },
    terminalHomes: { a: `${REPO}:feature` },
    terminalCheckouts: checkoutsWithMainOnly(),
    terminalTabsByReviewKey: tabs,
    activeTabIdByReviewKey: {},
    terminalIdsByReviewKey: {},
  });
}

afterEach(() => {
  useReviewStore.setState({
    repoPath: null,
    reviewRef: null,
    terminalSessions: {},
    terminalStatuses: {},
    terminalHomes: {},
    terminalCheckouts: {},
    terminalTabsByReviewKey: {},
    activeTabIdByReviewKey: {},
    terminalIdsByReviewKey: {},
  });
  vi.clearAllMocks();
});

describe("jumping to a terminal whose row is gone", () => {
  it("moves its stranded tab into the strip the sidebar draws it in", () => {
    // The tab still sits in the deleted worktree's bucket, which no view reads.
    seedOrphan({ [`${REPO}:feature`]: [makeTab("tabA", "a")] });

    jumpToTerminal("a");

    const state = useReviewStore.getState();
    expect(
      state.terminalTabsByReviewKey[`${REPO}:main`].map((t) => t.id),
    ).toEqual(["tabA"]);
    expect(state.activeTabIdByReviewKey[`${REPO}:main`]).toBe("tabA");
    expect(error).not.toHaveBeenCalled();
  });

  it("gives it a tab when this window has none for it", () => {
    seedOrphan({});

    jumpToTerminal("a");

    const state = useReviewStore.getState();
    expect(
      state.terminalTabsByReviewKey[`${REPO}:main`].map((t) => t.id),
    ).toEqual(["a"]);
    expect(state.activeTabIdByReviewKey[`${REPO}:main`]).toBe("a");
  });

  it("says so when the session's row can't be resolved at all", () => {
    // Another repo, nothing known about its checkouts — the home key is the
    // `repoPath:""` placeholder, which names no row to switch to.
    const session = terminalSession("a", {
      repoPath: "/other",
      cwd: "/other",
    });
    useReviewStore.setState({
      repoPath: REPO,
      reviewRef: "main",
      terminalPanelMode: "split",
      terminalSessions: { a: session },
      terminalStatuses: { a: session.status },
      terminalCheckouts: checkoutsWithMainOnly(),
    });

    jumpToTerminal("a");

    // Silence here is the dead click this whole path exists to avoid.
    expect(error).toHaveBeenCalled();
  });
});
