import { describe, it, expect } from "vitest";
import {
  attentionSignalAt,
  describeWorkspace,
  isUnseen,
  type WorkspaceContext,
} from "./workspace-status";
import { buildSidebarTree, allSidebarRows } from "../../utils/sidebar-tree";
import { makeReviewKey } from "../../utils/review-key";
import { attachment, workspace as makeWorkspace } from "../../test/fixtures";
import type {
  GlobalReviewSummary,
  LocalBranchInfo,
  RepoLocalActivity,
  ShippedPr,
  ViewerPr,
  Workspace,
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
    behindUpstream: 0,
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
): WorkspaceContext {
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
    heads: new Map(),
    reviews,
    shipped: new Map(),
  };
}

function item(overrides: Partial<Workspace> = {}): Workspace {
  return makeWorkspace("one", {
    attachments: [attachment(REPO, "feature")],
    createdAt: new Date(NOW).toISOString(),
    ...overrides,
  });
}

describe("describeWorkspace", () => {
  it("renders the title the backend derived when the user gave it none", () => {
    const status = describeWorkspace(
      item(),
      context([branch("main", { isCurrent: true }), branch("feature")]),
    );
    expect(status.title).toBe("repo · feature");
    expect(status.subtitle).toContain("repo");
    expect(status.resolved).toBe(false);
  });

  it("keeps the user's title when there is one", () => {
    const status = describeWorkspace(
      item({ title: "Ship the thing" }),
      context([branch("feature")]),
    );
    expect(status.title).toBe("Ship the thing");
  });

  it("resolves a card whose every branch is gone", () => {
    const status = describeWorkspace(item(), context([branch("main")]));
    expect(status.resolved).toBe(true);
    expect(status.phrase).toBe("branch gone");
  });

  it("does not resolve a repo nothing is known about", () => {
    // An unregistered repo has no rows because nothing looked, which is not
    // the same as a branch that was deleted.
    const ctx = context([branch("main")]);
    ctx.knownRepos.delete(REPO);
    expect(describeWorkspace(item(), ctx).resolved).toBe(false);
  });

  it("leads with the PR that wants something over one that doesn't", () => {
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "quiet"), attachment(REPO, "feature")],
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

  it("sizes the working tree, and stops at two clauses", () => {
    const status = describeWorkspace(
      item(),
      context(
        [
          branch("feature", {
            hasWorkingTreeChanges: true,
            workingTreeStats: { fileCount: 3, additions: 48, deletions: 12 },
          }),
        ],
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
    // Two clauses, so the review progress the same context supplies is left
    // out — and the changes one is structured, since the card colours it.
    expect(status.phrase).toBe("#12 CI failing · 3 files +48 −12");
    // Every clause carries its own words; the stat rides *alongside* them, so
    // the card can colour the numbers without rewriting the sentence.
    expect(status.clauses).toEqual([
      { text: "#12 CI failing" },
      {
        text: "3 files +48 −12",
        stat: { fileCount: 3, additions: 48, deletions: 12 },
      },
    ]);
  });

  /**
   * Stats are the checked-out branch's alone, so a workspace can have changes
   * with nothing having counted them. The adjective is still true.
   */
  it("says uncommitted changes when nothing measured them", () => {
    const status = describeWorkspace(
      item(),
      context([branch("feature", { hasWorkingTreeChanges: true })]),
    );
    expect(status.phrase).toBe("uncommitted changes");
  });

  /** One line for the card, so several repos' working trees are one sum. */
  it("sums the working trees of every repo that has one", () => {
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "feature"), attachment(REPO, "other")],
      }),
      context([
        branch("feature", {
          hasWorkingTreeChanges: true,
          workingTreeStats: { fileCount: 3, additions: 48, deletions: 12 },
        }),
        branch("other", {
          hasWorkingTreeChanges: true,
          workingTreeStats: { fileCount: 1, additions: 2, deletions: 30 },
        }),
      ]),
    );
    expect(status.phrase).toBe("4 files +50 −42");
  });

  /** A clean workspace is never asked how big its changes are. */
  it("says nothing about a working tree with nothing in it", () => {
    const status = describeWorkspace(item(), context([branch("feature")]));
    expect(status.phrase).toBe("");
    expect(status.clauses).toEqual([]);
  });

  it("falls back to review progress when nothing is waiting on you", () => {
    const key = makeReviewKey(REPO, "feature");
    const status = describeWorkspace(
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
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "feature"), attachment("/other", "dev")],
      }),
      context([branch("feature")]),
    );
    expect(status.repos.map((c) => c.chipLabel)).toEqual([
      "repo · feature",
      "other · dev",
    ]);
    // The unknown repo's ref isn't gone, so the workspace isn't done.
    expect(status.resolved).toBe(false);
  });

  /**
   * An attachment with no ref is what the router hands a terminal started
   * outside any repository. It names no branch, so nothing can have deleted it
   * — treating it as gone would resolve a workspace that is still in use.
   */
  it("names a ref-less attachment by its directory and never calls it gone", () => {
    const status = describeWorkspace(
      item({ title: "", attachments: [attachment("/tmp/scratch")] }),
      context([]),
    );
    expect(status.title).toBe("scratch");
    expect(status.repos[0].chipLabel).toBe("scratch");
    expect(status.resolved).toBe(false);
  });

  it("sums review progress across the repos that have one", () => {
    const review = (ref: string, reviewed: number, total: number) => ({
      repoPath: REPO,
      repoName: "repo",
      ref,
      tier: "materialized" as const,
      totalHunks: total,
      trustedHunks: 0,
      approvedHunks: reviewed,
      reviewedHunks: reviewed,
      rejectedHunks: 0,
      savedForLaterHunks: 0,
      state: null,
      updatedAt: new Date(NOW).toISOString(),
    });
    const status = describeWorkspace(
      item({
        attachments: [attachment(REPO, "feature"), attachment(REPO, "dev")],
      }),
      context([branch("feature"), branch("dev")], [], {
        [makeReviewKey(REPO, "feature")]: review("feature", 3, 10),
        [makeReviewKey(REPO, "dev")]: review("dev", 1, 2),
      }),
    );
    expect(status.progress).toEqual({ reviewed: 4, total: 12 });
  });
});

