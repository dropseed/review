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
  | "open-repo"
  | "checkout"
  | "uncommitted"
  | "recent-review"
  | "recent-own-commit"
  /**
   * A shell is running in this row's checkout right now — the strongest
   * evidence there is that someone is working here, where every time-window
   * rule only says someone *was*. It also lifts the row's repo to the top of
   * the list; step 5 has the ordering rationale.
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
  reasons: LiveReason[];
  /** Shown without expanding the repo's `⋯ more`. */
  live: boolean;
}

/** The one spelling of "a shell is running here", shared by tree and rail. */
export function isTerminalRow(row: SidebarRow): boolean {
  return row.reasons.includes("terminal");
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
  lastFetchedAt: number | null;
  hasChanges: boolean;
  /** Has anything live: drives default expansion and top-of-list placement. */
  isActive: boolean;
  /**
   * A shell is running in one of this repo's checkouts. Leads the ordering —
   * see step 5.
   */
  hasActiveTerminal: boolean;
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
 * Membership precedence: a dismiss excludes, then any derived reason includes.
 */
function isLive(
  key: string,
  reasons: LiveReason[],
  dismissedSet: Set<string>,
): boolean {
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
  dismissedKeys: string[],
  now: number,
  openRepoPath: string | null = null,
  /** Review keys whose checkout currently hosts a live terminal session. */
  terminalKeys: readonly string[] = [],
): RepoNode[] {
  const dismissedSet = new Set(dismissedKeys);
  const terminalSet = new Set(terminalKeys);

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
        reasons,
        live: isLive(key, reasons, dismissedSet),
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
      reasons,
      live: isLive(key, reasons, dismissedSet),
    });
  }

  // 3. Recent remote branches, deduped against everything already represented.
  for (const bucket of buckets.values()) {
    const claimed = new Set<string>(bucket.rows.map((r) => r.ref));
    if (bucket.head) claimed.add(bucket.head.ref);

    for (const remote of bucket.recentRemote) {
      if (claimed.has(remote.branchName)) continue;
      const key = makeReviewKey(bucket.repoPath, remote.branchName);

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
        // A remote branch we haven't touched is never live: none of the rules
        // can fire on one, so it always starts behind the `⋯ more` toggle.
        reasons: [],
        live: false,
      });
    }
  }

  // 4. Split each bucket into live/rest and rank.
  const byRank = (a: SidebarRow, b: SidebarRow): number => {
    const rank = presenceRank(a.presence) - presenceRank(b.presence);
    if (rank !== 0) return rank;
    if (b.activityAt !== a.activityAt) return b.activityAt - a.activityAt;
    return a.reviewKey < b.reviewKey ? -1 : a.reviewKey > b.reviewKey ? 1 : 0;
  };

  const nodes: RepoNode[] = [];
  for (const bucket of buckets.values()) {
    const live = bucket.rows.filter((r) => r.live).sort(byRank);
    const rest = bucket.rows.filter((r) => !r.live).sort(byRank);

    nodes.push({
      repoPath: bucket.repoPath,
      repoName: bucket.repoName,
      defaultBranch: bucket.defaultBranch,
      head: bucket.head,
      live,
      rest,
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
      hasActiveTerminal: [bucket.head, ...bucket.rows].some(
        (row) => row != null && isTerminalRow(row),
      ),
    });
  }

  // 5. Three bands: repos with a shell running in them, then the rest of the
  //    active ones, then the quiet ones. A running shell leads because it's the
  //    strongest evidence of where the work is. Note that it's the shell's
  //    *liveness* that ranks, never its phase: a shell is either running or it
  //    isn't, whereas phase flips between working and idle every few seconds,
  //    and ranking on that would reshuffle the list under the cursor. Every
  //    band is alphabetical for the same reason, deliberately *not* by
  //    recency: ordering by last-touched made the list reshuffle while you
  //    worked, and a stable position is worth more than a fresh one.
  const band = (node: RepoNode): number =>
    node.hasActiveTerminal ? 0 : node.isActive ? 1 : 2;
  nodes.sort((a, b) => {
    const byBand = band(a) - band(b);
    if (byBand !== 0) return byBand;
    const byName = a.repoName.localeCompare(b.repoName);
    if (byName !== 0) return byName;
    return a.repoPath < b.repoPath ? -1 : a.repoPath > b.repoPath ? 1 : 0;
  });

  return nodes;
}

/**
 * Whether a repo's children are showing. Active repos default to expanded,
 * inactive ones to collapsed; `collapsedRepos` holds only explicit overrides,
 * so a repo going quiet re-collapses unless the user expanded it by hand.
 */
export function isRepoExpanded(
  collapsedRepos: Record<string, boolean>,
  node: RepoNode,
): boolean {
  const override = collapsedRepos[node.repoPath];
  return override === undefined ? node.isActive : !override;
}

/**
 * Every row the tree holds, whatever is collapsed. `flattenSidebarTree` is the
 * *visible* walk; lookups by key need the rows a collapsed repo is hiding too,
 * or jumping to a terminal under one would find nothing.
 */
export function allSidebarRows(nodes: RepoNode[]): SidebarRow[] {
  const out: SidebarRow[] = [];
  for (const node of nodes) {
    if (node.head) out.push(node.head);
    out.push(...node.live, ...node.rest);
  }
  return out;
}

/**
 * Just the rows with a shell running in them, in the same order. The collapsed
 * rail's entire content, so it walks the tree once rather than materializing
 * every repo's `rest` tail only to throw it away.
 */
export function terminalSidebarRows(nodes: RepoNode[]): SidebarRow[] {
  const out: SidebarRow[] = [];
  for (const node of nodes) {
    if (node.head && isTerminalRow(node.head)) out.push(node.head);
    for (const row of node.live) if (isTerminalRow(row)) out.push(row);
    for (const row of node.rest) if (isTerminalRow(row)) out.push(row);
  }
  return out;
}

/**
 * Open a row, dispatching on its kind: a review resolves its stored base, a
 * branch goes through read-only-preview detection. Lives beside `SidebarEntry`
 * so adding a kind is one edit rather than one per activation site.
 */
export function activateSidebarRow(
  row: SidebarRow,
  handlers: {
    onActivateReview: (review: GlobalReviewSummary) => void;
    onActivateLocalBranch: (
      repoPath: string,
      branch: string,
      defaultBranch: string,
    ) => void;
  },
): void {
  const { entry } = row;
  if (entry.kind === "review") {
    handlers.onActivateReview(entry.review);
  } else if (entry.kind === "remote-recent") {
    handlers.onActivateLocalBranch(
      entry.repoPath,
      entry.branchName,
      entry.defaultBranch,
    );
  } else {
    handlers.onActivateLocalBranch(
      row.repoPath,
      entry.branch.name,
      entry.repo.defaultBranch,
    );
  }
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
