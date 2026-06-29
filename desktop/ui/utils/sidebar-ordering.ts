/**
 * Shared sidebar ordering logic.
 *
 * Used by both the TabRail component (rendering) and keyboard navigation
 * (Cmd+1..9 shortcuts) to ensure consistent item order.
 *
 * Two-level grouping: orgs (e.g., "dropseed") contain repos; each repo has
 * three sections: In review, Local, Remote (recent). The "current HEAD" lives
 * at the top of Local and is what gets activated when the user clicks a
 * collapsed repo row.
 */

import {
  makeComparison,
  type LocalBranchInfo,
  type RepoLocalActivity,
  type RecentRemoteBranch,
  type GlobalReviewSummary,
  type Comparison,
  type DiffShortStat,
} from "../types";
import { makeReviewKey } from "../stores/slices/groupingSlice";
import type { ReviewSortOrder } from "../stores/slices/preferencesSlice";
import type { RepoMetadata } from "../stores/slices/tabRailSlice";
import { splitRoutePrefix } from "./repo-identity";

export type SidebarItemKind =
  "working-tree" | "worktree" | "review-branch" | "branch";

export interface SidebarBranchEntry {
  kind: SidebarItemKind;
  branch: LocalBranchInfo;
  repo: RepoLocalActivity;
  comparison: Comparison;
  reviewKey: string;
}

export interface SidebarReviewEntry {
  kind: "review";
  review: GlobalReviewSummary;
  reviewKey: string;
}

export interface SidebarRemoteEntry {
  kind: "remote-recent";
  remoteRef: string;
  branchName: string;
  lastCommitDate: string;
  repoPath: string;
  repoName: string;
  defaultBranch: string;
  comparison: Comparison;
  reviewKey: string;
}

export type SidebarEntry =
  SidebarBranchEntry | SidebarReviewEntry | SidebarRemoteEntry;

export interface RepoGroup {
  repoPath: string;
  repoName: string;
  defaultBranch: string;
  /** Saved reviews + branches that have a saved review backing them. */
  inReview: SidebarEntry[];
  /** Working-tree first, then worktrees, then plain local branches. */
  local: SidebarBranchEntry[];
  /** Remote-tracking branches with recent activity (deduped against local). */
  remoteRecent: SidebarRemoteEntry[];
  /** Flattened in section order: inReview → local → remoteRecent. */
  items: SidebarEntry[];
  /** Whether any item in this repo has uncommitted changes. */
  hasChanges: boolean;
  /** Most recent lastModifiedAt across working-tree changes (sort signal). */
  latestModifiedAt: number;
  /** Most recent commit/update timestamp in this repo (sort signal). */
  latestCommitDate: number;
  /** Unix seconds of the last `git fetch` for this repo, or null/undefined. */
  lastFetchedAt: number | null;
}

export interface OrgGroup {
  /** Org name (e.g., "dropseed") or "local" for repos with no remote. */
  org: string;
  isLocal: boolean;
  /** Org avatar — taken from the first repo that has one (GitHub repos in an
   *  org all share the same org avatar). Null for "local" repos. */
  avatarUrl: string | null;
  repos: RepoGroup[];
  hasChanges: boolean;
  latestModifiedAt: number;
  latestCommitDate: number;
}

/**
 * Build repo-grouped sidebar entries from local activity and global reviews.
 */
