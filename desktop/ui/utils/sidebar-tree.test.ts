import { describe, it, expect } from "vitest";
import {
  buildSidebarTree,
  flattenSidebarTree,
  isRepoExpanded,
  COMMIT_BY_USER_WINDOW_MS,
  REVIEW_ACTIVE_WINDOW_MS,
  type RepoNode,
  type SidebarRow,
} from "./sidebar-tree";
import type {
  GlobalReviewSummary,
  LocalBranchInfo,
  RepoLocalActivity,
} from "../types";

const NOW = Date.UTC(2026, 0, 20); // fixed "now"

function iso(msAgo: number): string {
  return new Date(NOW - msAgo).toISOString();
}

function branch(overrides: Partial<LocalBranchInfo> = {}): LocalBranchInfo {
  return {
    name: "feature",
    isCurrent: false,
    commitsAhead: 1,
    hasWorkingTreeChanges: false,
    lastCommitDate: iso(30 * 86_400_000), // 30d ago — outside all windows
    lastCommitMessage: "wip",
    lastCommitByUser: false,
    worktreePath: null,
    lastModifiedAt: null,
    workingTreeStats: null,
    ...overrides,
  };
}

function repo(
  repoPath: string,
  branches: LocalBranchInfo[],
  overrides: Partial<RepoLocalActivity> = {},
): RepoLocalActivity {
  return {
    repoPath,
    repoName: repoPath.split("/").pop() ?? repoPath,
    defaultBranch: "main",
    branches,
    recentRemoteBranches: [],
    lastFetchedAt: null,
    ...overrides,
  };
}

function review(
  repoPath: string,
  ref: string,
  updatedMsAgo: number,
  overrides: Partial<GlobalReviewSummary> = {},
): GlobalReviewSummary {
  return {
    repoPath,
    repoName: repoPath.split("/").pop() ?? repoPath,
    ref,
    tier: "fetched" as const,
    totalHunks: 10,
    trustedHunks: 0,
    approvedHunks: 0,
    reviewedHunks: 0,
    rejectedHunks: 0,
    savedForLaterHunks: 0,
    state: null,
    updatedAt: iso(updatedMsAgo),
    ...overrides,
  };
}

function byKey(
  reviews: GlobalReviewSummary[],
): Record<string, GlobalReviewSummary> {
  return Object.fromEntries(reviews.map((r) => [`${r.repoPath}:${r.ref}`, r]));
}

function build(
  activity: RepoLocalActivity[],
  reviews: GlobalReviewSummary[] = [],
  pinned: string[] = [],
  dismissed: string[] = [],
  openRepoPath: string | null = null,
): RepoNode[] {
  return buildSidebarTree(
    activity,
    reviews,
    byKey(reviews),
    pinned,
    dismissed,
    NOW,
    openRepoPath,
  );
}

function refs(rows: SidebarRow[]): string[] {
  return rows.map((r) => r.ref);
}

