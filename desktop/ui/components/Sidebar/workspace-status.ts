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
  DiffShortStat,
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
  /**
   * Repo path → the ref it has checked out.
   *
   * What an attachment with no `refName` resolves to. The hint is optional and
   * "never identity", so a card that keyed straight off it built `path:` —
   * matching no review — and that repo silently contributed nothing to the
   * card's progress. The checkout is the honest answer for a tab that named
   * only a repo, and it is the same answer `targetForAttachment` gives when
   * opening one.
   */
  heads: Map<string, string>;
  reviews: Record<string, GlobalReviewSummary>;
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
 */
function attachmentReviewKey(
  attachment: Attachment,
  ctx: WorkspaceContext,
): string {
  const { path, refName } = attachment;
  return makeReviewKey(path, refName ?? ctx.heads.get(path) ?? "");
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
  hasChanges: boolean;
  /**
   * How big those changes are, when the branch row knows. Null is "not
   * measured", never "nothing": a repo known only through a saved review has
   * no branch row to have counted, and a working tree can have changes here
   * with the count still on its way.
   */
  workingTreeStats: DiffShortStat | null;
  /** `repo · branch` — the chip a card, a tab and the breadcrumb all draw. */
  chipLabel: string;
}

/**
 * One clause of the status phrase.
 *
 * Structured rather than a joined string because the changes clause is drawn in
 * the diff's own two colours, and a card handed one sentence cannot colour half
 * of it. Every other clause is already a finished phrase, so it stays text —
 * this is the smallest shape that lets one of them be more than that.
 */
export interface PhraseClause {
  /** What this clause says, and the whole of what `phrase` is built from. */
  text: string;
  /**
   * Set on the changes clause, whose numbers the card colours. Carried
   * *alongside* the text rather than instead of it, so the sentence has one
   * author: a discriminated union meant the card rebuilt the words itself, and
   * a tooltip could disagree with the line it described.
   */
  stat?: DiffShortStat;
}

/** `3 files` — the noun of a change stat, shared by the sentence and the card. */
export function fileCountLabel(stat: DiffShortStat): string {
  return `${stat.fileCount} file${stat.fileCount === 1 ? "" : "s"}`;
}

/**
 * `3 files +48 −12` — the working tree, as a number instead of an adjective.
 *
 * A real minus, not a hyphen, so the two signs are the same width and a column
 * of cards doesn't wobble. Both counts are always written, zero included: they
 * are one shape read at a glance, and a stat that sometimes has two numbers and
 * sometimes one has to be *read* to be understood.
 */
export function formatChangeStat(stat: DiffShortStat): string {
  return `${fileCountLabel(stat)} +${stat.additions} −${stat.deletions}`;
}

/**
 * The working tree of the repos that have one, summed.
 *
 * One number for the card, because the card has one line and per-repo counts
 * would need per-repo rows it doesn't have. A repo whose stats haven't arrived
 * contributes nothing rather than suppressing the clause — a second repo still
 * being counted shouldn't take the first one's answer away.
 */
function changeStatFor(repos: AttachmentStatus[]): DiffShortStat | null {
  const measured = repos
    .map((repo) => repo.workingTreeStats)
    .filter((stat): stat is DiffShortStat => stat != null);
  if (measured.length === 0) return null;
  return measured.reduce((sum, stat) => ({
    fileCount: sum.fileCount + stat.fileCount,
    additions: sum.additions + stat.additions,
    deletions: sum.deletions + stat.deletions,
  }));
}

export interface WorkspaceStatus {
  repos: AttachmentStatus[];
  /** The card's first line — see `describeWorkspace`'s `soleTerminal`. */
  title: string;
  /** The card's second line, after the repo names. */
  phrase: string;
  /**
   * The same phrase, unjoined — what the card actually draws, so the changes
   * clause can carry the diff's colours. `phrase` stays the sentence for
   * everything that needs one (the subtitle, the entry's tooltip).
   */
  clauses: PhraseClause[];
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
  const { path } = attachment;
  const reviewKey = attachmentReviewKey(attachment, ctx);
  const row = attachmentRow(attachment, ctx);
  const openPr = row?.openPr;
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
    // An attachment with no ref names no branch, so nothing can have deleted
    // it. And an open PR's head is a row here (`rowsByRepoRef`) whether or not
    // it has been fetched, so a PR just picked up out of the drawer is never
    // mistaken for a branch someone deleted.
    gone: hasRef(attachment) && row === null && ctx.knownRepos.has(path),
    openPr,
    // A branch with a PR open again after an earlier one merged is being
    // worked on, not shipped — the open PR is the newer fact either way.
    shipped: openPr ? undefined : ctx.shipped.get(reviewKey),
    hasChanges: branch?.hasWorkingTreeChanges ?? false,
    workingTreeStats: branch?.workingTreeStats ?? null,
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
    // More decided than there is to decide is not a number to round off: it
    // means the count was taken against a diff this review no longer has. It
    // used to be clamped, which turned the impossible case into the *worst*
    // case — `40/40`, a card claiming a review is finished at exactly the
    // moment it can't know. Say nothing instead; the review's own screen
    // counts live hunks and is right.
    if (review.reviewedHunks > review.totalHunks) return null;
    reviewed += review.reviewedHunks;
    total += review.totalHunks;
  }
  return total === 0 ? null : { reviewed, total };
}

