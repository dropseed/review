/**
 * What a work card says about itself.
 *
 * Every field here is derived on read and none of it is stored: a work item is
 * a title and a list of refs, and everything else — the branch is gone, a PR
 * wants something, a review is half done — is a join against state the sidebar
 * already holds. Storing any of it would mean a card that disagrees with the
 * row it stands for.
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
  WorkItem,
  WorkRef,
  ViewerPr,
} from "../../types";
import { makeReviewKey } from "../../utils/review-key";
import { prNeedsAttention, type SidebarRow } from "../../utils/sidebar-tree";
import { basename } from "./terminal-status-format";

export interface WorkContext {
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
}

/**
 * What to call a repo, for anything holding a `WorkContext`.
 *
 * The context's name when it has one — the resolved `owner/repo` remote —
 * falling back to whatever the caller already knows the repo as, then to the
 * path's last segment. One rule, so a card, a band row and the repos tree
 * can't each land on a different name for the same path.
 */
export function repoLabel(
  ctx: WorkContext,
  repoPath: string,
  fallback?: string,
): string {
  return (
    ctx.repoNames.get(repoPath) ?? fallback ?? basename(repoPath) ?? repoPath
  );
}

/**
 * The card's first line, and the ⌘K entry's title.
 *
 * A card bound to a branch needs no title of its own — the branch names the
 * work, and making the user type that name again is a worse default than
 * showing it.
 */
export function workItemTitle(item: WorkItem): string {
  return item.title || item.refs[0]?.ref || "Untitled";
}

export interface WorkRefStatus {
  ref: WorkRef;
  reviewKey: string;
  repoName: string;
  /** The row the ref resolves to, or null when nothing represents it. */
  row: SidebarRow | null;
  /** Nothing local, remote, or on GitHub knows this ref any more. */
  gone: boolean;
  openPr?: ViewerPr;
  hasChanges: boolean;
  /** `repo·branch`, the chip's label on a card holding more than one ref. */
  chipLabel: string;
}

export interface WorkItemStatus {
  refs: WorkRefStatus[];
  /** The card's first line: the item's own title, or the branch it's bound to. */
  title: string;
  /** The card's second line, after the repo names. */
  phrase: string;
  /** Repo names, deduped, in ref order. */
  repos: string[];
  /** The second line whole — `repos · phrase` — as the card and the rail's tooltip show it. */
  subtitle: string;
  /**
   * Every bound ref is gone. A card with no refs is never resolved — a note is
   * done when the user says so, which is what removing it is.
   */
  resolved: boolean;
  /** The PR the card's glyph stands for: the one that wants something, else the first. */
  openPr?: ViewerPr;
  hasChanges: boolean;
}

function describeRef(ref: WorkRef, ctx: WorkContext): WorkRefStatus {
  const reviewKey = makeReviewKey(ref.repoPath, ref.ref);
  const row = ctx.rows.get(reviewKey) ?? null;
  const repoName = repoLabel(ctx, ref.repoPath);
  const branch =
    row?.entry.kind === "working-tree" ||
    row?.entry.kind === "worktree" ||
    row?.entry.kind === "branch" ||
    row?.entry.kind === "review-branch"
      ? row.entry.branch
      : null;

  return {
    ref,
    reviewKey,
    row,
    gone: row === null && ctx.knownRepos.has(ref.repoPath),
    openPr: row?.openPr,
    hasChanges: branch?.hasWorkingTreeChanges ?? false,
    repoName,
    chipLabel: `${repoName}·${ref.ref}`,
  };
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
  refs: WorkRefStatus[],
  ctx: WorkContext,
  resolved: boolean,
): string {
  if (resolved) return refs.length === 1 ? "branch gone" : "branches gone";
  const parts: string[] = [];

  const pr = refs.find((r) => r.openPr && prNeedsAttention(r.openPr))?.openPr;
  if (pr) {
    parts.push(
      pr.reviewDecision === "CHANGES_REQUESTED"
        ? `#${pr.number} changes requested`
        : `#${pr.number} CI failing`,
    );
  } else {
    const open = refs.find((r) => r.openPr)?.openPr;
    if (open)
      parts.push(open.isDraft ? `#${open.number} draft` : `#${open.number}`);
  }

  if (refs.some((r) => r.hasChanges)) parts.push("uncommitted changes");

  if (parts.length < 2) {
    const review = refs
      .map((r) => ctx.reviews[r.reviewKey])
      .find((r) => r != null && r.totalHunks > 0);
    if (review) {
      parts.push(`${review.reviewedHunks}/${review.totalHunks} reviewed`);
    }
  }

  return parts.slice(0, 2).join(" · ");
}

/** Everything a card renders, for one item. */
export function describeWorkItem(
  item: WorkItem,
  ctx: WorkContext,
): WorkItemStatus {
  const refs = item.refs.map((ref) => describeRef(ref, ctx));
  const resolved = refs.length > 0 && refs.every((r) => r.gone);
  const attention = refs.find((r) => r.openPr && prNeedsAttention(r.openPr));
  const phrase = phraseFor(refs, ctx, resolved);
  const repos = [...new Set(refs.map((r) => r.repoName))];

  return {
    refs,
    title: workItemTitle(item),
    phrase,
    repos,
    subtitle: [repos.join(", "), phrase].filter(Boolean).join(" · "),
    resolved,
    openPr: (attention ?? refs.find((r) => r.openPr))?.openPr,
    hasChanges: refs.some((r) => r.hasChanges),
  };
}