function shippedPr(ref: string, overrides: Partial<ShippedPr> = {}): ShippedPr {
  return {
    number: 12,
    url: "https://github.com/o/repo/pull/12",
    title: "A change",
    mergedAt: new Date(NOW).toISOString(),
    repoPath: REPO,
    headRefName: ref,
    confirmedAt: new Date(NOW).toISOString(),
    ...overrides,
  };
}

/** A context whose shipped index is keyed the way an attachment is. */
function shippedContext(
  branches: LocalBranchInfo[],
  merges: ShippedPr[],
  prs: ViewerPr[] = [],
): WorkspaceContext {
  const ctx = context(branches, prs);
  return {
    ...ctx,
    shipped: new Map(
      merges.map((pr) => [makeReviewKey(pr.repoPath, pr.headRefName), pr]),
    ),
  };
}

describe("shipped", () => {
  it("is the end of the story, and outranks the branch being gone", () => {
    // The branch is not in local activity — merged and deleted, which is the
    // shape this arrives in almost every time.
    const status = describeWorkspace(
      item(),
      shippedContext([branch("main")], [shippedPr("feature")]),
    );
    expect(status.shipped?.number).toBe(12);
    expect(status.phrase).toBe("#12 shipped");
    expect(status.resolved).toBe(true);
  });

  it("waits for every attached branch to land", () => {
    const both = item({
      attachments: [attachment(REPO, "feature"), attachment(REPO, "dev")],
    });
    const half = describeWorkspace(
      both,
      shippedContext(
        [branch("feature"), branch("dev")],
        [shippedPr("feature")],
      ),
    );
    expect(half.shipped).toBeUndefined();

    const all = describeWorkspace(
      both,
      shippedContext(
        [branch("feature"), branch("dev")],
        [
          shippedPr("feature", { number: 12 }),
          shippedPr("dev", {
            number: 13,
            mergedAt: new Date(NOW + 1000).toISOString(),
          }),
        ],
      ),
    );
    // The last one to land is the one the header names.
    expect(all.shipped?.number).toBe(13);
  });

  it("yields to a PR that is open again on the same branch", () => {
    const status = describeWorkspace(
      item(),
      shippedContext([branch("feature")], [shippedPr("feature")], [pr()]),
    );
    expect(status.shipped).toBeUndefined();
    expect(status.openPr?.number).toBe(12);
  });
});

describe("attention markers", () => {
  const quiet = () => describeWorkspace(item(), context([branch("feature")]));

  it("says nothing about a workspace that is quietly getting on with it", () => {
    expect(attentionSignalAt(quiet(), null)).toBeNull();
    expect(isUnseen(null, undefined)).toBe(false);
  });

  it("takes the newest of the things that want a person", () => {
    const blocked = describeWorkspace(
      item(),
      context(
        [branch("feature")],
        [
          pr({
            checksState: "FAILURE",
            updatedAt: new Date(NOW).toISOString(),
          }),
        ],
      ),
    );
    // A terminal that stopped after the PR failed is the newer thing.
    expect(attentionSignalAt(blocked, NOW + 5000)).toBe(NOW + 5000);
    expect(attentionSignalAt(blocked, null)).toBe(NOW);
  });

  it("ignores a PR that is open and healthy", () => {
    const healthy = describeWorkspace(
      item(),
      context([branch("feature")], [pr()]),
    );
    expect(attentionSignalAt(healthy, null)).toBeNull();
  });

  it("is unseen until the last look postdates the signal", () => {
    expect(isUnseen(NOW, undefined)).toBe(true);
    expect(isUnseen(NOW, NOW - 1)).toBe(true);
    expect(isUnseen(NOW, NOW)).toBe(false);
    expect(isUnseen(NOW, NOW + 1)).toBe(false);
  });
});
