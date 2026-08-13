import { describe, it, expect } from "vitest";
import { describeWorkItem, type WorkContext } from "./work-status";
import { buildSidebarTree, allSidebarRows } from "../../utils/sidebar-tree";
import { makeReviewKey } from "../../utils/review-key";
import type {
  GlobalReviewSummary,
  LocalBranchInfo,
  RepoLocalActivity,
  ViewerPr,
  WorkItem,
} from "../../types";

const NOW = Date.UTC(2026, 0, 15);
const REPO = "/repo";

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
    lastCommitDate: new Date(NOW).toISOString(),
    lastCommitMessage: "x",
    lastCommitByUser: false,
    worktreePath: null,
    lastModifiedAt: null,
    workingTreeStats: null,
    ...overrides,
  };
}

function activity(branches: LocalBranchInfo[]): RepoLocalActivity[] {
  return [
    {
      repoPath: REPO,
      repoName: "repo",
      defaultBranch: "main",
      branches,
      recentRemoteBranches: [],
    },
  ];
}

function pr(overrides: Partial<ViewerPr> = {}): ViewerPr {
  return {
    number: 12,
    title: "A change",
    url: "https://github.com/o/repo/pull/12",
    repoNameWithOwner: "o/repo",
    repoUrl: "https://github.com/o/repo",
    repoPath: REPO,
    headRefName: "feature",
    baseRefName: "main",
    isDraft: false,
    reviewDecision: null,
    checksState: null,
    updatedAt: new Date(NOW).toISOString(),
    ...overrides,
  } as ViewerPr;
}

/** A context built from the real tree, so the join can't drift from the rows. */
function context(
  branches: LocalBranchInfo[],
  prs: ViewerPr[] = [],
  reviews: Record<string, GlobalReviewSummary> = {},
): WorkContext {
  const tree = buildSidebarTree(
    activity(branches),
    Object.values(reviews),
    reviews,
    prs,
  );
  return {
    rows: new Map(allSidebarRows(tree).map((row) => [row.reviewKey, row])),
    repoNames: new Map([[REPO, "repo"]]),
    knownRepos: new Set([REPO]),
    reviews,
  };
}

function item(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: "one",
    title: "",
    refs: [{ repoPath: REPO, ref: "feature" }],
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

describe("describeWorkItem", () => {
  it("titles a bound card with its branch when the user gave it no title", () => {
    const status = describeWorkItem(
      item(),
      context([branch("main", { isCurrent: true }), branch("feature")]),
    );
    expect(status.title).toBe("feature");
    expect(status.repos).toEqual(["repo"]);
    expect(status.resolved).toBe(false);
  });

  it("keeps the user's title when there is one", () => {
    const status = describeWorkItem(
      item({ title: "Ship the thing" }),
      context([branch("feature")]),
    );
    expect(status.title).toBe("Ship the thing");
  });

  it("resolves a card whose every branch is gone", () => {
    const status = describeWorkItem(item(), context([branch("main")]));
    expect(status.resolved).toBe(true);
    expect(status.phrase).toBe("branch gone");
  });

  it("does not resolve a ref in a repo nothing is known about", () => {
    // An unregistered repo has no rows because nothing looked, which is not
    // the same as a branch that was deleted.
    const ctx = context([branch("main")]);
    ctx.knownRepos.delete(REPO);
    expect(describeWorkItem(item(), ctx).resolved).toBe(false);
  });

  it("leads with the PR that wants something over one that doesn't", () => {
    const status = describeWorkItem(
      item({
        refs: [
          { repoPath: REPO, ref: "quiet" },
          { repoPath: REPO, ref: "feature" },
        ],
      }),
      context(
        [branch("quiet"), branch("feature")],
        [
          pr({ number: 9, headRefName: "quiet" }),
          pr({ number: 12, reviewDecision: "CHANGES_REQUESTED" }),
        ],
      ),
    );
    expect(status.openPr?.number).toBe(12);
    expect(status.phrase).toContain("#12 changes requested");
  });

  it("says uncommitted changes, and stops at two clauses", () => {
    const status = describeWorkItem(
      item(),
      context(
        [branch("feature", { hasWorkingTreeChanges: true })],
        [pr({ checksState: "FAILURE" })],
        {
          [makeReviewKey(REPO, "feature")]: {
            repoPath: REPO,
            repoName: "repo",
            ref: "feature",
            tier: "materialized",
            totalHunks: 10,
            trustedHunks: 0,
            approvedHunks: 4,
            reviewedHunks: 4,
            rejectedHunks: 0,
            savedForLaterHunks: 0,
            state: null,
            updatedAt: new Date(NOW).toISOString(),
          },
        },
      ),
    );
    expect(status.hasChanges).toBe(true);
    expect(status.phrase).toBe("#12 CI failing · uncommitted changes");
  });

  it("falls back to review progress when nothing is waiting on you", () => {
    const key = makeReviewKey(REPO, "feature");
    const status = describeWorkItem(
      item(),
      context([branch("feature")], [], {
        [key]: {
          repoPath: REPO,
          repoName: "repo",
          ref: "feature",
          tier: "materialized",
          totalHunks: 10,
          trustedHunks: 0,
          approvedHunks: 3,
          reviewedHunks: 3,
          rejectedHunks: 0,
          savedForLaterHunks: 0,
          state: null,
          updatedAt: new Date(NOW).toISOString(),
        },
      }),
    );
    expect(status.phrase).toBe("3/10 reviewed");
  });

  it("labels each chip with the repo it belongs to", () => {
    const status = describeWorkItem(
      item({
        refs: [
          { repoPath: REPO, ref: "feature" },
          { repoPath: "/other", ref: "dev" },
        ],
      }),
      context([branch("feature")]),
    );
    expect(status.refs.map((r) => r.chipLabel)).toEqual([
      "repo·feature",
      "other·dev",
    ]);
    // The unknown repo's ref isn't gone, so the card isn't done.
    expect(status.resolved).toBe(false);
  });
});