describe("the repo row is the repo-root checkout", () => {
  it("makes the current branch the head row, with the repo path as its checkout", () => {
    const [node] = build([
      repo("/r", [branch({ name: "master", isCurrent: true })]),
    ]);
    expect(node.head?.ref).toBe("master");
    expect(node.head?.checkoutPath).toBe("/r");
    expect(node.head?.presence).toBe("checkout");
    // It's the repo's own row, so it must not also appear beneath it.
    expect(refs(node.live)).not.toContain("master");
  });

  it("is quiet when the checkout is all it has", () => {
    // Stale tip, no changes, no review. Having HEAD somewhere isn't news —
    // every repo does, forever, so it can't be what makes one active.
    const [node] = build([
      repo("/r", [branch({ name: "master", isCurrent: true })]),
    ]);
    expect(node.head?.live).toBe(false);
    expect(node.head?.reasons).toEqual([]);
    expect(node.isActive).toBe(false);
    // It still has a checkout — liveness changed, not where the files are.
    expect(node.head?.checkoutPath).toBe("/r");
    expect(node.head?.presence).toBe("checkout");
  });

  it("wakes the repo up when the checkout has uncommitted changes", () => {
    const [node] = build([
      repo("/r", [
        branch({
          name: "master",
          isCurrent: true,
          hasWorkingTreeChanges: true,
        }),
      ]),
    ]);
    expect(node.head?.reasons).toEqual(["uncommitted"]);
    expect(node.isActive).toBe(true);
  });

  it("wakes the repo up for a worktree, which someone made on purpose", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "feat", worktreePath: "/wt/feat" }),
      ]),
    ]);
    expect(node.live[0].reasons).toEqual(["checkout"]);
    expect(node.isActive).toBe(true);
  });

  it("gives a linked worktree its own path and keeps it live", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "feat", worktreePath: "/wt/feat" }),
      ]),
    ]);
    expect(node.live).toHaveLength(1);
    expect(node.live[0].checkoutPath).toBe("/wt/feat");
    expect(node.live[0].presence).toBe("checkout");
  });

  it("leaves a branch with no checkout without one", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "old" }),
      ]),
    ]);
    expect(node.rest[0].ref).toBe("old");
    expect(node.rest[0].checkoutPath).toBeNull();
    expect(node.rest[0].presence).toBe("ref");
  });

  it("carries a review's own worktree as its checkout", () => {
    const reviews = [review("/r", "abc123", 0, { worktreePath: "/wt/abc" })];
    const [node] = build([repo("/r", [])], reviews);
    expect(node.live[0].checkoutPath).toBe("/wt/abc");
  });
});

describe("liveness rules", () => {
  it("includes a branch with uncommitted changes", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "dirty", hasWorkingTreeChanges: true }),
      ]),
    ]);
    expect(refs(node.live)).toContain("dirty");
  });

  it("includes a branch whose review was touched inside the window", () => {
    const reviews = [review("/r", "feat", REVIEW_ACTIVE_WINDOW_MS - 1000)];
    const [node] = build(
      [
        repo("/r", [
          branch({ name: "master", isCurrent: true }),
          branch({ name: "feat" }),
        ]),
      ],
      reviews,
    );
    expect(refs(node.live)).toContain("feat");
  });

  it("drops a branch whose review fell outside the window", () => {
    const reviews = [review("/r", "feat", REVIEW_ACTIVE_WINDOW_MS + 1000)];
    const [node] = build(
      [
        repo("/r", [
          branch({ name: "master", isCurrent: true }),
          branch({ name: "feat" }),
        ]),
      ],
      reviews,
    );
    expect(refs(node.live)).not.toContain("feat");
    expect(refs(node.rest)).toContain("feat");
  });

  it("includes a branch the user committed to recently", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({
          name: "mine",
          lastCommitByUser: true,
          lastCommitDate: iso(COMMIT_BY_USER_WINDOW_MS - 1000),
        }),
      ]),
    ]);
    expect(refs(node.live)).toContain("mine");
  });

  it("ignores a recent commit by someone else", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({
          name: "theirs",
          lastCommitByUser: false,
          lastCommitDate: iso(1000),
        }),
      ]),
    ]);
    expect(refs(node.rest)).toContain("theirs");
  });

  it("keeps the repo this window has open live, however quiet it is", () => {
    // Clean default branch, nobody's own commit for a month, no review: the
    // exact repo you get from `review .` on a fresh clone. Every other rule
    // says quiet, and quiet repos are hidden — including, without this, the
    // one on screen.
    const activity = [
      repo("/r", [branch({ name: "master", isCurrent: true })]),
    ];

    const [open] = build(activity, [], [], [], "/r");
    expect(open.head?.reasons).toContain("open-repo");
    expect(open.head?.live).toBe(true);
    expect(open.isActive).toBe(true);
    // The repro: with `showInactiveRepos` off, an inactive repo is dropped
    // from the list the sidebar walks, not just demoted.
    expect(refs(flattenSidebarTree([open], {}, {}, false))).toEqual(["master"]);
  });

  it("leaves that same repo quiet when it isn't the one open", () => {
    const activity = [
      repo("/r", [branch({ name: "master", isCurrent: true })]),
    ];

    const [other] = build(activity, [], [], [], "/somewhere-else");
    expect(other.head?.reasons).toEqual([]);
    expect(other.isActive).toBe(false);
    expect(flattenSidebarTree([other], {}, {}, false)).toEqual([]);
  });

  it("keeps an open repo active even with no checkout and a dismissed head", () => {
    // A repo known only through reviews has no head row to carry the reason,
    // and a dismissed head row would refuse it — neither may hide the repo
    // the window is displaying.
    const [bare] = build([repo("/r", [])], [], [], [], "/r");
    expect(bare.head).toBeNull();
    expect(bare.isActive).toBe(true);

    const [dismissed] = build(
      [repo("/r", [branch({ name: "master", isCurrent: true })])],
      [],
      [],
      ["/r:master"],
      "/r",
    );
    expect(dismissed.head?.live).toBe(false);
    expect(dismissed.isActive).toBe(true);
  });

  it("pins a row live and dismisses one out", () => {
    const activity = [
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "stale" }),
        branch({ name: "dirty", hasWorkingTreeChanges: true }),
      ]),
    ];
    const [pinnedNode] = build(activity, [], ["/r:stale"]);
    expect(refs(pinnedNode.live)).toContain("stale");

    const [dismissedNode] = build(activity, [], [], ["/r:dirty"]);
    expect(refs(dismissedNode.live)).not.toContain("dirty");
    expect(refs(dismissedNode.rest)).toContain("dirty");
  });

  it("lets a pin win over a dismiss for the same row", () => {
    const [node] = build(
      [
        repo("/r", [
          branch({ name: "master", isCurrent: true }),
          branch({ name: "feat" }),
        ]),
      ],
      [],
      ["/r:feat"],
      ["/r:feat"],
    );
    expect(refs(node.live)).toContain("feat");
  });
});

