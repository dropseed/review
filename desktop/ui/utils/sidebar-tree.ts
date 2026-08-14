/**
 * The tree of everything the app can navigate to: every repo, and every branch,
 * worktree, review and PR under it.
 *
 * One structure, repo-rooted: a repo's row *is* its repo-root checkout, and
 * everything in that repo — linked worktrees, PRs, reviews, plain branches —
 * hangs beneath it.
 *
 * Why one structure: the sidebar used to build the same branch twice, from two
 * independent builders feeding two zones. Nothing could then answer "where does
 * this row live on disk" without re-deriving it, and the re-derivations
 * disagreed — a branch checked out at the repo root read as "no checkout yet"
 * to anything that only consulted saved review state. Every row here carries
 * `checkoutPath`, and that is the answer everywhere: terminals, LSP, staging.
 *
 * Building the rows and deciding which of them to *show* are separate jobs, and
 * only the first one happens here. Every branch, review and PR the app knows
 * becomes a row, because this list is what ⌘K searches — which is now the whole
 * of how it is read, the sidebar having become the workspace queue. `RowFact`
 * is the surviving notion of "worth showing", and it is `tabRailSlice`'s to
 * apply.
 *
 * There is no clock in this file. Nothing about a row depends on how long ago
 * anything happened, so the tree is a pure function of git state, review state
 * and the PR snapshot, and it changes only when one of those does.
 */

import {
  type LocalBranchInfo,
  type RepoLocalActivity,
  type RecentRemoteBranch,
  type GlobalReviewSummary,
  type ViewerPr,
} from "../types";
import { makeReviewKey } from "./review-key";

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

/**
 * An open PR in a registered repo that nothing else in the tree accounts for —
 * no local branch, no remote-tracking branch, no saved review.
 *
 * It exists only for as long as the PR is open and unmatched: no review record
 * is written until the row is activated, so the sidebar can show work that
 * lives entirely on GitHub without inventing local state for it.
 */
export interface SidebarOpenPrEntry {
  kind: "open-pr";
  pr: ViewerPr;
  repoPath: string;
  /** The review ref this PR maps to — its head branch. */
  ref: string;
  /** Keyed by PR number, not by `ref` — see `openPrRowRef`. */
  reviewKey: string;
}

/**
 * The ref half of a synthesized `open-pr` row's key.
 *
 * Deliberately not the head branch, which is what the row *activates* as: two
 * open PRs can share one head branch — a fork whose PRs all come off `main`, a
 * branch reopened after a merge — and keying on it would collapse them into a
 * single row with a single dismissal. The number is unique within the repo and
 * stable across refreshes, which is what a dismissal has to survive.
 */
export function openPrRowRef(pr: ViewerPr): string {
  return `pr/${pr.number}`;
}

export type SidebarEntry =
  | SidebarBranchEntry
  | SidebarReviewEntry
  | SidebarRemoteEntry
  | SidebarOpenPrEntry;

/**
 * Something true about a row that the user has not already dealt with — the
 * whole of why a row is worth a line in the sidebar.
 *
 * Every one of these is a fact about the repository, checkable by looking:
 * files exist, a file is modified, a commit is nowhere else, GitHub has a PR
 * open. None of them is a guess about what you care about. The sidebar used to
 * mix in recency — a commit you made this week, a review you opened last
 * fortnight, a PR updated recently — and those rules answer "was something
 * happening here" rather than "is something here", so the list drifted between
 * sessions on its own and needed a per-row dismiss to argue with. A fact you
 * can act on needs no dismiss: commit the changes, push the commits, or close
 * the PR, and the row goes away because the reason did.
 *
 * `materialized` means a *deliberate* checkout — a linked or review-managed
 * worktree, which someone had to create on purpose. It excludes the branch that
 * merely happens to be at the repo root: every repo has one of those forever,
 * and the repo's own row is that branch anyway.
 *
 * `open-pr` means an open, *non-draft* PR — see [`prEarnsRow`]. Closing a PR is
 * how you dismiss its row, and a draft is one you cannot close because you
 * aren't finished with it.
 *
 * There is no `terminal` fact, though a running shell is certainly a fact. A
 * shell runs in a checkout, so its row is `materialized` (or is the repo row)
 * and already shows; and every terminal belongs to a workspace, so the queue
 * above this tree is where one is listed.
 */
export type RowFact = "materialized" | "dirty" | "unpushed" | "open-pr";

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
  /**
   * The user's open PR for this row's ref, when they have one. Set on rows the
   * tree built from local state as well as on the tree's own `open-pr` rows —
   * a badge, not an identity.
   */
  openPr?: ViewerPr;
  facts: RowFact[];
}

/** Whether anything about this row is worth a line. See [`RowFact`]. */
export function rowHasFacts(row: SidebarRow): boolean {
  return row.facts.length > 0;
}

