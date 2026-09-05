/**
 * What a queue entry says about itself.
 *
 * Every field here is derived on read and none of it is stored: a workspace is
 * a title and a list of attachments, and everything else — the branch is gone,
 * a PR wants something, the working tree is dirty — is a join against state
 * the sidebar already holds. Storing any of it would mean a card that
 * disagrees with the row it stands for.
 *
 * The join goes through `SidebarRow`, the tree's own per-ref answer, rather
 * than re-deriving from local activity and the PR snapshot: the tree already
 * decides which PR badges which ref and where a ref lives on disk, and a second
 * answer to either is a second chance to disagree with the rows below.
 *
 * Kept JSX-free so the rules are unit-testable.
 */

import type { Workspace, Attachment, ShippedPr, ViewerPr } from "../../types";
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
  /**
   * Repo path → the ref it has checked out.
   *
   * What an attachment with no `refName` resolves to. The hint is optional and
   * "never identity", so a card that keyed straight off it built `path:` —
   * matching no row — and that repo silently contributed nothing to the card.
   * The checkout is the honest answer for a tab that named only a repo, and it
   * is the same answer `targetForAttachment` gives when opening one.
   */
  heads: Map<string, string>;
  /** Confirmed merges by review key — the branches whose PR has landed. */
  shipped: Map<string, ShippedPr>;
  /**
   * The same rows, indexed by repo path and *branch* — `sidebarRowsByRepoRef`.
   *
   * An attachment names a branch, and for one case that is not the same
   * question as its review key: a PR whose head has never been fetched has no
   * row at `repo:branch` in `rows`, only a synthesized `pr/N` one. That is the
   * state a PR just picked up out of the drawer is in, and reading it here is
   * what stops the card calling the branch *gone* while the fetch runs.
   */
  rowsByRepoRef: Map<string, SidebarRow>;
}

/**
 * The review key an attachment joins on — its ref, or the repo's checkout when
 * it names none.
 *
 * Keyed by the *repository*, never by the checkout: a review is one per
 * `(repo, ref)` however many working trees of it a workspace holds, so a
 * worktree tab and the main tree's tab pointed at the same branch join the same
 * row, the same PR and the same merge. What tells the two apart is the label,
 * which is the one thing here that reads the checkout's own path.
 */
function attachmentReviewKey(
  attachment: Attachment,
  ctx: WorkspaceContext,
): string {
  const { repoRoot, refName } = attachment;
  return makeReviewKey(repoRoot, refName ?? ctx.heads.get(repoRoot) ?? "");
}

/**
 * The row an attachment stands for, by branch.
 *
 * One rule, because two surfaces ask: the card describing the attachment, and
 * the drawer deciding whether a PR has already been picked up. A second copy
 * would let the drawer keep listing a PR whose card is already badging it.
 */
export function attachmentRow(
  attachment: Attachment,
  ctx: WorkspaceContext,
): SidebarRow | null {
  return ctx.rowsByRepoRef.get(attachmentReviewKey(attachment, ctx)) ?? null;
}

/** The open PR an attachment stands for — whatever the tree gave its row. */
export function attachmentPr(
  attachment: Attachment,
  ctx: WorkspaceContext,
): ViewerPr | undefined {
  return attachmentRow(attachment, ctx)?.openPr;
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
  /**
   * The checked-out working tree has uncommitted changes. A boolean on
   * purpose: the summed diffstat this card used to report was a number that
   * kept being wrong, where "git status says something changed" cannot be.
   */
  hasChanges: boolean;
  /**
   * `repo · branch` — the chip a card, a tab and the breadcrumb all draw. A
   * checkout that is not the repository's own tree is named by its directory
   * instead, since the repo's name is exactly what it shares with the other tab.
   */
  chipLabel: string;
}

export interface WorkspaceStatus {
  repos: AttachmentStatus[];
  /**
   * `repos · state words` — the one-sentence answer for the surfaces that
   * want text instead of chips: the entry's tooltip, a ⌘K row's detail line.
   */
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
}

function describeAttachment(
  attachment: Attachment,
  ctx: WorkspaceContext,
): AttachmentStatus {
  const { repoRoot } = attachment;
  const reviewKey = attachmentReviewKey(attachment, ctx);
  const row = attachmentRow(attachment, ctx);
  const openPr = row?.openPr;
  const repoName = repoLabel(ctx, repoRoot);
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
    // An attachment with no ref names no branch, so nothing can have deleted
    // it. And an open PR's head is a row here (`rowsByRepoRef`) whether or not
    // it has been fetched, so a PR just picked up out of the drawer is never
    // mistaken for a branch someone deleted.
    gone: hasRef(attachment) && row === null && ctx.knownRepos.has(repoRoot),
    openPr,
    // A branch with a PR open again after an earlier one merged is being
    // worked on, not shipped — the open PR is the newer fact either way.
    shipped: openPr ? undefined : ctx.shipped.get(reviewKey),
    hasChanges: branch?.hasWorkingTreeChanges ?? false,
    repoName,
    chipLabel: attachmentLabel(attachment, repoName),
  };
}

/**
 * Red CI, as a fact the card states in words. Deliberately not a colour:
 * red on this card means a reviewer asked for changes and nothing else, and
 * `prNeedsAttention` does not count CI for the same reason.
 */
export function prCiFailing(pr: ViewerPr): boolean {
  return pr.checksState === "FAILURE" || pr.checksState === "ERROR";
}

/**
 * The state words for the surfaces that want a sentence — the tooltip and the
 * ⌘K detail line. The card itself says all of this with chips and colours.
 */
function statusWords(
  repos: AttachmentStatus[],
  resolved: boolean,
  shipped: ShippedPr | undefined,
): string {
  // Shipped outranks everything, including a deleted branch — a branch that is
  // gone *because it merged* is the good ending, and "branch gone" reads as a
  // problem.
  if (shipped) return `#${shipped.number} merged`;
  if (resolved) return repos.length === 1 ? "branch gone" : "branches gone";

  const attention = repos.find(
    (c) => c.openPr && prNeedsAttention(c.openPr),
  )?.openPr;
  if (attention) return `#${attention.number} changes requested`;
  const open = repos.find((c) => c.openPr)?.openPr;
  if (!open) return "";
  // Draft first — it is a statement by the author, where the CI state is a
  // statement about a commit, and a red draft is still parked work.
  if (open.isDraft) return `#${open.number} draft`;
  if (prCiFailing(open)) return `#${open.number} CI failing`;
  return `#${open.number}`;
}

/** Whether a human ever typed a name for this workspace. */
export function isNamed(workspace: Workspace): boolean {
  return !!workspace.title?.trim();
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
  const shipped = shippedFor(repos);
  const names = [...new Set(repos.map((c) => c.repoName))];

  return {
    repos,
    subtitle: [names.join(", "), statusWords(repos, resolved, shipped)]
      .filter(Boolean)
      .join(" · "),
    resolved,
    openPr: (attention ?? repos.find((c) => c.openPr))?.openPr,
    shipped,
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
