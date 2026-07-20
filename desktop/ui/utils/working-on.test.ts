import { describe, it, expect } from "vitest";
import {
  buildWorkingOn,
  COMMIT_BY_USER_WINDOW_MS,
  REVIEW_ACTIVE_WINDOW_MS,
  type WorkingOnEntry,
} from "./working-on";
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
): GlobalReviewSummary {
  return {
    repoPath,
    repoName: repoPath.split("/").pop() ?? repoPath,
    ref,
    totalHunks: 10,
    trustedHunks: 0,
    approvedHunks: 0,
    reviewedHunks: 0,
    rejectedHunks: 0,
    savedForLaterHunks: 0,
    state: null,
    updatedAt: iso(updatedMsAgo),
  };
}

function keys(entries: WorkingOnEntry[]): string[] {
  return entries.map((e) => e.reviewKey);
}

describe("buildWorkingOn — membership rules", () => {
  it("rule 1: includes a checkout with uncommitted changes", () => {
    const activity = [
      repo("/r", [
        branch({ name: "main", isCurrent: true, hasWorkingTreeChanges: true }),
      ]),
    ];
    const out = buildWorkingOn(activity, [], [], [], NOW);
    expect(keys(out)).toEqual(["/r:main"]);
    expect(out[0].reasons).toContain("uncommitted");
  });

  it("rule 2: includes a branch whose review was updated within 14 days", () => {
    const activity = [repo("/r", [branch({ name: "feat" })])];
    const reviews = [review("/r", "feat", 10 * 86_400_000)];
    const out = buildWorkingOn(activity, reviews, [], [], NOW);
    expect(keys(out)).toEqual(["/r:feat"]);
    expect(out[0].reasons).toContain("recent-review");
  });

  it("rule 2: excludes a branch whose review is older than 14 days", () => {
    const activity = [repo("/r", [branch({ name: "feat" })])];
    const reviews = [
      review("/r", "feat", REVIEW_ACTIVE_WINDOW_MS + 86_400_000),
    ];
    const out = buildWorkingOn(activity, reviews, [], [], NOW);
    expect(out).toEqual([]);
  });

  it("rule 2: includes an orphan review (ref not a local branch)", () => {
    const reviews = [review("/r", "abc123", 3 * 86_400_000)];
    const out = buildWorkingOn([], reviews, [], [], NOW);
    expect(keys(out)).toEqual(["/r:abc123"]);
    expect(out[0].entry.kind).toBe("review");
  });

  it("rule 3: includes a branch whose own tip commit is within 7 days", () => {
    const activity = [
      repo("/r", [
        branch({
          name: "mine",
          lastCommitByUser: true,
          lastCommitDate: iso(2 * 86_400_000),
        }),
      ]),
    ];
    const out = buildWorkingOn(activity, [], [], [], NOW);
    expect(keys(out)).toEqual(["/r:mine"]);
    expect(out[0].reasons).toContain("recent-own-commit");
  });

  it("rule 3: excludes own commit older than 7 days", () => {
    const activity = [
      repo("/r", [
        branch({
          name: "mine",
          lastCommitByUser: true,
          lastCommitDate: iso(COMMIT_BY_USER_WINDOW_MS + 86_400_000),
        }),
      ]),
    ];
    expect(buildWorkingOn(activity, [], [], [], NOW)).toEqual([]);
  });

  it("rule 3: excludes a recent commit that is NOT by the user", () => {
    const activity = [
      repo("/r", [
        branch({
          name: "theirs",
          lastCommitByUser: false,
          lastCommitDate: iso(1 * 86_400_000),
        }),
      ]),
    ];
    expect(buildWorkingOn(activity, [], [], [], NOW)).toEqual([]);
  });
});

describe("buildWorkingOn — pin / dismiss", () => {
  it("rule 4: a pinned key is always included, even when no rule matches", () => {
    const activity = [repo("/r", [branch({ name: "stale" })])];
    const out = buildWorkingOn(activity, [], ["/r:stale"], [], NOW);
    expect(keys(out)).toEqual(["/r:stale"]);
    expect(out[0].pinned).toBe(true);
    expect(out[0].reasons).toContain("pinned");
  });

  it("rule 5: a dismissed key is excluded even with uncommitted changes", () => {
    const activity = [
      repo("/r", [
        branch({ name: "main", isCurrent: true, hasWorkingTreeChanges: true }),
      ]),
    ];
    const out = buildWorkingOn(activity, [], [], ["/r:main"], NOW);
    expect(out).toEqual([]);
  });

  it("pin wins over dismiss when a key is in both sets", () => {
    const activity = [repo("/r", [branch({ name: "feat" })])];
    const out = buildWorkingOn(activity, [], ["/r:feat"], ["/r:feat"], NOW);
    expect(keys(out)).toEqual(["/r:feat"]);
  });
});

describe("buildWorkingOn — ranking", () => {
  it("ranks pinned rows first, in pin order, ahead of fresher activity", () => {
    const activity = [
      repo("/r", [
        branch({ name: "hot", isCurrent: true, hasWorkingTreeChanges: true }),
        branch({ name: "p1" }),
        branch({ name: "p2" }),
      ]),
    ];
    const out = buildWorkingOn(activity, [], ["/r:p2", "/r:p1"], [], NOW);
    // Pinned in pin order first (p2 then p1), then the active "hot" row.
    expect(keys(out)).toEqual(["/r:p2", "/r:p1", "/r:hot"]);
  });

  it("orders non-pinned rows by most recent activity first", () => {
    const activity = [
      repo("/r", [
        branch({
          name: "older",
          lastCommitByUser: true,
          lastCommitDate: iso(5 * 86_400_000),
        }),
        branch({
          name: "newer",
          lastCommitByUser: true,
          lastCommitDate: iso(1 * 86_400_000),
        }),
      ]),
    ];
    const out = buildWorkingOn(activity, [], [], [], NOW);
    expect(keys(out)).toEqual(["/r:newer", "/r:older"]);
  });

  it("activityAt is the max of working-tree mtime, tip date, and review date", () => {
    const wtAt = NOW - 1 * 86_400_000;
    const activity = [
      repo("/r", [
        branch({
          name: "feat",
          isCurrent: true,
          hasWorkingTreeChanges: true,
          lastModifiedAt: wtAt,
          lastCommitDate: iso(10 * 86_400_000),
        }),
      ]),
    ];
    const reviews = [review("/r", "feat", 4 * 86_400_000)];
    const out = buildWorkingOn(activity, reviews, [], [], NOW);
    expect(out[0].activityAt).toBe(wtAt);
  });
});

describe("buildWorkingOn — dedup across repos", () => {
  it("keeps rows from different repos with the same ref distinct", () => {
    const activity = [
      repo("/a", [
        branch({ name: "main", isCurrent: true, hasWorkingTreeChanges: true }),
      ]),
      repo("/b", [
        branch({ name: "main", isCurrent: true, hasWorkingTreeChanges: true }),
      ]),
    ];
    const out = buildWorkingOn(activity, [], [], [], NOW);
    expect(new Set(keys(out))).toEqual(new Set(["/a:main", "/b:main"]));
  });

  it("does not duplicate a branch that also has a review", () => {
    const activity = [repo("/r", [branch({ name: "feat" })])];
    const reviews = [review("/r", "feat", 2 * 86_400_000)];
    const out = buildWorkingOn(activity, reviews, [], [], NOW);
    expect(keys(out)).toEqual(["/r:feat"]);
    expect(out[0].entry.kind).not.toBe("review"); // rendered as the branch row
  });
});