export function buildRepoGroups(
  localActivity: RepoLocalActivity[],
  globalReviews: GlobalReviewSummary[],
  globalReviewsByKey: Record<string, GlobalReviewSummary>,
  reviewSortOrder: ReviewSortOrder = "updated",
  reviewDiffStats: Record<string, DiffShortStat> = {},
): RepoGroup[] {
  const localKeys = new Set<string>();

  const repoMap = new Map<
    string,
    {
      repoPath: string;
      repoName: string;
      defaultBranch: string;
      checkedOut: SidebarBranchEntry[];
      reviewBranches: SidebarBranchEntry[];
      branches: SidebarBranchEntry[];
      orphanReviews: SidebarReviewEntry[];
      recentRemote: RecentRemoteBranch[];
      hasChanges: boolean;
      latestModifiedAt: number;
      latestCommitDate: number;
      lastFetchedAt: number | null;
    }
  >();

  function getOrCreateRepo(repo: RepoLocalActivity) {
    let bucket = repoMap.get(repo.repoPath);
    if (!bucket) {
      bucket = {
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        defaultBranch: repo.defaultBranch,
        checkedOut: [],
        reviewBranches: [],
        branches: [],
        orphanReviews: [],
        recentRemote: repo.recentRemoteBranches ?? [],
        hasChanges: false,
        latestModifiedAt: 0,
        latestCommitDate: 0,
        lastFetchedAt: repo.lastFetchedAt ?? null,
      };
      repoMap.set(repo.repoPath, bucket);
    }
    return bucket;
  }

  // 1. Group all local branches by repo
  for (const repo of localActivity) {
    const bucket = getOrCreateRepo(repo);

    for (const branch of repo.branches) {
      const comparison = makeComparison(repo.defaultBranch, branch.name);
      const key = makeReviewKey(repo.repoPath, comparison.key);
      localKeys.add(key);

      const hasWorktree = branch.isCurrent || branch.worktreePath != null;
      const hasReview = key in globalReviewsByKey;

      const entry: SidebarBranchEntry = {
        kind: branch.isCurrent
          ? "working-tree"
          : branch.worktreePath != null
            ? "worktree"
            : hasReview
              ? "review-branch"
              : "branch",
        branch,
        repo,
        comparison,
        reviewKey: key,
      };

      if (hasWorktree) {
        bucket.checkedOut.push(entry);
      } else if (hasReview) {
        bucket.reviewBranches.push(entry);
      } else {
        bucket.branches.push(entry);
      }

      if (branch.hasWorkingTreeChanges) {
        bucket.hasChanges = true;
        if (
          branch.lastModifiedAt != null &&
          branch.lastModifiedAt > bucket.latestModifiedAt
        ) {
          bucket.latestModifiedAt = branch.lastModifiedAt;
        }
      }

      const commitTime = new Date(branch.lastCommitDate).getTime();
      if (commitTime > bucket.latestCommitDate) {
        bucket.latestCommitDate = commitTime;
      }
    }
  }

  // 2. Add orphan reviews (not backed by local branches)
  const filteredOrphans = globalReviews.filter(
    (r) => !localKeys.has(makeReviewKey(r.repoPath, r.comparison.key)),
  );

  for (const review of filteredOrphans) {
    let bucket = repoMap.get(review.repoPath);
    if (!bucket) {
      bucket = {
        repoPath: review.repoPath,
        repoName: review.repoName,
        defaultBranch: "",
        checkedOut: [],
        reviewBranches: [],
        branches: [],
        orphanReviews: [],
        recentRemote: [],
        hasChanges: false,
        latestModifiedAt: 0,
        latestCommitDate: new Date(review.updatedAt).getTime(),
        lastFetchedAt: null,
      };
      repoMap.set(review.repoPath, bucket);
    }

    bucket.orphanReviews.push({
      kind: "review" as const,
      review,
      reviewKey: makeReviewKey(review.repoPath, review.comparison.key),
    });

    const updatedTime = new Date(review.updatedAt).getTime();
    if (updatedTime > bucket.latestCommitDate) {
      bucket.latestCommitDate = updatedTime;
    }
  }

  // 3. Build RepoGroup[] from the map
  const byBranchRecency = (a: SidebarBranchEntry, b: SidebarBranchEntry) =>
    new Date(b.branch.lastCommitDate).getTime() -
    new Date(a.branch.lastCommitDate).getTime();

  const groups: RepoGroup[] = [];

  for (const bucket of repoMap.values()) {
    // Working-tree first, then worktrees by recency
    bucket.checkedOut.sort((a, b) => {
      if (a.kind === "working-tree") return -1;
      if (b.kind === "working-tree") return 1;
      return byBranchRecency(a, b);
    });
    bucket.reviewBranches.sort(byBranchRecency);
    bucket.branches.sort(byBranchRecency);

    bucket.orphanReviews.sort((a, b) => {
      switch (reviewSortOrder) {
        case "size": {
          const sA = reviewDiffStats[a.reviewKey];
          const sB = reviewDiffStats[b.reviewKey];
          const sizeA = sA ? sA.additions + sA.deletions : a.review.totalHunks;
          const sizeB = sB ? sB.additions + sB.deletions : b.review.totalHunks;
          return sizeB - sizeA;
        }
        case "updated":
        default:
          return (
            new Date(b.review.updatedAt).getTime() -
            new Date(a.review.updatedAt).getTime()
          );
      }
    });

    // In review = review-backed branches + orphan reviews, sorted by updatedAt
    const inReview: SidebarEntry[] = [
      ...bucket.reviewBranches,
      ...bucket.orphanReviews,
    ].sort((a, b) => {
      const tA = getEntryUpdatedAt(a, globalReviewsByKey);
      const tB = getEntryUpdatedAt(b, globalReviewsByKey);
      return tB - tA;
    });

    // Local = checked-out + plain branches (working-tree pinned first)
    const local: SidebarBranchEntry[] = [
      ...bucket.checkedOut,
      ...bucket.branches,
    ];

    // Remote (recent) — dedupe against any branch name already represented
    const claimedNames = new Set<string>();
    for (const e of inReview) {
      const name = getEntryBranchName(e);
      if (name) claimedNames.add(name);
    }
    for (const e of local) {
      claimedNames.add(e.branch.name);
    }
    const remoteRecent: SidebarRemoteEntry[] = bucket.recentRemote
      .filter((r) => !claimedNames.has(r.branchName))
      .map((r) => {
        const comparison = makeComparison(bucket.defaultBranch, r.branchName);
        return {
          kind: "remote-recent" as const,
          remoteRef: r.remoteRef,
          branchName: r.branchName,
          lastCommitDate: r.lastCommitDate,
          repoPath: bucket.repoPath,
          repoName: bucket.repoName,
          defaultBranch: bucket.defaultBranch,
          comparison,
          reviewKey: makeReviewKey(bucket.repoPath, comparison.key),
        };
      });

    const items: SidebarEntry[] = [...inReview, ...local, ...remoteRecent];

    groups.push({
      repoPath: bucket.repoPath,
      repoName: bucket.repoName,
      defaultBranch: bucket.defaultBranch,
      inReview,
      local,
      remoteRecent,
      items,
      hasChanges: bucket.hasChanges,
      latestModifiedAt: bucket.latestModifiedAt,
      latestCommitDate: bucket.latestCommitDate,
      lastFetchedAt: bucket.lastFetchedAt,
    });
  }

  // Sort repos: repos with changes first (by most recent change), then by commit date
  groups.sort((a, b) => {
    if (a.hasChanges && !b.hasChanges) return -1;
    if (!a.hasChanges && b.hasChanges) return 1;
    if (a.hasChanges && b.hasChanges) {
      return b.latestModifiedAt - a.latestModifiedAt;
    }
    return b.latestCommitDate - a.latestCommitDate;
  });

  return groups;
}

