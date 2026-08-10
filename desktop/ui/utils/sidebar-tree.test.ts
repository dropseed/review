import { describe, it, expect } from "vitest";
import {
  buildSidebarTree,
  flattenSidebarTree,
  groupPrsElsewhere,
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
    dismissed?: string[];
    openRepoPath?: string | null;
    terminalKeys?: string[];
    viewerPrs?: ViewerPr[];
  } = {},
): RepoNode[] {
  const reviews = opts.reviews ?? [];
  return buildSidebarTree(
    activity,
    reviews,
    byKey(reviews),
    opts.dismissed ?? [],
    NOW,
    opts.openRepoPath ?? null,
    opts.terminalKeys ?? [],
    opts.viewerPrs ?? [],
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
    const [node] = build([repo("/r", [])], { reviews });
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

  it("includes a branch with a shell running in it, and wakes its repo", () => {
    // Stale on every time-based rule — a running terminal is the only reason.
    const [node] = build(
      [
        repo("/r", [
          branch({ name: "master", isCurrent: true }),
          branch({ name: "agent-work" }),
        ]),
      ],
      { terminalKeys: ["/r:agent-work"] },
    );
    expect(refs(node.live)).toContain("agent-work");
    expect(node.live[0].reasons).toContain("terminal");
    expect(node.isActive).toBe(true);
    expect(node.hasActiveTerminal).toBe(true);
  });

  it("counts a shell in the repo-root checkout, not just a child row", () => {
    const [node] = build(
      [repo("/r", [branch({ name: "master", isCurrent: true })])],
      {
        terminalKeys: ["/r:master"],
      },
    );
    expect(node.head?.reasons).toContain("terminal");
    expect(node.hasActiveTerminal).toBe(true);
  });

  it("does not let a running terminal reorder rows", () => {
    // Ranking is presence then activity; "a shell is open here" is neither, so
    // the row lands where it always would — a phase that flips every few
    // seconds must never move rows under the cursor.
    const rowsFor = (terminalKeys: string[]) =>
      refs(
        build(
          [
            repo("/r", [
              branch({ name: "master", isCurrent: true }),
              branch({ name: "a", hasWorkingTreeChanges: true }),
              branch({ name: "b", hasWorkingTreeChanges: true }),
            ]),
          ],
          { terminalKeys },
        )[0].live,
      );
    expect(rowsFor(["/r:b"])).toEqual(rowsFor([]));
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
      { reviews },
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
      { reviews },
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

    const [open] = build(activity, { openRepoPath: "/r" });
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

    const [other] = build(activity, { openRepoPath: "/somewhere-else" });
    expect(other.head?.reasons).toEqual([]);
    expect(other.isActive).toBe(false);
    expect(flattenSidebarTree([other], {}, {}, false)).toEqual([]);
  });

  it("keeps an open repo active even with no checkout and a dismissed head", () => {
    // A repo known only through reviews has no head row to carry the reason,
    // and a dismissed head row would refuse it — neither may hide the repo
    // the window is displaying.
    const [bare] = build([repo("/r", [])], { openRepoPath: "/r" });
    expect(bare.head).toBeNull();
    expect(bare.isActive).toBe(true);

    const [dismissed] = build(
      [repo("/r", [branch({ name: "master", isCurrent: true })])],
      { dismissed: ["/r:master"], openRepoPath: "/r" },
    );
    expect(dismissed.head?.live).toBe(false);
    expect(dismissed.isActive).toBe(true);
  });

  it("dismisses a row out of the live list", () => {
    const activity = [
      repo("/r", [
        branch({ name: "master", isCurrent: true }),
        branch({ name: "dirty", hasWorkingTreeChanges: true }),
      ]),
    ];
    const [node] = build(activity, { dismissed: ["/r:dirty"] });
    expect(refs(node.live)).not.toContain("dirty");
    expect(refs(node.rest)).toContain("dirty");
  });
});