export interface RepoNode {
  repoPath: string;
  repoName: string;
  defaultBranch: string;
  /**
   * The repo-root checkout — this node's own row. Null only for a repo we know
   * solely through reviews (no local branch listing). Always rendered: it is
   * the repo, and a repo with no row under it is still a repo you can open.
   */
  head: SidebarRow | null;
  /**
   * Every other row in the repo — worktrees, branches, reviews, remote refs and
   * PRs alike, `head` excluded. Every one of them, whether or not anything
   * would draw it: ⌘K reads the lot. Ordered materialized-first, then by ref,
   * so a row keeps its place whatever happens in the repo.
   */
  rows: SidebarRow[];
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
 * Whether a PR is blocked on something: changes requested, or CI that failed
 * or couldn't run.
 *
 * The one definition, because this is also exactly when the badge goes red
 * (`prBadgeClass` imports it) and when a work card leads with the PR rather
 * than the review progress (`work-status.ts`). Three places asking "is this PR
 * blocked" and getting three answers is three chances to disagree on screen.
 */
export function prNeedsAttention(pr: ViewerPr): boolean {
  return (
    pr.reviewDecision === "CHANGES_REQUESTED" ||
    pr.checksState === "FAILURE" ||
    pr.checksState === "ERROR"
  );
}

/**
 * Whether a PR is worth a permanent sidebar row of its own.
 *
 * An open PR is: it is out there waiting on someone, and there is nothing to
 * dismiss because closing it is the dismissal. A *draft* is not — a draft is
 * work its author has parked by declaration, and marking it ready is how it
 * comes back. Without this rule a long-lived draft draws a row that no gesture
 * in the app can quiet.
 *
 * It only governs the row. A draft still badges a row that exists for its own
 * reasons (`openPr` is set either way), and ⌘K still finds it.
 */
function prEarnsRow(pr: ViewerPr): boolean {
  return !pr.isDraft;
}

/** Build the repo-rooted sidebar tree. */
export function buildSidebarTree(
  localActivity: RepoLocalActivity[],
  globalReviews: GlobalReviewSummary[],
  globalReviewsByKey: Record<string, GlobalReviewSummary>,
  /**
   * The viewer's open PRs. Only the ones the backend matched to a registered
   * repo (`repoPath != null`) reach the tree — every row here promises a local
   * path, and a PR in a repo that was never cloned has none.
   */
  viewerPrs: readonly ViewerPr[] = [],
): RepoNode[] {
  interface Bucket {
    repoPath: string;
    repoName: string;
    defaultBranch: string;
    head: SidebarRow | null;
    rows: SidebarRow[];
    recentRemote: RecentRemoteBranch[];
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
      // checkout and being materialized are separate questions: `checkoutPath`
      // answers "where are the files" (terminals, LSP, staging all read it),
      // while the fact says someone made this checkout on purpose. `isCurrent`
      // excludes the main worktree, which git reports as a worktree like any
      // other but which nobody chose to create.
      const facts: RowFact[] = [];
      if (!branch.isCurrent && branch.worktreePath != null) {
        facts.push("materialized");
      }
      if (branch.hasWorkingTreeChanges) facts.push("dirty");
      // Counted against the upstream, so pushing a branch retires its row.
      // With no upstream the backend counts against the default branch
      // instead, which is the same statement: none of it is published.
      if (branch.unpushedCommits > 0) facts.push("unpushed");

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
        facts,
      };

      if (branch.isCurrent) bucket.head = row;
      else bucket.rows.push(row);
    }
  }

  // 2. Reviews whose ref is not a local branch — SHAs, tags, stashes, PRs from
  //    forks, deleted branches.
  for (const review of globalReviews) {
    const key = makeReviewKey(review.repoPath, review.ref);
    if (localKeys.has(key)) continue;

    const bucket = bucketFor(review.repoPath, review.repoName, "");
    const checkoutPath = review.worktreePath ?? null;

    // A review whose ref no longer exists locally has one fact available: its
    // worktree, if it still has one. Having *reviewed* something is not a fact
    // about the repo — it's a record of the past, and the palette is where you
    // reach those.
    bucket.rows.push({
      reviewKey: key,
      repoPath: review.repoPath,
      ref: review.ref,
      entry: { kind: "review", review, reviewKey: key },
      checkoutPath,
      facts: checkoutPath ? ["materialized"] : [],
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
        // A remote branch is by definition pushed, has no checkout, and has
        // nothing uncommitted — so no fact can hold and it never renders. It
        // is built anyway so ⌘K can find a branch someone else pushed, which
        // is the one thing you'd want from it.
        facts: [],
      });
    }
  }

  // 4. Open PRs, joined onto the rows that already represent them and
  //    materialized as their own rows where nothing does. Runs after every
  //    other source so "nothing represents this PR" is a question about the
  //    finished tree, not about whichever step happened to run first.
  //
  //    Newest first, because a row can only carry one badge and two PRs can
  //    want it: the most recently updated one is the one you're working on, so
  //    it takes the row and the others get rows of their own. Every PR ends up
  //    somewhere — dropping the loser would hide an open PR entirely.
  const claimed = new Set<SidebarRow>();
  const prsByRecency = [...viewerPrs].sort(
    (a, b) => parseTime(b.updatedAt) - parseTime(a.updatedAt),
  );

  for (const pr of prsByRecency) {
    const repoPath = pr.repoPath;
    if (repoPath == null) continue;

    const bucket = buckets.get(repoPath);
    const candidates: SidebarRow[] = bucket
      ? [...(bucket.head ? [bucket.head] : []), ...bucket.rows].filter(
          (row) => !claimed.has(row),
        )
      : [];

    // A PR's head branch is the ref its row would be keyed by — but a review
    // started *from* the PR keeps its own ref, so a PR-keyed review is matched
    // by number instead. Without that, a PR whose review ref isn't the branch
    // name would badge nothing and then be duplicated as an `open-pr` row.
    // Number beats branch name when both exist, and only one of them wins: a
    // `pr-7-head` review and the `feature` branch it was cut from are the same
    // PR seen twice, and badging both says there are two.
    const existing =
      candidates.find(
        (row) =>
          row.entry.kind === "review" &&
          row.entry.review.githubPr?.number === pr.number,
      ) ?? candidates.find((row) => row.ref === pr.headRefName);

    if (existing) {
      claimed.add(existing);
      existing.openPr = pr;
      if (prEarnsRow(pr)) existing.facts.push("open-pr");
      continue;
    }

    // Nothing local knows about this PR yet. The row is ephemeral — no review
    // record is written until someone activates it — so it costs nothing to
    // show and disappears on its own when the PR closes.
    const target =
      bucket ?? bucketFor(repoPath, repoPath.split("/").pop() ?? repoPath, "");
    const key = makeReviewKey(repoPath, openPrRowRef(pr));

    const row: SidebarRow = {
      reviewKey: key,
      repoPath,
      // The ref it will *become* once activated, which is the head branch —
      // the key is what distinguishes it from another PR on the same branch.
      ref: pr.headRefName,
      entry: {
        kind: "open-pr",
        pr,
        repoPath,
        ref: pr.headRefName,
        reviewKey: key,
      },
      checkoutPath: null,
      openPr: pr,
      facts: prEarnsRow(pr) ? ["open-pr"] : [],
    };
    target.rows.push(row);
    // Its own row already, so a later PR on the same branch can't badge it.
    claimed.add(row);
  }

  // 5. Order each repo's rows: the ones with files on disk first, then by name.
  //    Deliberately boring. Ranking by recency meant the row you were about to
  //    click moved while you reached for it, and every ordering that reads
  //    activity has that property; "where it was yesterday" is worth more here
  //    than any amount of cleverness about what matters today.
  const byRow = (a: SidebarRow, b: SidebarRow): number => {
    const aMaterialized = a.facts.includes("materialized") ? 0 : 1;
    const bMaterialized = b.facts.includes("materialized") ? 0 : 1;
    if (aMaterialized !== bMaterialized) return aMaterialized - bMaterialized;
    const byRef = a.ref.localeCompare(b.ref);
    if (byRef !== 0) return byRef;
    return a.reviewKey.localeCompare(b.reviewKey);
  };

  const nodes: RepoNode[] = [];
  for (const bucket of buckets.values()) {
    nodes.push({
      repoPath: bucket.repoPath,
      repoName: bucket.repoName,
      defaultBranch: bucket.defaultBranch,
      head: bucket.head,
      rows: bucket.rows.sort(byRow),
    });
  }

  // 6. One flat alphabetical order, for every repo, whatever is happening in
  //    them. Nothing about a repo's activity ranks it: ordering by last-touched
  //    made the list reshuffle while you worked, and promoting the repo with a
  //    shell in it did the same thing on a timescale of seconds. A stable
  //    position is what makes a list you can browse.
  nodes.sort((a, b) => {
    const byName = a.repoName.localeCompare(b.repoName);
    if (byName !== 0) return byName;
    return a.repoPath < b.repoPath ? -1 : a.repoPath > b.repoPath ? 1 : 0;
  });

  return nodes;
}

/**
 * Every row the tree holds, on screen or not.
 *
 * The lookup everything off the tree goes through — work cards resolving a
 * bound ref, `activateReviewKey`, the palette's list of reviews. None of those
 * callers is asking what the sidebar currently draws, and the palette in
 * particular is asking the opposite: a branch with no fact to its name is
 * precisely the one you need a search box to reach, so it must be here.
 */
export function allSidebarRows(nodes: RepoNode[]): SidebarRow[] {
  const out: SidebarRow[] = [];
  for (const node of nodes) {
    if (node.head) out.push(node.head);
    out.push(...node.rows);
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
    /** Starts a review from the PR — the first thing that gives it a record. */
    onActivateOpenPr: (pr: ViewerPr) => void;
  },
): void {
  const { entry } = row;
  if (entry.kind === "review") {
    handlers.onActivateReview(entry.review);
  } else if (entry.kind === "open-pr") {
    handlers.onActivateOpenPr(entry.pr);
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
