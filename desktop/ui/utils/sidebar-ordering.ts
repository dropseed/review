/**
 * Shared sidebar ordering logic.
 *
 * Used by both the TabRail component (rendering) and keyboard navigation
 * (Cmd+1..9 shortcuts) to ensure consistent item order.
 *
 * Items are grouped by repository. Within each repo, items are ordered:
 * checked-out first, then reviews, then plain branches.
 *
 * Repos are sorted: repos with working-tree changes first (by most recent
 * change), then repos without changes (by most recent commit).
 */

import {
  makeComparison,
  type LocalBranchInfo,
  type RepoLocalActivity,
  type GlobalReviewSummary,
  type Comparison,
  type DiffShortStat,
} from "../types";
import { makeReviewKey } from "../stores/slices/groupingSlice";
import type { ReviewSortOrder } from "../stores/slices/preferencesSlice";

export type SidebarItemKind =
  | "working-tree"
  | "worktree"
  | "review-branch"
  | "branch";

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

export type SidebarEntry = SidebarBranchEntry | SidebarReviewEntry;

/** Sub-group of entries sharing the same merge target (comparison.base). */
export interface BaseGroup {
  base: string;
  isDefault: boolean;
  items: SidebarEntry[];
}

export interface RepoGroup {
  repoPath: string;
  repoName: string;
  defaultBranch: string;
  /** All items in this repo, ordered: checked-out first, then reviews, then branches */
  items: SidebarEntry[];
  /** Items grouped by their merge target */
  baseGroups: BaseGroup[];
  /** Whether any item in this repo has uncommitted changes */
  hasChanges: boolean;
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
  // Track which review keys are backed by local branches
  const localKeys = new Set<string>();

  // Accumulate items per repo (keyed by repoPath)
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
      hasChanges: boolean;
      /** Most recent lastModifiedAt for working tree changes (for sorting repos with changes) */
      latestModifiedAt: number;
      /** Most recent lastCommitDate across all branches (for sorting repos without changes) */
      latestCommitDate: number;
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
        hasChanges: false,
        latestModifiedAt: 0,
        latestCommitDate: 0,
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

      // 2. Categorize branches
      if (hasWorktree) {
        bucket.checkedOut.push(entry);
      } else if (hasReview) {
        bucket.reviewBranches.push(entry);
      } else {
        bucket.branches.push(entry);
      }

      // Track changes
      if (branch.hasWorkingTreeChanges) {
        bucket.hasChanges = true;
        if (
          branch.lastModifiedAt != null &&
          branch.lastModifiedAt > bucket.latestModifiedAt
        ) {
          bucket.latestModifiedAt = branch.lastModifiedAt;
        }
      }

      // Track most recent commit date
      const commitTime = new Date(branch.lastCommitDate).getTime();
      if (commitTime > bucket.latestCommitDate) {
        bucket.latestCommitDate = commitTime;
      }
    }
  }

  // 3. Add orphan reviews (not backed by local branches) to their respective repo groups
  const filteredOrphans = globalReviews.filter(
    (r) => !localKeys.has(makeReviewKey(r.repoPath, r.comparison.key)),
  );

  // Group orphans by repoPath
  for (const review of filteredOrphans) {
    let bucket = repoMap.get(review.repoPath);
    if (!bucket) {
      // Repo not in localActivity — create a bucket for orphan-only repos
      bucket = {
        repoPath: review.repoPath,
        repoName: review.repoName,
        defaultBranch: "", // Unknown for orphan-only repos
        checkedOut: [],
        reviewBranches: [],
        branches: [],
        orphanReviews: [],
        hasChanges: false,
        latestModifiedAt: 0,
        latestCommitDate: new Date(review.updatedAt).getTime(),
      };
      repoMap.set(review.repoPath, bucket);
    }

    bucket.orphanReviews.push({
      kind: "review" as const,
      review,
      reviewKey: makeReviewKey(review.repoPath, review.comparison.key),
    });

    // Update latest commit date from orphan review's updatedAt
    const updatedTime = new Date(review.updatedAt).getTime();
    if (updatedTime > bucket.latestCommitDate) {
      bucket.latestCommitDate = updatedTime;
    }
  }

  // 4. Build RepoGroup[] from the map
  const byRecency = (a: SidebarBranchEntry, b: SidebarBranchEntry) =>
    new Date(b.branch.lastCommitDate).getTime() -
    new Date(a.branch.lastCommitDate).getTime();

  const groups: RepoGroup[] = [];

  for (const bucket of repoMap.values()) {
    // Sort within each category
    // Working tree always first in checked-out, then worktrees by recency
    bucket.checkedOut.sort((a, b) => {
      if (a.kind === "working-tree") return -1;
      if (b.kind === "working-tree") return 1;
      return byRecency(a, b);
    });
    bucket.reviewBranches.sort(byRecency);
    bucket.branches.sort(byRecency);

    // Sort orphan reviews within this repo
    bucket.orphanReviews.sort((a, b) => {
      switch (reviewSortOrder) {
        case "size": {
          const keyA = a.reviewKey;
          const keyB = b.reviewKey;
          const sA = reviewDiffStats[keyA];
          const sB = reviewDiffStats[keyB];
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

    // Combine: checked-out first, then review branches + orphan reviews, then plain branches
    const items: SidebarEntry[] = [
      ...bucket.checkedOut,
      ...bucket.reviewBranches,
      ...bucket.orphanReviews,
      ...bucket.branches,
    ];

    groups.push({
      repoPath: bucket.repoPath,
      repoName: bucket.repoName,
      defaultBranch: bucket.defaultBranch,
      items,
      baseGroups: groupByBase(items, bucket.defaultBranch),
      hasChanges: bucket.hasChanges,
    });
  }

  // 5. Sort repos: repos with changes first (by most recent change), then without (by most recent commit)
  groups.sort((a, b) => {
    const bucketA = repoMap.get(a.repoPath)!;
    const bucketB = repoMap.get(b.repoPath)!;

    if (a.hasChanges && !b.hasChanges) return -1;
    if (!a.hasChanges && b.hasChanges) return 1;

    if (a.hasChanges && b.hasChanges) {
      // Both have changes — sort by most recent modification
      return bucketB.latestModifiedAt - bucketA.latestModifiedAt;
    }

    // Neither has changes — sort by most recent commit
    return bucketB.latestCommitDate - bucketA.latestCommitDate;
  });

  return groups;
}

/** Get the comparison base ref from a sidebar entry. */
function getEntryBase(entry: SidebarEntry): string {
  return entry.kind === "review"
    ? entry.review.comparison.base
    : entry.comparison.base;
}

/** Group entries by their merge target (comparison.base). */
function groupByBase(
  items: SidebarEntry[],
  defaultBranch: string,
): BaseGroup[] {
  const map = new Map<string, SidebarEntry[]>();

  for (const item of items) {
    const base = getEntryBase(item);
    let list = map.get(base);
    if (!list) {
      list = [];
      map.set(base, list);
    }
    list.push(item);
  }

  const groups: BaseGroup[] = [];
  for (const [base, entries] of map) {
    groups.push({
      base,
      isDefault: base === defaultBranch,
      items: entries,
    });
  }

  // Default branch group first, then alphabetical
  groups.sort((a, b) => {
    if (a.isDefault && !b.isDefault) return -1;
    if (!a.isDefault && b.isDefault) return 1;
    return a.base.localeCompare(b.base);
  });

  return groups;
}

/** Flatten repo groups into a single ordered list (for keyboard navigation). */
export function flattenRepoGroups(groups: RepoGroup[]): SidebarEntry[] {
  return groups.flatMap((g) => g.items);
}