function getEntryBranchName(entry: SidebarEntry): string | null {
  if (entry.kind === "review") return entry.review.comparison.head;
  if (entry.kind === "remote-recent") return entry.branchName;
  return entry.branch.name;
}

function getEntryUpdatedAt(
  entry: SidebarEntry,
  globalReviewsByKey: Record<string, GlobalReviewSummary>,
): number {
  if (entry.kind === "review") {
    return new Date(entry.review.updatedAt).getTime();
  }
  if (entry.kind === "remote-recent") {
    return new Date(entry.lastCommitDate).getTime();
  }
  // Branch entry — prefer backing review's updatedAt if present
  const review = globalReviewsByKey[entry.reviewKey];
  if (review) return new Date(review.updatedAt).getTime();
  return new Date(entry.branch.lastCommitDate).getTime();
}

/**
 * Bucket repo groups by their org (derived from RepoMetadata.routePrefix).
 * The first path segment of the route prefix is the org name. Repos with
 * "local/" prefix (no GitHub remote) land in a synthetic "local" org.
 */
export function buildOrgGroups(
  repoGroups: RepoGroup[],
  repoMetadata: Record<string, RepoMetadata>,
): OrgGroup[] {
  const orgMap = new Map<string, OrgGroup>();

  for (const repo of repoGroups) {
    const meta = repoMetadata[repo.repoPath];
    const prefix = meta?.routePrefix ?? `local/${repo.repoName || "repo"}`;
    const { org } = splitRoutePrefix(prefix);
    const isLocal = org === "local";

    let group = orgMap.get(org);
    if (!group) {
      group = {
        org,
        isLocal,
        avatarUrl: null,
        repos: [],
        hasChanges: false,
        latestModifiedAt: 0,
        latestCommitDate: 0,
      };
      orgMap.set(org, group);
    }
    group.repos.push(repo);
    if (!group.avatarUrl && meta?.avatarUrl) {
      group.avatarUrl = meta.avatarUrl;
    }
    if (repo.hasChanges) group.hasChanges = true;
    if (repo.latestModifiedAt > group.latestModifiedAt) {
      group.latestModifiedAt = repo.latestModifiedAt;
    }
    if (repo.latestCommitDate > group.latestCommitDate) {
      group.latestCommitDate = repo.latestCommitDate;
    }
  }

  const groups = Array.from(orgMap.values());

  // Same sort policy as repos: orgs with changes first, then by recency.
  groups.sort((a, b) => {
    if (a.hasChanges && !b.hasChanges) return -1;
    if (!a.hasChanges && b.hasChanges) return 1;
    if (a.hasChanges && b.hasChanges) {
      return b.latestModifiedAt - a.latestModifiedAt;
    }
    return b.latestCommitDate - a.latestCommitDate;
  });

  return groups;
}

/** Flatten repo groups into a single ordered list (for keyboard navigation). */
export function flattenRepoGroups(groups: RepoGroup[]): SidebarEntry[] {
  return groups.flatMap((g) => g.items);
}

/**
 * Flatten org groups respecting collapsed state. Used by keyboard navigation
 * so Cmd+1..9 walks the visible rows in render order.
 */
export function flattenOrgGroups(
  orgs: OrgGroup[],
  collapsedOrgs: Record<string, boolean>,
  collapsedRepos: Record<string, boolean>,
): SidebarEntry[] {
  const out: SidebarEntry[] = [];
  for (const org of orgs) {
    if (collapsedOrgs[org.org]) continue;
    for (const repo of org.repos) {
      if (collapsedRepos[repo.repoPath]) {
        // Collapsed repo: include only the working-tree entry (the row that
        // gets activated when the user clicks the collapsed repo header).
        const head = repo.local.find((e) => e.kind === "working-tree");
        if (head) out.push(head);
        continue;
      }
      for (const item of repo.items) {
        out.push(item);
      }
    }
  }
  return out;
}
