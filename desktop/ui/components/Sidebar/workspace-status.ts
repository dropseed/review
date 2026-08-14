/**
 * What a queue entry says about itself.
 *
 * Every field here is derived on read and none of it is stored: a workspace is
 * a title and a list of attachments, and everything else — the branch is gone,
 * a PR wants something, a review is half done — is a join against state the
 * sidebar already holds. Storing any of it would mean a card that disagrees
 * with the row it stands for.
 *
 * The join goes through `SidebarRow`, the tree's own per-ref answer, rather
 * than re-deriving from local activity and the PR snapshot: the tree already
 * decides which PR badges which ref and where a ref lives on disk, and a second
 * answer to either is a second chance to disagree with the rows below.
 *
 * Kept JSX-free so the rules are unit-testable.
 */

import type {
  GlobalReviewSummary,
  Workspace,
  Attachment,
  ShippedPr,
  ViewerPr,
} from "../../types";
import { attachmentLabel, hasRef } from "../../stores/selectors/workspaceData";
import { makeReviewKey } from "../../utils/review-key";
import { prNeedsAttention, type SidebarRow } from "../../utils/sidebar-tree";
import { basename } from "./terminal-status-format";

export interface WorkspaceContext {
  /** The tree's rows by review key — `allSidebarRows` indexed. */
  rows: Map<string, SidebarRow>;
  /** Repo path → the name to show. */
  repoNames: Map<string, string>;
  /**
   * The repos the app has local activity for. A ref in a repo outside this set
   * has no row because nothing has looked, which is not the same as a branch
   * that is gone — and only the second one resolves a card.
   */
  knownRepos: Set<string>;
  reviews: Record<string, GlobalReviewSummary>;
  /** Confirmed merges by review key — the branches whose PR has landed. */
  shipped: Map<string, ShippedPr>;
}

/**
 * What to call a repo, for anything holding a `WorkspaceContext`.
 *
 * The context's name when it has one — the resolved `owner/repo` remote —
 * else the path's last segment. One rule, so every surface that names a repo
 * lands on the same name for the same path.
 */
export function repoLabel(ctx: WorkspaceContext, repoPath: string): string {
  return ctx.repoNames.get(repoPath) ?? basename(repoPath);
}

export interface AttachmentStatus {
  attachment: Attachment;
  reviewKey: string;
  repoName: string;
  /** Nothing local, remote, or on GitHub knows this ref any more. */
  gone: boolean;
  openPr?: ViewerPr;
  /** This repo's PR merged. Mutually exclusive with `openPr` in practice. */
  shipped?: ShippedPr;
  hasChanges: boolean;
  /** `repo · branch` — the chip a card, a tab and the breadcrumb all draw. */
  chipLabel: string;
}

export interface WorkspaceStatus {
  repos: AttachmentStatus[];
  /** The card's first line — the backend's derived title, or the human's. */
  title: string;
  /** The card's second line, after the repo names. */
  phrase: string;
  /** The second line whole — `repos · phrase` — as every surface shows it. */
  subtitle: string;
  /**
   * Every attached branch is gone. A workspace showing no repo is never
   * resolved — intent is done when the user says so, which is what removing it
   * is.
   */
  resolved: boolean;
  /** The PR the card's glyph stands for: the one that wants something, else the first. */
  openPr?: ViewerPr;
  /**
   * The merge that ends this workspace's story, when every branch it shows has
   * one.
   *
   * All of them, not any: a workspace spanning two repos is not shipped while
   * half of it is still open, and saying so would prompt the user to remove a
   * queue entry they still need. The PR named is the last one to land.
   */
  shipped?: ShippedPr;
  hasChanges: boolean;
  /**
   * Review progress across every attached repo that has a saved review,
   * summed. What the card's `N/M reviewed` phrase reports; null when nothing
   * has been reviewed here.
   */
  progress: { reviewed: number; total: number } | null;
}

function describeAttachment(
  attachment: Attachment,
  ctx: WorkspaceContext,
): AttachmentStatus {
  const { path, refName } = attachment;
  const reviewKey = makeReviewKey(path, refName ?? "");
  const row = ctx.rows.get(reviewKey) ?? null;
  const repoName = repoLabel(ctx, path);
  const branch =
    row?.entry.kind === "working-tree" ||
    row?.entry.kind === "worktree" ||
    row?.entry.kind === "branch" ||
    row?.entry.kind === "review-branch"
      ? row.entry.branch
      : null;

  return {
    attachment,
    reviewKey,
    // An attachment with no ref names no branch, so nothing can have deleted it.
    gone: hasRef(attachment) && row === null && ctx.knownRepos.has(path),
    openPr: row?.openPr,
    // A branch with a PR open again after an earlier one merged is being
    // worked on, not shipped — the open PR is the newer fact either way.
    shipped: row?.openPr ? undefined : ctx.shipped.get(reviewKey),
    hasChanges: branch?.hasWorkingTreeChanges ?? false,
    repoName,
    chipLabel: attachmentLabel(attachment, repoName),
  };
}

