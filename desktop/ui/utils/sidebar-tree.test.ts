import { describe, it, expect } from "vitest";
import {
  allSidebarRows,
  buildSidebarTree,
  rowHasFacts,
  type RepoNode,
  type SidebarRow,
} from "./sidebar-tree";
import type {
  GlobalReviewSummary,
  LocalBranchInfo,
  RepoLocalActivity,
  ViewerPr,
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
    unpushedCommits: 0,
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

function viewerPr(overrides: Partial<ViewerPr> = {}): ViewerPr {
  return {
    number: 7,
    title: "Add the thing",
    url: "https://github.com/o/r/pull/7",
    isDraft: false,
    updatedAt: iso(1000),
    headRefName: "feature",
    baseRefName: "main",
    repoNameWithOwner: "o/r",
    repoUrl: "https://github.com/o/r",
    // Same-repo PR by default; a fork PR is one the backend hands over with
    // `repoPath: null`, which the elsewhere-bucket tests cover.
    headRepoNameWithOwner: "o/r",
    reviewDecision: null,
    checksState: null,
    repoPath: "/r",
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
  opts: {
    reviews?: GlobalReviewSummary[];
    viewerPrs?: ViewerPr[];
  } = {},
): RepoNode[] {
  const reviews = opts.reviews ?? [];
  return buildSidebarTree(
    activity,
    reviews,
    byKey(reviews),
    opts.viewerPrs ?? [],
  );
}

function refs(rows: SidebarRow[]): string[] {
  return rows.map((r) => r.ref);
}

/** The refs a repo has something to report about — the rows with facts. */
function shown(node: RepoNode): string[] {
  return refs(node.rows.filter(rowHasFacts));
}

describe("the repo row is the repo-root checkout", () => {
  it("makes the current branch the head row, with the repo path as its checkout", () => {
    const [node] = build([
      repo("/r", [branch({ name: "master", isCurrent: true })]),
    ]);
    expect(node.head?.ref).toBe("master");
    expect(node.head?.checkoutPath).toBe("/r");
    // It's the repo's own row, so it must not also appear beneath it.
    expect(refs(node.rows)).not.toContain("master");
  });

  it("holds no fact when the checkout is all it has", () => {
    // Clean, pushed, no PR. Having HEAD somewhere isn't news — every repo does,
    // forever — so the repo row shows because it is the repo, not because a
    // rule fired on it.
    const [node] = build([
      repo("/r", [branch({ name: "master", isCurrent: true })]),
    ]);
    expect(node.head?.facts).toEqual([]);
    // It still has a checkout: where the files are is a different question.
    expect(node.head?.checkoutPath).toBe("/r");
  });

  it("reports the head row's own facts", () => {
    const [node] = build([
      repo("/r", [
        branch({
          name: "master",
          isCurrent: true,
          hasWorkingTreeChanges: true,
        }),
      ]),
    ]);
    expect(node.head?.facts).toEqual(["dirty"]);
  });

  it("gives a linked worktree its own path", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "feat", worktreePath: "/wt/feat" }),
      ]),
    ]);
    expect(node.rows).toHaveLength(1);
    expect(node.rows[0].checkoutPath).toBe("/wt/feat");
    expect(node.rows[0].facts).toEqual(["materialized"]);
  });

  it("leaves a branch with no checkout without one", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "old" }),
      ]),
    ]);
    expect(node.rows[0].ref).toBe("old");
    expect(node.rows[0].checkoutPath).toBeNull();
  });

  it("carries a review's own worktree as its checkout", () => {
    const reviews = [review("/r", "abc123", 0, { worktreePath: "/wt/abc" })];
    const [node] = build([repo("/r", [])], { reviews });
    expect(node.rows[0].checkoutPath).toBe("/wt/abc");
    expect(node.rows[0].facts).toEqual(["materialized"]);
  });
});

