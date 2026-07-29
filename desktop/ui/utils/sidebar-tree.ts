/**
 * The sidebar tree.
 *
 * One structure, repo-rooted: a repo's row *is* its repo-root checkout, and
 * everything in that repo — linked worktrees, PRs, reviews, plain branches —
 * hangs beneath it. There is no separate "what am I working on" list.
 * Liveness is a property of a row, so a row that isn't live sits one `⋯ more`
 * click away instead of in another section.
 *
 * Why one structure: the sidebar used to build the same branch twice, from two
 * independent builders feeding two zones. Nothing could then answer "where does
 * this row live on disk" without re-deriving it, and the re-derivations
 * disagreed — a branch checked out at the repo root read as "no checkout yet"
 * to anything that only consulted saved review state. Every row here carries
 * `checkoutPath`, and that is the answer everywhere: terminals, LSP, staging.
 *
 * Pure functions (inject `now`) so membership, ranking, and ordering are
 * testable without a store or a clock.
 */

import {
  type LocalBranchInfo,
  type RepoLocalActivity,
  type RecentRemoteBranch,
  type GlobalReviewSummary,
} from "../types";
import { makeReviewKey } from "./review-key";

const DAY_MS = 86_400_000;
/** A review touched within this window keeps its row live. */
export const REVIEW_ACTIVE_WINDOW_MS = 14 * DAY_MS;
/** A branch whose own tip commit is this fresh keeps its row live. */
export const COMMIT_BY_USER_WINDOW_MS = 7 * DAY_MS;

/** What a row is, for the row components that render it. */
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

/**
 * Why a row is live (union of rules; useful for tests and tooltips).
 *
 * `checkout` means a *deliberate* checkout — a linked or review-managed
 * worktree, which someone had to create on purpose. It deliberately excludes
 * the branch that merely happens to be at the repo root: every repo has one of
 * those forever, so counting it made every registered repo permanently
 * "Active" and the section meant nothing.
 *
 * `open-repo` is the exception that keeps that rule safe: quiet repos are
 * *hidden*, not merely demoted, so without it the repo you are looking at
 * right now can drop out of its own sidebar — a clean default branch you
 * opened with `review .`, or a fresh clone, satisfies none of the other rules.
 */
export type LiveReason =
  | "pinned"
  | "open-repo"
  | "checkout"
  | "uncommitted"
  | "recent-review"
  | "recent-own-commit"
  /**
   * A shell is running in this row's checkout right now. The strongest
   * evidence there is that someone is working here — stronger than any of the
   * time-window rules, which only say someone *was*. It deliberately affects
   * membership and nothing else: terminal phase changes every few seconds, so
   * ranking on it would reshuffle the list under the cursor, which is the
   * failure the ordering rules below were written to avoid.
   */
  | "terminal";

/**
 * How present a row is locally — the tier ladder, as a display concern.
 * `checkout` has files on disk, `review` has a review record but no checkout,
 * `ref` is just a ref we know about.
 */
export type RowPresence = "checkout" | "review" | "ref";

export interface SidebarRow {
  reviewKey: string;
  repoPath: string;
  ref: string;
  /** Ready-to-render entry, so the row components apply unchanged. */
  entry: SidebarEntry;
  /**
   * Where this row lives on disk, or null when it has no checkout. The single
   * definition — terminals, LSP, and staging all read this rather than
   * re-deriving from review state.
   */
  checkoutPath: string | null;
  presence: RowPresence;
  /** Ranking key: max(working-tree mtime, tip committer date, review updatedAt). */
  activityAt: number;
  pinned: boolean;
  reasons: LiveReason[];
  /** Shown without expanding the repo's `⋯ more`. */
  live: boolean;
}

