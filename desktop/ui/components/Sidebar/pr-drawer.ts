/**
 * What the pull-requests drawer lists.
 *
 * The drawer answers one question — *what have I got out on GitHub that I
 * haven't picked up yet* — so its whole rule is a subtraction: the viewer's
 * open PRs, minus the ones a workspace in the queue already stands for, minus
 * the repos the user has filtered out. A PR being in the queue is not news; the
 * queue is already showing it, badge and all, and listing it twice would make
 * the drawer's count mean nothing.
 *
 * The queue half of the subtraction joins through `attachmentPr`, the same rule
 * the card badges by, so "hidden here" and "badged there" are guaranteed to be
 * the same event.
 *
 * Kept JSX-free so the rules are unit-testable.
 */

import type { ViewerPr, ViewerPrSnapshot, Workspace } from "../../types";
import { availablePrs } from "../../stores/selectors/sidebar";
import { byPrRecency, prNeedsAttention } from "../../utils/sidebar-tree";
import { attachmentPr, type WorkspaceContext } from "./workspace-status";

/**
 * A PR's identity, `owner/name#12`.
 *
 * Spelled with the repo GitHub names rather than the local path that
 * `makeReviewKey` would use: this has to identify a PR in a repo that isn't
 * cloned here, which has no path to be keyed by. The number rather than the
 * head branch, for the reason `openPrRowRef` gives — two open PRs can share a
 * head branch, and picking either up would then hide both.
 */
export function prIdentity(pr: ViewerPr): string {
  return `${pr.repoNameWithOwner}#${pr.number}`;
}

/** Every open PR some workspace in the queue already stands for. */
function pickedUpPrs(
  workspaces: Workspace[],
  ctx: WorkspaceContext,
): Set<string> {
  const taken = new Set<string>();
  for (const workspace of workspaces) {
    for (const attachment of workspace.attachments) {
      const pr = attachmentPr(attachment, ctx);
      if (pr) taken.add(prIdentity(pr));
    }
  }
  return taken;
}

/**
 * Attention first, then drafts last, then most recently updated.
 *
 * Only two rungs of severity, both of them facts GitHub states: a reviewer has
 * asked for changes, or the author has parked it. Everything in between is one
 * bucket ordered by recency, because any finer ranking would be the drawer
 * guessing at priority — which is the queue's job, and the queue is ordered by
 * hand precisely so nothing has to guess.
 */
function comparePrs(a: ViewerPr, b: ViewerPr): number {
  const rank = (pr: ViewerPr): number =>
    prNeedsAttention(pr) ? 0 : pr.isDraft ? 2 : 1;
  return rank(a) - rank(b) || byPrRecency(a, b);
}

/** What the drawer draws, and what its two counts count. */
export interface DrawerPrs {
  /** The rows, in order. */
  shown: ViewerPr[];
  /**
   * How many were dropped by the repo filter — never silently, because a
   * filtered list that doesn't say it is filtered is a list that lies about
   * being empty. PRs already in the queue are *not* counted here: those aren't
   * hidden, they're elsewhere on screen.
   */
  hidden: number;
  /** Every repo with an unpicked-up PR, `owner/name` → how many, name-sorted. */
  repos: { repo: string; count: number }[];
}

/**
 * The drawer's list, from the snapshot and everything that subtracts from it.
 *
 * `hiddenRepos` is applied last so `repos` can offer every repo the user could
 * filter — including the ones currently filtered out, which is the only way
 * back from having filtered them.
 */
export function drawerPrs(
  snapshot: ViewerPrSnapshot | null,
  workspaces: Workspace[],
  ctx: WorkspaceContext,
  hiddenRepos: string[],
): DrawerPrs {
  const pickedUp = pickedUpPrs(workspaces, ctx);
  const candidates = availablePrs(snapshot).filter(
    (pr) => !pickedUp.has(prIdentity(pr)),
  );

  const counts = new Map<string, number>();
  for (const pr of candidates) {
    counts.set(
      pr.repoNameWithOwner,
      (counts.get(pr.repoNameWithOwner) ?? 0) + 1,
    );
  }

  const hide = new Set(hiddenRepos);
  const shown = candidates
    .filter((pr) => !hide.has(pr.repoNameWithOwner))
    .sort(comparePrs);

  return {
    shown,
    hidden: candidates.length - shown.length,
    repos: [...counts]
      .map(([repo, count]) => ({ repo, count }))
      .sort((a, b) => a.repo.localeCompare(b.repo)),
  };
}

/**
 * What the drawer says when it lists nothing — three different facts, and the
 * whole point is saying them apart.
 *
 * "Not checked yet" is the launch state: the cache read hasn't returned, so an
 * empty list would be a claim nobody has made. "Every open PR is in the queue"
 * is the good ending, and emphatically not "you have no PRs". Only the third
 * is the honest zero.
 */
export function drawerEmptyMessage(snapshot: ViewerPrSnapshot | null): string {
  if (!snapshot) return "Checking GitHub…";
  if (snapshot.prs.length === 0) return "No open pull requests.";
  return "Every open PR is in the queue.";
}