describe("row facts", () => {
  it("counts a linked worktree, which someone made on purpose", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "feat", worktreePath: "/wt/feat" }),
      ]),
    ]);
    expect(shown(node)).toContain("feat");
  });

  it("counts uncommitted changes", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "dirty", hasWorkingTreeChanges: true }),
      ]),
    ]);
    expect(shown(node)).toContain("dirty");
  });

  it("counts commits that exist nowhere but here", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "unpushed", commitsAhead: 3, unpushedCommits: 3 }),
      ]),
    ]);
    expect(shown(node)).toContain("unpushed");
    expect(node.rows[0].facts).toEqual(["unpushed"]);
  });

  it("says nothing about a branch that is ahead but fully pushed", () => {
    // Ahead of the default branch is not the question — someone else can read
    // those commits. `unpushedCommits` is counted against the upstream, so
    // pushing a branch is what retires its row.
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "published", commitsAhead: 9, unpushedCommits: 0 }),
      ]),
    ]);
    expect(node.rows[0].facts).toEqual([]);
    expect(shown(node)).not.toContain("published");
  });

  it("ignores how recently anyone committed, on either side", () => {
    // Both of these used to be rules. Recency answers "was something happening
    // here", which drifts on its own and needs a dismiss to argue with.
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({
          name: "mine",
          lastCommitByUser: true,
          lastCommitDate: iso(0),
        }),
        branch({
          name: "theirs",
          lastCommitByUser: false,
          lastCommitDate: iso(0),
        }),
      ]),
    ]);
    expect(shown(node)).toEqual([]);
  });

  it("ignores how recently a review was touched", () => {
    const reviews = [review("/r", "feat", 0)];
    const [node] = build(
      [
        repo("/r", [
          branch({ name: "master", isCurrent: true }),
          branch({ name: "feat" }),
        ]),
      ],
      { reviews },
    );
    // Findable, but not drawn: having reviewed something is a record of the
    // past, not a fact about the repo now.
    expect(refs(node.rows)).toContain("feat");
    expect(shown(node)).not.toContain("feat");
  });

  it("lists a repo nothing has happened in, quiet head row and all", () => {
    // Clean default branch, everything pushed, no review: the exact repo you
    // get from `review .` on a fresh clone. It is listed anyway — the layer is
    // a browse surface, so nothing is hidden for being idle.
    const [node] = build([
      repo("/r", [branch({ name: "master", isCurrent: true })]),
    ]);
    expect(node.head?.ref).toBe("master");
    expect(shown(node)).toEqual([]);
  });

  it("lists a repo known only through reviews, with no head row", () => {
    const [node] = build([repo("/r", [])]);
    expect(node.head).toBeNull();
    expect(node.repoPath).toBe("/r");
  });
});

describe("rows and facts", () => {
  const busy = () =>
    build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "dirty", hasWorkingTreeChanges: true }),
        branch({ name: "quiet" }),
      ]),
    ])[0];

  /**
   * The tree builds every branch, whether or not anything would draw it: ⌘K
   * reads the whole list, and a branch with nothing to report is exactly what
   * you go looking for by name.
   */
  it("keeps the rows nothing would draw, for the palette to find", () => {
    expect(refs(busy().rows)).toEqual(["dirty", "quiet"]);
    expect(
      busy()
        .rows.filter(rowHasFacts)
        .map((r) => r.ref),
    ).toEqual(["dirty"]);
  });

  it("never puts the repo row among them", () => {
    // A repo's own row is the repo: it is drawn on different terms from
    // everything under it, so it is not in `rows` at all.
    const node = busy();
    expect(node.head?.ref).toBe("master");
    expect(refs(node.rows)).not.toContain("master");
  });
});

describe("row ordering", () => {
  it("puts rows with files on disk first, then sorts by name", () => {
    const [node] = build([
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "zebra", worktreePath: "/wt/zebra" }),
        branch({ name: "apple", hasWorkingTreeChanges: true }),
        branch({ name: "beta", unpushedCommits: 1 }),
        branch({ name: "alpha", worktreePath: "/wt/alpha" }),
      ]),
    ]);
    expect(shown(node)).toEqual(["alpha", "zebra", "apple", "beta"]);
  });

  it("keeps the same order when only timestamps move", () => {
    // No ordering here reads a clock, so this is the whole guarantee: the row
    // you are reaching for is where it was.
    const order = (commitMsAgo: number) =>
      shown(
        build([
          repo("/r", [
            branch({ name: "master", isCurrent: true }),
            branch({
              name: "zulu",
              hasWorkingTreeChanges: true,
              lastCommitDate: iso(commitMsAgo),
            }),
            branch({ name: "alpha", hasWorkingTreeChanges: true }),
          ]),
        ])[0],
      );

    expect(order(10 * 86_400_000)).toEqual(order(1000));
    expect(order(1000)).toEqual(["alpha", "zulu"]);
  });

  it("does not rank a row by how much of it there is to review", () => {
    const reviews = [
      review("/r", "huge", 5000, {
        totalHunks: 900,
        worktreePath: "/wt/huge",
      }),
      review("/r", "tiny", 1000, { totalHunks: 1, worktreePath: "/wt/tiny" }),
    ];
    const [node] = build([repo("/r", [])], { reviews });
    expect(shown(node)).toEqual(["huge", "tiny"]);
  });
});