describe("row ranking", () => {
  it("ranks equal-presence rows by recency, with size no longer a factor", () => {
    // Ordering takes no sort-order input any more. The menu that set one is
    // gone, so a persisted "size" would have kept reordering rows with nothing
    // left to change it back: presence, then recency, then key — full stop.
    const reviews = [
      review("/r", "huge", 5000, { totalHunks: 900 }),
      review("/r", "tiny", 1000, { totalHunks: 1 }),
    ];
    const [node] = build([repo("/r", [])], { reviews });
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
      { reviews },
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

  it("puts repos with a shell running in them above the other active ones", () => {
    const nodes = build(
      [
        repo("/a-busy", [
          branch({
            name: "master",
            isCurrent: true,
            hasWorkingTreeChanges: true,
          }),
        ]),
        repo("/z-quiet", [branch({ name: "old" })]),
        // Alphabetically last, and live for no reason but the shell.
        repo("/z-terminal", [
          branch({ name: "master", isCurrent: true }),
          branch({ name: "agent-work" }),
        ]),
      ],
      { terminalKeys: ["/z-terminal:agent-work"] },
    );
    expect(nodes.map((n) => n.repoPath)).toEqual([
      "/z-terminal",
      "/a-busy",
      "/z-quiet",
    ]);
    expect(nodes[0].hasActiveTerminal).toBe(true);
    expect(nodes[1].hasActiveTerminal).toBe(false);
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
    const all = [...node.live, ...node.rest].map((r) => r.ref);
    expect(all.filter((r) => r === "master")).toHaveLength(0); // head only
    expect(all.filter((r) => r === "reviewed-ref")).toHaveLength(1);
    expect(refs(node.rest)).toContain("fresh");
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

    const row = [...node.live, ...node.rest].find((r) => r.ref === "feature");
    expect(row?.openPr).toBe(pr);
    // Badging an existing row must not also synthesize one for the same PR.
    expect([...node.live, ...node.rest]).toHaveLength(1);
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

    const rows = [...node.live, ...node.rest];
    expect(rows).toHaveLength(1);
    expect(rows[0].ref).toBe("pr-7-head");
    expect(rows[0].openPr?.number).toBe(7);
  });

  it("gives a PR nothing local represents a row of its own", () => {
    const [node] = build(withMaster(), {
      viewerPrs: [viewerPr({ headRefName: "unseen" })],
    });

    const [row] = node.live;
    expect(row.ref).toBe("unseen");
    expect(row.entry.kind).toBe("open-pr");
    expect(row.reviewKey).toBe("/r:unseen");
    // Nothing exists on disk for it — no checkout, and no review record until
    // the row is activated.
    expect(row.checkoutPath).toBeNull();
    expect(row.presence).toBe("ref");
    expect(row.reasons).toEqual(["open-pr"]);
  });

  it("wakes a repo whose only news is an open PR", () => {
    const [node] = build(withMaster(), {
      viewerPrs: [viewerPr({ headRefName: "unseen" })],
    });
    expect(node.isActive).toBe(true);
  });

  it("leaves a draft parked", () => {
    // The reason this rule exists: someone with dozens of open drafts would
    // otherwise have a live zone made entirely of work they aren't doing.
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [viewerPr({ isDraft: true })],
    });

    const row = [...node.live, ...node.rest].find((r) => r.ref === "feature");
    expect(row?.openPr).toBeDefined();
    expect(row?.reasons).not.toContain("open-pr");
    expect(refs(node.live)).not.toContain("feature");
  });

  it("wakes a draft that has changes requested", () => {
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [
        viewerPr({ isDraft: true, reviewDecision: "CHANGES_REQUESTED" }),
      ],
    });
    expect(refs(node.live)).toContain("feature");
  });

  it("wakes a draft whose CI is failing", () => {
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [viewerPr({ isDraft: true, checksState: "FAILURE" })],
    });
    expect(refs(node.live)).toContain("feature");
  });

  it("keeps a recently updated PR live", () => {
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [
        viewerPr({ updatedAt: iso(COMMIT_BY_USER_WINDOW_MS - 1000) }),
      ],
    });
    expect(refs(node.live)).toContain("feature");
  });

  it("parks a PR nobody has touched in a week, badge and all", () => {
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [
        viewerPr({ updatedAt: iso(COMMIT_BY_USER_WINDOW_MS + 1000) }),
      ],
    });

    expect(refs(node.live)).not.toContain("feature");
    expect(refs(node.rest)).toContain("feature");
    // Old work is still work: the row and its badge stay, it just stops
    // claiming to be today's.
    const row = node.rest.find((r) => r.ref === "feature");
    expect(row?.openPr).toBeDefined();
    expect(row?.reasons).not.toContain("open-pr");
  });

  it("parks a PR that would have survived the review window", () => {
    // The case that made this window shorter, taken from the real snapshot: a
    // repo's worth of batch-opened PRs, all 12 days untouched. Under the
    // 14-day review window every one of them stayed live with two days to
    // spare. A PR's own `updatedAt` is author activity, so it answers to the
    // author's window, not the reviewer's.
    const twelveDays = 12 * 86_400_000;
    expect(twelveDays).toBeGreaterThan(COMMIT_BY_USER_WINDOW_MS);
    expect(twelveDays).toBeLessThan(REVIEW_ACTIVE_WINDOW_MS);

    const [node] = build(withMaster([branch({ name: "feature" })]), {
      viewerPrs: [viewerPr({ updatedAt: iso(twelveDays) })],
    });
    expect(refs(node.live)).not.toContain("feature");
    expect(refs(node.rest)).toContain("feature");
  });

  it("keeps a stale PR live when it's blocked", () => {
    // Age is the argument *for* surfacing this one: a PR that has been waiting
    // on you for months is worse than one that started waiting yesterday.
    const stale = { updatedAt: iso(COMMIT_BY_USER_WINDOW_MS * 20) };
    for (const blocked of [
      { reviewDecision: "CHANGES_REQUESTED" },
      { checksState: "FAILURE" },
      { checksState: "ERROR" },
      { isDraft: true, checksState: "FAILURE" },
    ]) {
      const [node] = build(withMaster([branch({ name: "feature" })]), {
        viewerPrs: [viewerPr({ ...stale, ...blocked })],
      });
      expect(refs(node.live)).toContain("feature");
    }
  });

  it("parks a stale PR that only synthesized its own row", () => {
    // The window applies to rows the tree invents too, or an abandoned PR in a
    // repo with no local branch would still barge into the live zone.
    const [node] = build(withMaster(), {
      viewerPrs: [
        viewerPr({
          headRefName: "unseen",
          updatedAt: iso(COMMIT_BY_USER_WINDOW_MS + 1000),
        }),
      ],
    });
    expect(refs(node.live)).not.toContain("unseen");
    expect(refs(node.rest)).toContain("unseen");
  });

  it("still loses to a dismissal", () => {
    // Dismissing is the user overruling every derived reason; a PR arriving
    // afterwards must not quietly undo that.
    const [node] = build(withMaster([branch({ name: "feature" })]), {
      dismissed: ["/r:feature"],
      viewerPrs: [viewerPr()],
    });
    expect(refs(node.live)).not.toContain("feature");
    expect(refs(node.rest)).toContain("feature");
  });

  it("dismisses a synthesized row too", () => {
    const [node] = build(withMaster(), {
      dismissed: ["/r:unseen"],
      viewerPrs: [viewerPr({ headRefName: "unseen" })],
    });
    expect(refs(node.live)).not.toContain("unseen");
    expect(refs(node.rest)).toContain("unseen");
  });

  it("keeps PRs with no local repo out of the tree entirely", () => {
    const nodes = build(withMaster(), {
      viewerPrs: [
        viewerPr({ repoPath: null, repoNameWithOwner: "other/repo" }),
      ],
    });
    expect(nodes).toHaveLength(1);
    expect(nodes[0].repoPath).toBe("/r");
    expect([...nodes[0].live, ...nodes[0].rest]).toHaveLength(0);
  });
});

describe("the elsewhere bucket", () => {
  it("groups rowless PRs by repo, newest first, and skips the joined ones", () => {
    const groups = groupPrsElsewhere([
      viewerPr({ number: 1, repoPath: "/r" }),
      viewerPr({
        number: 2,
        repoPath: null,
        repoNameWithOwner: "a/one",
        updatedAt: iso(5000),
      }),
      viewerPr({
        number: 3,
        repoPath: null,
        repoNameWithOwner: "b/two",
        updatedAt: iso(1000),
      }),
      viewerPr({
        number: 4,
        repoPath: null,
        repoNameWithOwner: "a/one",
        updatedAt: iso(9000),
      }),
    ]);

    expect(groups.map((g) => g.repoNameWithOwner)).toEqual(["b/two", "a/one"]);
    expect(groups[1].prs.map((p) => p.number)).toEqual([2, 4]);
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
