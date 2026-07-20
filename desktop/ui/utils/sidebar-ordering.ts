/**
 * Shared sidebar ordering logic.
 *
 * Used by both the TabRail component (rendering) and keyboard navigation
 * (Cmd+1..9 shortcuts) to ensure consistent item order.
 *
 * Two-level grouping: orgs (e.g., "dropseed") contain repos; each repo has
 * three sections: Branches (all local branches, review progress shown when a
 * review exists), Pinned (reviews whose ref is not a local branch — SHAs,
 * tags, stashes, deleted branches), and Remote (recent). The "current
 * HEAD" lives at the top of Branches and is what gets activated when the user
 * clicks a collapsed repo row.
 *
 * A review's identity is its ref, so a branch and its review match iff
 * `review.ref === branch.name`.
 */

import {
  type LocalBranchInfo,
  type RepoLocalActivity,
  type RecentRemoteBranch,
  type GlobalReviewSummary,
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
  /** The review ref this branch maps to — its name. */
  ref: string;
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
  /** The review ref this remote branch maps to — its (unprefixed) name. */
  ref: string;
  reviewKey: string;
}

export type SidebarEntry =
  SidebarBranchEntry | SidebarReviewEntry | SidebarRemoteEntry;

export interface RepoGroup {
  repoPath: string;
  repoName: string;
  defaultBranch: string;
  /** All local branches — working-tree first, then worktrees, then review-
   *  backed branches, then plain branches. Review progress is shown per row
   *  when a review exists for that branch. */
  branches: SidebarBranchEntry[];
  /** Reviews whose ref is not a local branch (SHAs, tags, stashes,
   *  deleted/remote-only branches). */
  pinned: SidebarReviewEntry[];
  /** Remote-tracking branches with recent activity (deduped against branches). */
  remoteRecent: SidebarRemoteEntry[];
  /** Flattened in section order: branches → pinned → remoteRecent. */
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
      const key = makeReviewKey(repo.repoPath, branch.name);
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
        ref: branch.name,
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

  // 2. Add orphan reviews (refs that are not local branches — pinned section)
  const filteredOrphans = globalReviews.filter(
    (r) => !localKeys.has(makeReviewKey(r.repoPath, r.ref)),
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
      reviewKey: makeReviewKey(review.repoPath, review.ref),
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

    // One merged branch list: checked-out (working-tree first, then worktrees
    // by recency) → review-backed branches (by review updatedAt) → plain
    // branches (by recency). Progress is shown per row when a review exists.
    const branches: SidebarBranchEntry[] = [
      ...bucket.checkedOut,
      ...bucket.reviewBranches,
      ...bucket.branches,
    ];

    // Pinned = orphan reviews (refs that aren't local branches).
    const pinned = bucket.orphanReviews;

    // Remote (recent) — dedupe against any branch name already represented
    const claimedNames = new Set<string>();
    for (const e of branches) {
      claimedNames.add(e.branch.name);
    }
    for (const e of pinned) {
      claimedNames.add(e.review.ref);
    }
    const remoteRecent: SidebarRemoteEntry[] = bucket.recentRemote
      .filter((r) => !claimedNames.has(r.branchName))
      .map((r) => ({
        kind: "remote-recent" as const,
        remoteRef: r.remoteRef,
        branchName: r.branchName,
        lastCommitDate: r.lastCommitDate,
        repoPath: bucket.repoPath,
        repoName: bucket.repoName,
        defaultBranch: bucket.defaultBranch,
        ref: r.branchName,
        reviewKey: makeReviewKey(bucket.repoPath, r.branchName),
      }));

    const items: SidebarEntry[] = [...branches, ...pinned, ...remoteRecent];

    groups.push({
      repoPath: bucket.repoPath,
      repoName: bucket.repoName,
      defaultBranch: bucket.defaultBranch,
      branches,
      pinned,
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
        const head = repo.branches.find((e) => e.kind === "working-tree");
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