describe("repo ordering", () => {
  it("is alphabetical, with nothing about activity ranking a repo", () => {
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
    expect(nodes.map((n) => n.repoPath)).toEqual(["/a-quiet", "/z-busy"]);
  });

  it("does not let recency pull a repo up", () => {
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
      "/quiet-a",
      "/quiet-z",
      "/zulu",
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
    const reviews = [review("/r", "reviewed-ref", 1000)];
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
              remoteRef: "origin/reviewed-ref",
              branchName: "reviewed-ref",
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
      { reviews },
    );
    const all = refs(node.rows);
    expect(all.filter((r) => r === "master")).toHaveLength(0); // head only
    expect(all.filter((r) => r === "reviewed-ref")).toHaveLength(1);
    expect(all).toContain("fresh");
  });

  it("is findable but never drawn", () => {
    // A branch on the remote is pushed by definition, has no checkout and
    // nothing uncommitted, so no fact can hold. It is built for ⌘K, which is
    // the one thing you'd want from a branch someone else pushed.
    const [node] = build([
      repo("/r", [branch({ name: "master", isCurrent: true })], {
        recentRemoteBranches: [
          {
            remoteRef: "origin/theirs",
            branchName: "theirs",
            lastCommitDate: iso(0),
          },
        ],
      }),
    ]);
    expect(refs(node.rows)).toEqual(["theirs"]);
    expect(shown(node)).toEqual([]);
  });
});