describe("row ranking", () => {
  it("ranks pinned rows first, in pin order", () => {
    const [node] = build(
      [
        repo("/r", [
          branch({ name: "master", isCurrent: true }),
          branch({ name: "p1" }),
          branch({ name: "p2" }),
          branch({ name: "wt", worktreePath: "/wt" }),
        ]),
      ],
      [],
      ["/r:p2", "/r:p1"],
    );
    expect(refs(node.live).slice(0, 2)).toEqual(["p2", "p1"]);
  });

  it("ranks equal-presence rows by recency, with size no longer a factor", () => {
    // Ordering takes no sort-order input any more. The menu that set one is
    // gone, so a persisted "size" would have kept reordering rows with nothing
    // left to change it back: presence, then recency, then key — full stop.
    const reviews = [
      review("/r", "huge", 5000, { totalHunks: 900 }),
      review("/r", "tiny", 1000, { totalHunks: 1 }),
    ];
    const [node] = build([repo("/r", [])], reviews);
    expect(refs(node.live)).toEqual(["tiny", "huge"]);
  });

  it("ranks checkouts above reviews above bare refs", () => {
    const reviews = [review("/r", "reviewed", 1000)];
    const [node] = build(
      [
        repo("/r", [
          branch({ name: "master", isCurrent: true }),
          // Bare ref, but freshest — presence still outranks recency.
          branch({
            name: "bare",
            lastCommitByUser: true,
            lastCommitDate: iso(0),
          }),
          branch({ name: "reviewed" }),
          branch({
            name: "wt",
            worktreePath: "/wt",
            lastCommitDate: iso(20 * 86_400_000),
          }),
        ]),
      ],
      reviews,
    );
    expect(refs(node.live)).toEqual(["wt", "reviewed", "bare"]);
  });
});