/** Reviewed/total summed over the repos that have a saved review. */
function progressFor(
  repos: AttachmentStatus[],
  ctx: WorkspaceContext,
): { reviewed: number; total: number } | null {
  let reviewed = 0;
  let total = 0;
  for (const repo of repos) {
    const review = ctx.reviews[repo.reviewKey];
    if (!review || review.totalHunks === 0) continue;
    // A saved review can hold decisions for hunks the diff no longer has, so
    // the raw count can exceed the total — clamp, or the card reads "2/1".
    reviewed += Math.min(review.reviewedHunks, review.totalHunks);
    total += review.totalHunks;
  }
  return total === 0 ? null : { reviewed, total };
}

/**
 * The short status phrase, at most two clauses.
 *
 * Ordered by what would make you look: something is waiting on you, then
 * something is unfinished, then how far along the review is. A third clause
 * doesn't fit the line, and the card is a pointer at work rather than a report
 * on it.
 */
function phraseFor(
  repos: AttachmentStatus[],
  progress: { reviewed: number; total: number } | null,
  resolved: boolean,
  shipped: ShippedPr | undefined,
): string {
  // Shipped outranks everything, including a deleted branch — a branch that is
  // gone *because it merged* is the good ending, and "branch gone" reads as a
  // problem. It is also the whole line: the queue entry is done, and how far
  // along its review got is no longer a thing to do.
  if (shipped) return `#${shipped.number} shipped`;
  if (resolved) return repos.length === 1 ? "branch gone" : "branches gone";
  const parts: string[] = [];

  const pr = repos.find((c) => c.openPr && prNeedsAttention(c.openPr))?.openPr;
  if (pr) {
    parts.push(
      pr.reviewDecision === "CHANGES_REQUESTED"
        ? `#${pr.number} changes requested`
        : `#${pr.number} CI failing`,
    );
  } else {
    const open = repos.find((c) => c.openPr)?.openPr;
    if (open)
      parts.push(open.isDraft ? `#${open.number} draft` : `#${open.number}`);
  }

  if (repos.some((c) => c.hasChanges)) parts.push("uncommitted changes");

  if (parts.length < 2 && progress) {
    parts.push(`${progress.reviewed}/${progress.total} reviewed`);
  }

  return parts.slice(0, 2).join(" · ");
}

/** Everything a queue entry and the repo tab strip render, for one workspace. */
export function describeWorkspace(
  workspace: Workspace,
  ctx: WorkspaceContext,
): WorkspaceStatus {
  const repos = workspace.attachments.map((attachment) =>
    describeAttachment(attachment, ctx),
  );
  const resolved = repos.length > 0 && repos.every((c) => c.gone);
  const attention = repos.find((c) => c.openPr && prNeedsAttention(c.openPr));
  const progress = progressFor(repos, ctx);
  const shipped = shippedFor(repos);
  const phrase = phraseFor(repos, progress, resolved, shipped);
  const names = [...new Set(repos.map((c) => c.repoName))];

  return {
    repos,
    title: workspace.displayTitle,
    phrase,
    subtitle: [names.join(", "), phrase].filter(Boolean).join(" · "),
    resolved,
    openPr: (attention ?? repos.find((c) => c.openPr))?.openPr,
    shipped,
    hasChanges: repos.some((c) => c.hasChanges),
    progress,
  };
}

/** The last merge to land, when every attached branch has one. See `shipped`. */
function shippedFor(repos: AttachmentStatus[]): ShippedPr | undefined {
  const branches = repos.filter((c) => hasRef(c.attachment));
  if (branches.length === 0 || !branches.every((c) => c.shipped)) {
    return undefined;
  }
  return branches
    .map((c) => c.shipped!)
    .reduce((latest, pr) => (pr.mergedAt > latest.mergedAt ? pr : latest));
}

/**
 * When this workspace last did something worth looking up for, as epoch ms —
 * null when it is quietly getting on with it.
 *
 * Only the three states that *changed and want a person*: a terminal that has
 * stopped and is waiting, a PR that came back asking for something, and a
 * merge. Not "is running", not "has uncommitted changes" — those are true for
 * hours at a stretch, and a marker that is always on marks nothing.
 *
 * A timestamp rather than a boolean because the question downstream is "since
 * the human last looked?", and only a moment can answer that.
 */
export function attentionSignalAt(
  status: WorkspaceStatus,
  /** `WorkspaceTerminals.waitingSince`, passed in to keep this JSX- and
   *  store-free. */
  waitingSince: number | null,
): number | null {
  const moments: number[] = [];
  if (waitingSince !== null) moments.push(waitingSince);
  if (status.shipped) moments.push(Date.parse(status.shipped.confirmedAt));
  if (status.openPr && prNeedsAttention(status.openPr)) {
    moments.push(Date.parse(status.openPr.updatedAt));
  }
  const real = moments.filter((at) => Number.isFinite(at));
  return real.length === 0 ? null : Math.max(...real);
}

/**
 * Whether a signal is newer than the last time the human looked at it.
 *
 * Focusing the workspace is the acknowledgement (see `focusWorkspace`), so a
 * signal raised *while* you were looking still marks the card — you were
 * reading a diff, not watching the queue.
 */
export function isUnseen(
  signalAt: number | null,
  seenAt: number | undefined,
): boolean {
  return signalAt !== null && signalAt > (seenAt ?? 0);
}