describe("open pull requests", () => {
  const withMaster = (extra: LocalBranchInfo[] = []) => [
    repo("/r", [branch({ name: "master", isCurrent: true }), ...extra]),
  ];

  it("badges the row whose ref is the PR's head branch", () => {
    const pr = viewerPr({ headRefName: "feature" });
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [pr],
    });

    const row = node.rows.find((r) => r.ref === "feature");
    expect(row?.openPr).toBe(pr);
    // Badging an existing row must not also synthesize one for the same PR.
    expect(node.rows).toHaveLength(1);
    expect(shown(node)).toEqual(["feature"]);
  });

  it("badges a PR-keyed review whose ref isn't the branch name", () => {
    // Reviews started from a PR can carry any ref. Matching only on the head
    // branch would badge nothing and then duplicate the PR as its own row.
    const reviews = [
      review("/r", "pr-7-head", 1000, {
        githubPr: {
          number: 7,
          title: "Add the thing",
          headRefName: "feature",
          baseRefName: "main",
        },
      }),
    ];
    const [node] = build(withMaster(), {
      reviews,
      viewerPrs: [viewerPr({ number: 7, headRefName: "feature" })],
    });

    expect(node.rows).toHaveLength(1);
    expect(node.rows[0].ref).toBe("pr-7-head");
    expect(node.rows[0].openPr?.number).toBe(7);
  });

  it("gives a PR nothing local represents a row of its own", () => {
    const [node] = build(withMaster(), {
      viewerPrs: [viewerPr({ headRefName: "unseen" })],
    });

    const [row] = node.rows;
    expect(row.ref).toBe("unseen");
    expect(row.entry.kind).toBe("open-pr");
    // Keyed by PR number, so two PRs on one branch stay two rows.
    expect(row.reviewKey).toBe("/r:pr/7");
    // Nothing exists on disk for it — no checkout, and no review record until
    // the row is activated.
    expect(row.checkoutPath).toBeNull();
    expect(row.facts).toEqual(["open-pr"]);
    expect(shown(node)).toEqual(["unseen"]);
  });

  it("shows a PR nobody has touched in months", () => {
    // Staleness used to park a PR behind a fold on the theory that an old PR
    // isn't today's work. An open PR is an open PR: it is a fact about the
    // world, and closing or merging it is what takes the row away.
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [viewerPr({ updatedAt: iso(200 * 86_400_000) })],
    });
    expect(shown(node)).toContain("feature");
  });

  // A draft is the one open PR with no dismissal: you can't close it, you
  // aren't finished with it, and marking it ready is how it comes back. So it
  // badges but never earns the row.
  it("does not give a draft a row of its own", () => {
    const [node] = build(withMaster(), {
      viewerPrs: [viewerPr({ isDraft: true, headRefName: "unseen" })],
    });

    // Still in the tree — ⌘K finds it, and it is where the PR would be drawn
    // from the moment it stops being a draft.
    const [row] = node.rows;
    expect(row.entry.kind).toBe("open-pr");
    expect(row.openPr?.isDraft).toBe(true);
    expect(row.facts).toEqual([]);
    expect(shown(node)).toEqual([]);
  });

  it("lets a draft badge a row that shows for its own reasons", () => {
    const [node] = build(
      withMaster([branch({ name: "feature", hasWorkingTreeChanges: true })]),
      { viewerPrs: [viewerPr({ isDraft: true })] },
    );

    const row = node.rows.find((r) => r.ref === "feature");
    expect(row?.openPr?.number).toBe(7);
    // The dirty checkout is what draws it; the draft adds a badge, not a line.
    expect(row?.facts).toEqual(["dirty"]);
    expect(shown(node)).toEqual(["feature"]);
  });

  it("keeps drawing a non-draft PR on a branch row", () => {
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [viewerPr({ isDraft: false })],
    });

    const row = node.rows.find((r) => r.ref === "feature");
    expect(row?.facts).toContain("open-pr");
    expect(shown(node)).toEqual(["feature"]);
  });

  it("keeps PRs with no local repo out of the tree entirely", () => {
    const nodes = build(withMaster(), {
      viewerPrs: [
        viewerPr({ repoPath: null, repoNameWithOwner: "other/repo" }),
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].repoPath).toBe("/r");
    expect(nodes[0].rows).toHaveLength(0);
  });

  it("badges the PR-keyed review rather than the branch it came from", () => {
    // Both rows exist and both look like PR #7's; badging each would show one
    // PR twice, once per row. The review record is the more specific match.
    const reviews = [
      review("/r", "pr-7-head", 1000, {
        githubPr: {
          number: 7,
          title: "Add the thing",
          headRefName: "feature",
          baseRefName: "main",
        },
      }),
    ];
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      reviews,
      viewerPrs: [viewerPr({ number: 7, headRefName: "feature" })],
    });

    expect(node.rows.filter((r) => r.openPr != null).map((r) => r.ref)).toEqual(
      ["pr-7-head"],
    );
  });

  it("gives the row to the newest of two PRs on one branch, and the other its own row", () => {
    // Reopened work and fork branches both produce this. Letting the second PR
    // lose the join silently would drop an open PR out of the sidebar.
    const newer = viewerPr({ number: 9, updatedAt: iso(1000) });
    const older = viewerPr({ number: 5, updatedAt: iso(50_000) });
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [older, newer],
    });

    const branchRow = node.rows.find((r) => r.reviewKey === "/r:feature");
    expect(branchRow?.openPr?.number).toBe(9);

    const ownRow = node.rows.find((r) => r.reviewKey === "/r:pr/5");
    expect(ownRow?.entry.kind).toBe("open-pr");
    expect(ownRow?.ref).toBe("feature");
    expect(node.rows).toHaveLength(2);
  });

  it("keeps two branchless PRs on one head branch apart", () => {
    const [node] = build(withMaster(), {
      viewerPrs: [
        viewerPr({ number: 5, headRefName: "unseen" }),
        viewerPr({ number: 9, headRefName: "unseen" }),
      ],
    });

    expect(node.rows.map((r) => r.reviewKey).sort()).toEqual([
      "/r:pr/5",
      "/r:pr/9",
    ]);
  });
});

describe("the flat row list", () => {
  const nodes = () =>
    build([
      repo("/busy", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "wt", worktreePath: "/wt" }),
        branch({ name: "old" }),
      ]),
      repo("/quiet", [branch({ name: "old" })]),
    ]);

  it("walks head then every row, drawn or not", () => {
    // Nothing here is about what is on screen: the callers are lookups —
    // a work card resolving a bound ref, `activateReviewKey`, the palette —
    // and `old` is exactly the row that has no fact to its name and so needs a
    // search box to reach.
    expect(refs(allSidebarRows(nodes()))).toEqual([
      "master",
      "wt",
      "old",
      "old",
    ]);
  });
});
