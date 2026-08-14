import { describe, it, expect } from "vitest";
import { getSidebarTree, type SidebarTreeState } from "./sidebar";
import type {
  RepoLocalActivity,
  ViewerPr,
  ViewerPrSnapshot,
} from "../../types";

const NOW = Date.UTC(2026, 0, 20);

function repo(): RepoLocalActivity {
  return {
    repoPath: "/r",
    repoName: "r",
    defaultBranch: "main",
    branches: [
      {
        name: "master",
        isCurrent: true,
        commitsAhead: 0,
        unpushedCommits: 0,
        behindUpstream: 0,
        hasWorkingTreeChanges: false,
        lastCommitDate: new Date(NOW).toISOString(),
        lastCommitMessage: "wip",
        lastCommitByUser: false,
        worktreePath: null,
        lastModifiedAt: null,
        workingTreeStats: null,
      },
    ],
    recentRemoteBranches: [],
  };
}

function viewerPr(): ViewerPr {
  return {
    number: 7,
    title: "Add the thing",
    url: "https://github.com/o/r/pull/7",
    isDraft: false,
    updatedAt: new Date(NOW).toISOString(),
    headRefName: "master",
    baseRefName: "main",
    repoNameWithOwner: "o/r",
    repoUrl: "https://github.com/o/r",
    headRepoNameWithOwner: "o/r",
    reviewDecision: null,
    checksState: null,
    repoPath: "/r",
  };
}

function state(viewerPrs: ViewerPrSnapshot | null): SidebarTreeState {
  return {
    localActivity: [repo()],
    globalReviews: [],
    globalReviewsByKey: {},
    viewerPrs,
  };
}

function snapshot(overrides: Partial<ViewerPrSnapshot> = {}): ViewerPrSnapshot {
  return {
    fetchedAt: new Date(NOW).toISOString(),
    prs: [viewerPr()],
    truncated: false,
    error: null,
    shipped: [],
    available: true,
    ...overrides,
  };
}

describe("getSidebarTree and an unavailable GitHub", () => {
  it("badges the head row while gh is working", () => {
    const [node] = getSidebarTree(state(snapshot()));
    expect(node.head?.openPr?.number).toBe(7);
  });

  it("drops PRs the backend only kept from cache once gh is gone", () => {
    // The backend answers a logged-out `gh` with the *previous* PRs plus
    // `available: false` — so this snapshot is well-formed and populated, and
    // still must not paint anything. The sidebar shows no warning in this
    // state by design, which is exactly why the data can't leak through: it
    // would be stale forever with nothing on screen admitting it.
    const [node] = getSidebarTree(
      state(snapshot({ available: false, error: "gh not authenticated" })),
    );
    expect(node.head?.openPr).toBeUndefined();
  });

  it("still shows PRs when a query merely failed", () => {
    // A failed or timed-out query leaves `available` true, and that snapshot
    // does carry its last good PRs — those stay, because the sidebar pairs
    // them with a visible warning.
    const [node] = getSidebarTree(
      state(snapshot({ error: "query timed out" })),
    );
    expect(node.head?.openPr?.number).toBe(7);
  });
});