export interface RepoNode {
  repoPath: string;
  repoName: string;
  defaultBranch: string;
  /**
   * The repo-root checkout — this node's own row. Null only for a repo we know
   * solely through reviews (no local branch listing).
   */
  head: SidebarRow | null;
  /** Rows shown beneath the repo row, `head` excluded. */
  live: SidebarRow[];
  /** Everything else, behind the repo's inline `⋯ more` toggle. */
  rest: SidebarRow[];
  /**
   * Every checkout root in the repo — the repo itself plus each row's
   * `checkoutPath`. Terminal sessions are attributed to the *innermost* root,
   * so a row needs the whole set, not just its own: worktrees can live under
   * the repo root, and a prefix test alone would let the repo row claim them.
   */
  checkouts: string[];
  lastFetchedAt: number | null;
  hasChanges: boolean;
  /** Has anything live: drives default expansion and top-of-list placement. */
  isActive: boolean;
  /**
   * Best (lowest) pin position among this repo's rows, or null when none are
   * pinned. Repos with a pin lead the list, ordered by the pin the user put
   * first — pinning is the one ordering signal they control by hand, so it
   * outranks everything derived.
   */
  pinRank: number | null;
}

function parseTime(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function presenceRank(presence: RowPresence): number {
  return presence === "checkout" ? 0 : presence === "review" ? 1 : 2;
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
 * Membership precedence: pinned wins, then dismiss excludes, then any derived
 * reason includes.
 */
function isLive(
  key: string,
  reasons: LiveReason[],
  pinnedSet: Set<string>,
  dismissedSet: Set<string>,
): boolean {
  if (pinnedSet.has(key)) return true;
  if (dismissedSet.has(key)) return false;
  return reasons.length > 0;
}

/**
 * Build the repo-rooted sidebar tree.
 *
 * `openRepoPath` is the repo this window currently has open. It's an input
 * because liveness is otherwise derived from git and review state alone, and
 * none of those rules can see "you are looking at it".
 */
export function buildSidebarTree(
  localActivity: RepoLocalActivity[],
  globalReviews: GlobalReviewSummary[],
  globalReviewsByKey: Record<string, GlobalReviewSummary>,
  pinnedKeys: string[],
  dismissedKeys: string[],
  now: number,
  openRepoPath: string | null = null,
  /** Review keys whose checkout currently hosts a live terminal session. */
  terminalKeys: readonly string[] = [],
): RepoNode[] {
  const pinnedSet = new Set(pinnedKeys);
  const dismissedSet = new Set(dismissedKeys);
  const terminalSet = new Set(terminalKeys);
  /** pin order → rank; earlier in the array ranks first. */
  const pinOrder = new Map(pinnedKeys.map((k, i) => [k, i]));

  interface Bucket {
    repoPath: string;
    repoName: string;
    defaultBranch: string;
    head: SidebarRow | null;
    rows: SidebarRow[];
    recentRemote: RecentRemoteBranch[];
    lastFetchedAt: number | null;
    hasChanges: boolean;
  }

  const buckets = new Map<string, Bucket>();
  const localKeys = new Set<string>();

  function bucketFor(
    repoPath: string,
    repoName: string,
    defaultBranch: string,
  ): Bucket {
    let bucket = buckets.get(repoPath);
    if (!bucket) {
      bucket = {
        repoPath,
        repoName,
        defaultBranch,
        head: null,
        rows: [],
        recentRemote: [],
        lastFetchedAt: null,
        hasChanges: false,
      };
      buckets.set(repoPath, bucket);
    }
    return bucket;
  }

  // 1. Local branches. The current branch becomes the repo's own row; the rest
  //    hang beneath it.
  for (const repo of localActivity) {
    const bucket = bucketFor(repo.repoPath, repo.repoName, repo.defaultBranch);
    bucket.recentRemote = repo.recentRemoteBranches ?? [];
    bucket.lastFetchedAt = repo.lastFetchedAt ?? null;

    for (const branch of repo.branches) {
      const key = makeReviewKey(repo.repoPath, branch.name);
      localKeys.add(key);

      const review = globalReviewsByKey[key];
      const hasReview = review != null;

      // A branch checked out at the repo root has a checkout just as much as
      // one in a linked worktree — the main worktree is still a worktree.
      const checkoutPath = branch.isCurrent
        ? repo.repoPath
        : (branch.worktreePath ?? null);
      // …but only the linked worktree is *evidence of intent*. Having a
      // checkout and being live are separate questions: `checkoutPath` answers
      // "where are the files" (terminals, LSP, staging all read it), while
      // liveness asks "did someone do something here". `isCurrent` excludes the
      // main worktree, which git reports as a worktree like any other.
      const isDeliberateCheckout =
        !branch.isCurrent && branch.worktreePath != null;

      const reasons: LiveReason[] = [];
      if (pinnedSet.has(key)) reasons.push("pinned");
      // The repo you have open is live by definition. Its row is the repo-root
      // checkout, so this lands on the current branch — and only for that one
      // repo, which is what keeps the rest of the staleness rules honest.
      if (branch.isCurrent && repo.repoPath === openRepoPath) {
        reasons.push("open-repo");
      }
      if (isDeliberateCheckout) reasons.push("checkout");
      if (terminalSet.has(key)) reasons.push("terminal");
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

      const row: SidebarRow = {
        reviewKey: key,
        repoPath: repo.repoPath,
        ref: branch.name,
        entry: {
          kind: branchItemKind(branch, hasReview),
          branch,
          repo,
          ref: branch.name,
          reviewKey: key,
        },
        checkoutPath,
        presence: checkoutPath ? "checkout" : hasReview ? "review" : "ref",
        activityAt: Math.max(branch.lastModifiedAt ?? 0, tipAt, reviewAt),
        pinned: pinnedSet.has(key),
        reasons,
        live: isLive(key, reasons, pinnedSet, dismissedSet),
      };

      if (branch.isCurrent) bucket.head = row;
      else bucket.rows.push(row);

      if (branch.hasWorkingTreeChanges) bucket.hasChanges = true;
    }
  }

  // 2. Reviews whose ref is not a local branch — SHAs, tags, stashes, PRs from
  //    forks, deleted branches.
  for (const review of globalReviews) {
    const key = makeReviewKey(review.repoPath, review.ref);
    if (localKeys.has(key)) continue;

    const bucket = bucketFor(review.repoPath, review.repoName, "");
    const reviewAt = parseTime(review.updatedAt);
    const checkoutPath = review.worktreePath ?? null;

    const reasons: LiveReason[] = [];
    if (pinnedSet.has(key)) reasons.push("pinned");
    if (checkoutPath) reasons.push("checkout");
    if (terminalSet.has(key)) reasons.push("terminal");
    if (reviewAt > 0 && now - reviewAt <= REVIEW_ACTIVE_WINDOW_MS) {
      reasons.push("recent-review");
    }

    bucket.rows.push({
      reviewKey: key,
      repoPath: review.repoPath,
      ref: review.ref,
      entry: { kind: "review", review, reviewKey: key },
      checkoutPath,
      presence: checkoutPath ? "checkout" : "review",
      activityAt: reviewAt,
      pinned: pinnedSet.has(key),
      reasons,
      live: isLive(key, reasons, pinnedSet, dismissedSet),
    });
  }

  // 3. Recent remote branches, deduped against everything already represented.
  for (const bucket of buckets.values()) {
    const claimed = new Set<string>(bucket.rows.map((r) => r.ref));
    if (bucket.head) claimed.add(bucket.head.ref);

    for (const remote of bucket.recentRemote) {
      if (claimed.has(remote.branchName)) continue;
      const key = makeReviewKey(bucket.repoPath, remote.branchName);
      const reasons: LiveReason[] = pinnedSet.has(key) ? ["pinned"] : [];

      bucket.rows.push({
        reviewKey: key,
        repoPath: bucket.repoPath,
        ref: remote.branchName,
        entry: {
          kind: "remote-recent",
          remoteRef: remote.remoteRef,
          branchName: remote.branchName,
          lastCommitDate: remote.lastCommitDate,
          repoPath: bucket.repoPath,
          repoName: bucket.repoName,
          defaultBranch: bucket.defaultBranch,
          ref: remote.branchName,
          reviewKey: key,
        },
        checkoutPath: null,
        presence: "ref",
        activityAt: parseTime(remote.lastCommitDate),
        pinned: pinnedSet.has(key),
        reasons,
        live: isLive(key, reasons, pinnedSet, dismissedSet),
      });
    }
  }

  // 4. Split each bucket into live/rest and rank.
  const byRank = (a: SidebarRow, b: SidebarRow): number => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    if (a.pinned && b.pinned) {
      return (
        (pinOrder.get(a.reviewKey) ?? 0) - (pinOrder.get(b.reviewKey) ?? 0)
      );
    }
    const rank = presenceRank(a.presence) - presenceRank(b.presence);
    if (rank !== 0) return rank;
    if (b.activityAt !== a.activityAt) return b.activityAt - a.activityAt;
    return a.reviewKey < b.reviewKey ? -1 : a.reviewKey > b.reviewKey ? 1 : 0;
  };

  const nodes: RepoNode[] = [];
  for (const bucket of buckets.values()) {
    const live = bucket.rows.filter((r) => r.live).sort(byRank);
    const rest = bucket.rows.filter((r) => !r.live).sort(byRank);

    // The repo root counts even when nothing is checked out there (a bare or
    // freshly-cloned repo still anchors session attribution).
    const checkouts = new Set<string>([bucket.repoPath]);
    let pinRank: number | null = null;
    for (const row of [bucket.head, ...bucket.rows]) {
      if (!row) continue;
      if (row.checkoutPath) checkouts.add(row.checkoutPath);
      const rank = pinOrder.get(row.reviewKey);
      if (rank !== undefined && (pinRank === null || rank < pinRank)) {
        pinRank = rank;
      }
    }

    nodes.push({
      repoPath: bucket.repoPath,
      repoName: bucket.repoName,
      defaultBranch: bucket.defaultBranch,
      head: bucket.head,
      live,
      rest,
      checkouts: [...checkouts],
      lastFetchedAt: bucket.lastFetchedAt,
      hasChanges: bucket.hasChanges,
      // Stated separately from the head row's liveness so it survives a repo
      // with nothing checked out (no head row at all) and a head row the user
      // dismissed: an inactive repo is hidden, and hiding the repo on screen
      // is never the right answer.
      isActive:
        bucket.repoPath === openRepoPath ||
        (bucket.head?.live ?? false) ||
        live.length > 0,
      pinRank,
    });
  }

  // 5. Three bands: repos you pinned something in, then active repos, then the
  //    rest. Pinned leads because it's the only ordering the user states
  //    outright — everything below it is inferred, and an inference shouldn't
  //    outrank an instruction. Pinned repos follow pin order; the other two
  //    bands stay alphabetical, deliberately *not* by recency: ordering by
  //    last-touched made the list reshuffle under the cursor while you worked,
  //    and a stable position is worth more than a fresh one.
  const pinBand = (node: RepoNode): number => node.pinRank ?? Infinity;
  nodes.sort((a, b) => {
    if (pinBand(a) !== pinBand(b)) return pinBand(a) - pinBand(b);
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    const byName = a.repoName.localeCompare(b.repoName);
    if (byName !== 0) return byName;
    return a.repoPath < b.repoPath ? -1 : a.repoPath > b.repoPath ? 1 : 0;
  });

  return nodes;
}

/**
 * Whether a repo's children are showing. Active repos default to expanded,
 * inactive ones to collapsed; `collapsedRepos` holds only explicit overrides,
 * so a repo going quiet re-collapses unless the user pinned it open.
 */
export function isRepoExpanded(
  collapsedRepos: Record<string, boolean>,
  node: RepoNode,
): boolean {
  const override = collapsedRepos[node.repoPath];
  return override === undefined ? node.isActive : !override;
}

/** The rows keyboard navigation walks, in render order. */
export function flattenSidebarTree(
  nodes: RepoNode[],
  collapsedRepos: Record<string, boolean>,
  expandedRest: Record<string, boolean>,
  showInactiveRepos: boolean,
): SidebarRow[] {
  const out: SidebarRow[] = [];
  for (const node of nodes) {
    if (!node.isActive && !showInactiveRepos) continue;
    if (node.head) out.push(node.head);
    if (!isRepoExpanded(collapsedRepos, node)) continue;
    out.push(...node.live);
    if (expandedRest[node.repoPath]) out.push(...node.rest);
  }
  return out;
}