/**
 * What a card says after `#47` when the PR isn't asking for anything: draft,
 * red CI, or nothing at all.
 *
 * Draft first — it is a statement by the author, where the CI state is a
 * statement about a commit, and a red draft is still parked work.
 */
function openPrSuffix(pr: ViewerPr): string {
  if (pr.isDraft) return " draft";
  if (pr.checksState === "FAILURE" || pr.checksState === "ERROR") {
    return " CI failing";
  }
  return "";
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
): PhraseClause[] {
  const text = (value: string): PhraseClause => ({ text: value });

  // Shipped outranks everything, including a deleted branch — a branch that is
  // gone *because it merged* is the good ending, and "branch gone" reads as a
  // problem. It is also the whole line: the queue entry is done, and how far
  // along its review got is no longer a thing to do.
  if (shipped) return [text(`#${shipped.number} shipped`)];
  if (resolved) {
    return [text(repos.length === 1 ? "branch gone" : "branches gone")];
  }
  const parts: PhraseClause[] = [];

  const pr = repos.find((c) => c.openPr && prNeedsAttention(c.openPr))?.openPr;
  if (pr) {
    parts.push(text(`#${pr.number} changes requested`));
  } else {
    const open = repos.find((c) => c.openPr)?.openPr;
    // Red CI is not an attention signal (see `prNeedsAttention`), but it is
    // still worth saying: the card reports it in the same quiet type as
    // everything else here rather than leading with it.
    if (open) parts.push(text(`#${open.number}${openPrSuffix(open)}`));
  }

  // The size when it is known, the adjective when it isn't. Only a repo that
  // *has* changes is asked how big they are: a branch nobody measured — every
  // branch but the checked-out one — would otherwise contribute a "0 files
  // +0 −0" the card would be stating as a fact.
  const changed = repos.filter((c) => c.hasChanges);
  if (changed.length > 0) {
    const stat = changeStatFor(changed);
    parts.push(
      stat
        ? { text: formatChangeStat(stat), stat }
        : text("uncommitted changes"),
    );
  }

  if (parts.length < 2 && progress) {
    parts.push(text(`${progress.reviewed}/${progress.total} reviewed`));
  }

  return parts.slice(0, 2);
}

/** Whether a human ever typed a name for this workspace. */
export function isNamed(workspace: Workspace): boolean {
  return !!workspace.title?.trim();
}

/** Everything a queue entry and the repo tab strip render, for one workspace. */
export function describeWorkspace(
  workspace: Workspace,
  ctx: WorkspaceContext,
  /**
   * The title of this workspace's *only* terminal, when it has exactly one.
   *
   * It outranks the backend's derived title, which is the first attachment's
   * label: a workspace running one agent is that agent, and "review · master"
   * names the repo every other card in the queue could also be showing while
   * the terminal says what is actually going on in this one. The repo is still
   * on the card — it moves down to the chip line, which is where the details
   * that vary between cards live anyway.
   *
   * Only when nobody typed a title, and only for one terminal: with two, no
   * single one speaks for the workspace, and the derived repo label is the
   * honest summary again.
   */
  soleTerminal?: string | null,
): WorkspaceStatus {
  const repos = workspace.attachments.map((attachment) =>
    describeAttachment(attachment, ctx),
  );
  const resolved = repos.length > 0 && repos.every((c) => c.gone);
  const attention = repos.find((c) => c.openPr && prNeedsAttention(c.openPr));
  const progress = progressFor(repos, ctx);
  const shipped = shippedFor(repos);
  const clauses = phraseFor(repos, progress, resolved, shipped);
  const phrase = clauses.map((clause) => clause.text).join(" · ");
  const names = [...new Set(repos.map((c) => c.repoName))];

  return {
    repos,
    title:
      !isNamed(workspace) && soleTerminal?.trim()
        ? soleTerminal
        : workspace.displayTitle,
    phrase,
    clauses,
    subtitle: [names.join(", "), phrase].filter(Boolean).join(" · "),
    resolved,
    openPr: (attention ?? repos.find((c) => c.openPr))?.openPr,
    shipped,
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