describe("repo ordering", () => {
  it("puts repos with live rows above quiet ones", () => {
    const nodes = build([
      // Quiet: stale branches only, nothing anyone touched.
      repo("/a-quiet", [branch({ name: "old" })]),
      repo("/z-busy", [
        branch({
          name: "master",
          isCurrent: true,
          hasWorkingTreeChanges: true,
        }),
      ]),
    ]);
    expect(nodes.map((n) => n.repoPath)).toEqual(["/z-busy", "/a-quiet"]);
    expect(nodes[1].isActive).toBe(false);
  });

  it("orders repos alphabetically, not by recency, within each half", () => {
    const nodes = build([
      repo("/zulu", [
        branch({
          name: "master",
          isCurrent: true,
          hasWorkingTreeChanges: true,
        }),
      ]),
      repo("/alpha", [
        branch({
          name: "master",
          isCurrent: true,
          hasWorkingTreeChanges: true,
          // Older than zulu's — recency must not pull it up.
          lastCommitDate: iso(5 * 86_400_000),
        }),
      ]),
      repo("/quiet-z", [branch({ name: "old" })]),
      repo("/quiet-a", [branch({ name: "old" })]),
    ]);
    expect(nodes.map((n) => n.repoPath)).toEqual([
      "/alpha",
      "/zulu",
      "/quiet-a",
      "/quiet-z",
    ]);
  });

  it("keeps the same order when only activity timestamps move", () => {
    const order = (commitMsAgo: number) =>
      build([
        repo("/zulu", [
          branch({
            name: "master",
            isCurrent: true,
            hasWorkingTreeChanges: true,
            lastCommitDate: iso(commitMsAgo),
          }),
        ]),
        repo("/alpha", [
          branch({
            name: "master",
            isCurrent: true,
            hasWorkingTreeChanges: true,
          }),
        ]),
      ]).map((n) => n.repoPath);

    expect(order(10 * 86_400_000)).toEqual(order(1000));
  });
});

describe("remote-recent rows", () => {
  it("dedupes against branches and reviews already represented", () => {
    const reviews = [review("/r", "pinned-ref", 1000)];
    const [node] = build(
      [
        repo("/r", [branch({ name: "master", isCurrent: true })], {
          recentRemoteBranches: [
            {
              remoteRef: "origin/master",
              branchName: "master",
              lastCommitDate: iso(0),
            },
            {
              remoteRef: "origin/pinned-ref",
              branchName: "pinned-ref",
              lastCommitDate: iso(0),
            },
            {
              remoteRef: "origin/fresh",
              branchName: "fresh",
              lastCommitDate: iso(0),
            },
          ],
        }),
      ],
      reviews,
    );
    const all = [...node.live, ...node.rest].map((r) => r.ref);
    expect(all.filter((r) => r === "master")).toHaveLength(0); // head only
    expect(all.filter((r) => r === "pinned-ref")).toHaveLength(1);
    expect(refs(node.rest)).toContain("fresh");
  });
});

describe("expansion and flattening", () => {
  const nodes = () =>
    build([
      repo("/busy", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "wt", worktreePath: "/wt" }),
        branch({ name: "old" }),
      ]),
      repo("/quiet", [branch({ name: "old" })]),
    ]);

  it("expands active repos and collapses quiet ones by default", () => {
    const [busy, quiet] = nodes();
    expect(isRepoExpanded({}, busy)).toBe(true);
    expect(isRepoExpanded({}, quiet)).toBe(false);
  });

  it("honors an explicit override in both directions", () => {
    const [busy, quiet] = nodes();
    expect(isRepoExpanded({ "/busy": true }, busy)).toBe(false);
    expect(isRepoExpanded({ "/quiet": false }, quiet)).toBe(true);
  });

  it("walks head → live → rest, skipping quiet repos until asked", () => {
    expect(refs(flattenSidebarTree(nodes(), {}, {}, false))).toEqual([
      "master",
      "wt",
    ]);
    expect(
      refs(flattenSidebarTree(nodes(), {}, { "/busy": true }, false)),
    ).toEqual(["master", "wt", "old"]);
    // A quiet repo contributes its head row only — its children stay collapsed.
    expect(refs(flattenSidebarTree(nodes(), {}, {}, true))).toEqual([
      "master",
      "wt",
    ]);
  });
});
