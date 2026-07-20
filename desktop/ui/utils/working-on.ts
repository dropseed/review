/**
 * Zone-1 "Working on" builder.
 *
 * Produces the flat, cross-repo list that answers "what am I working on right
 * now". Membership is DERIVED from git/review state — never configured — with
 * pin/dismiss as the only manual escape hatches. See the spec for the rules.
 *
 * This is a pure function (inject `now`) so the membership/ranking logic is
 * unit-testable without a store or clock.
 */

import {
  type LocalBranchInfo,
  type RepoLocalActivity,
  type GlobalReviewSummary,
} from "../types";
import { makeReviewKey } from "./review-key";
import type {
  SidebarBranchEntry,
  SidebarItemKind,
  SidebarReviewEntry,
} from "./sidebar-ordering";

const DAY_MS = 86_400_000;
/** A review touched within this window keeps its row in zone 1. */
export const REVIEW_ACTIVE_WINDOW_MS = 14 * DAY_MS;
/** A branch whose own tip commit is this fresh keeps its row in zone 1. */
export const COMMIT_BY_USER_WINDOW_MS = 7 * DAY_MS;

/** Why a row earned its place in zone 1 (union of rules; useful for tests). */
export type WorkingOnReason =
  "pinned" | "uncommitted" | "recent-review" | "recent-own-commit";

/**
 * A zone-1 row. `entry` is a ready-to-render sidebar entry (branch or review),
 * so the existing row components apply unchanged; the extra fields drive
 * ranking, dedup, and pin/dismiss.
 */
export interface WorkingOnEntry {
  reviewKey: string;
  repoPath: string;
  repoName: string;
  ref: string;
  entry: SidebarBranchEntry | SidebarReviewEntry;
  /** Ranking key: max(working-tree mtime, tip committer date, review updatedAt). */
  activityAt: number;
  pinned: boolean;
  reasons: WorkingOnReason[];
}

function parseTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function branchItemKind(
  branch: LocalBranchInfo,
  hasReview: boolean,
): SidebarItemKind {
  if (branch.isCurrent) return "working-tree";
  if (branch.worktreePath != null) return "worktree";
  return hasReview ? "review-branch" : "branch";
}

/**
 * Build the ranked zone-1 list.
 *
 * Precedence per key: pinned forces inclusion (and ranks first, in pin order);
 * otherwise a dismissed key is excluded; otherwise the derived rules (rule 1
 * uncommitted, rule 2 recent review, rule 3 recent own commit) decide.
 */
export function buildWorkingOn(
  localActivity: RepoLocalActivity[],
  globalReviews: GlobalReviewSummary[],
  pinnedKeys: string[],
  dismissedKeys: string[],
  now: number,
): WorkingOnEntry[] {
  const pinnedSet = new Set(pinnedKeys);
  const dismissedSet = new Set(dismissedKeys);
  /** pin order → rank; earlier in the array ranks first. */
  const pinOrder = new Map(pinnedKeys.map((k, i) => [k, i]));

  const reviewsByKey = new Map<string, GlobalReviewSummary>();
  for (const review of globalReviews) {
    reviewsByKey.set(makeReviewKey(review.repoPath, review.ref), review);
  }

  const localKeys = new Set<string>();
  const entries: WorkingOnEntry[] = [];

  // 1. Local branches — rules 1 (uncommitted) and 3 (recent own commit),
  //    plus rule 2 when the branch has a recently-touched review.
  for (const repo of localActivity) {
    for (const branch of repo.branches) {
      const key = makeReviewKey(repo.repoPath, branch.name);
      localKeys.add(key);

      const review = reviewsByKey.get(key);
      const hasReview = review != null;

      const reasons: WorkingOnReason[] = [];
      if (pinnedSet.has(key)) reasons.push("pinned");
      if (branch.hasWorkingTreeChanges) reasons.push("uncommitted");
      const tipAt = parseTime(branch.lastCommitDate);
      if (
        branch.lastCommitByUser &&
        tipAt > 0 &&
        now - tipAt <= COMMIT_BY_USER_WINDOW_MS
      ) {
        reasons.push("recent-own-commit");
      }
      const reviewAt = hasReview ? parseTime(review.updatedAt) : 0;
      if (reviewAt > 0 && now - reviewAt <= REVIEW_ACTIVE_WINDOW_MS) {
        reasons.push("recent-review");
      }

      if (!includeRow(key, reasons, pinnedSet, dismissedSet)) continue;

      const wtAt = branch.lastModifiedAt ?? 0;
      entries.push({
        reviewKey: key,
        repoPath: repo.repoPath,
        repoName: repo.repoName,
        ref: branch.name,
        entry: {
          kind: branchItemKind(branch, hasReview),
          branch,
          repo,
          ref: branch.name,
          reviewKey: key,
        },
        activityAt: Math.max(wtAt, tipAt, reviewAt),
        pinned: pinnedSet.has(key),
        reasons,
      });
    }
  }

  // 2. Orphan reviews (ref is not a local branch) — rule 2 only.
  for (const review of globalReviews) {
    const key = makeReviewKey(review.repoPath, review.ref);
    if (localKeys.has(key)) continue;

    const reviewAt = parseTime(review.updatedAt);
    const reasons: WorkingOnReason[] = [];
    if (pinnedSet.has(key)) reasons.push("pinned");
    if (reviewAt > 0 && now - reviewAt <= REVIEW_ACTIVE_WINDOW_MS) {
      reasons.push("recent-review");
    }

    if (!includeRow(key, reasons, pinnedSet, dismissedSet)) continue;

    entries.push({
      reviewKey: key,
      repoPath: review.repoPath,
      repoName: review.repoName,
      ref: review.ref,
      entry: { kind: "review", review, reviewKey: key },
      activityAt: reviewAt,
      pinned: pinnedSet.has(key),
      reasons,
    });
  }

  // Ranking: pinned first (in pin order), then most recent activity first.
  // Tie-break on reviewKey for a stable order.
  entries.sort((a, b) => {
    if (a.pinned && b.pinned) {
      return (
        (pinOrder.get(a.reviewKey) ?? 0) - (pinOrder.get(b.reviewKey) ?? 0)
      );
    }
    if (a.pinned) return -1;
    if (b.pinned) return 1;
    if (b.activityAt !== a.activityAt) return b.activityAt - a.activityAt;
    return a.reviewKey < b.reviewKey ? -1 : a.reviewKey > b.reviewKey ? 1 : 0;
  });

  return entries;
}

/**
 * Membership precedence: pinned wins, then dismiss excludes, then any derived
 * rule includes.
 */
function includeRow(
  key: string,
  reasons: WorkingOnReason[],
  pinnedSet: Set<string>,
  dismissedSet: Set<string>,
): boolean {
  if (pinnedSet.has(key)) return true;
  if (dismissedSet.has(key)) return false;
  return reasons.length > 0;
}
