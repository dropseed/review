import type { Attachment, Workspace } from "../../types";

/**
 * The rules about workspaces and their attachments, as plain functions.
 *
 * Kept apart from the hook module for the reason `hunkData` is: slices need
 * these too, and a slice importing the hooks would pull in the assembled
 * store — which imports the slices. `selectors/workspaces` re-exports every
 * one of them, so a component still has a single place to import from.
 */

/** A comparison to open — the pair `makeReviewKey` builds a key from. */
export interface ReviewTarget {
  /** The repository (an attachment's `repoRoot`), or the path itself for a checkout target. */
  repoPath: string;
  ref: string;
  /** The tab — the attachment's own path — when the caller has it in hand. */
  path?: string;
}

/**
 * The ref of a target that names only a path: open what is there.
 *
 * The empty string rather than `HEAD` or a null, because it is already the
 * convention every caller with no branch in hand uses — `openRepoIn` hands
 * `choice.refName ?? ""` to a terminal, and the router's fallback passes `""`
 * for a base it doesn't know. A checkout target is the honest answer for a
 * plain directory (no branches exist) and for a repo the sidebar has no row
 * for yet (a fresh `git init` has no commits to make one from).
 */
export const CHECKOUT_REF = "";

/** Whether a target names a path to open rather than a comparison to diff. */
export function isCheckoutTarget(target: ReviewTarget): boolean {
  return target.ref === CHECKOUT_REF;
}

/**
 * The checkout the code half is showing, whichever way it is showing it — the
 * path an attachment is keyed by.
 *
 * A comparison names its tab in `activeReviewKey.path`, resolved once when the
 * key was set; browse and standalone mode have no comparison at all and name
 * the path in `repoPath` alone. Both are "the checkout on screen", and
 * everything joining a workspace to what is being shown has to accept either —
 * otherwise opening a folder makes the stage forget which workspace it is in.
 */
export function repoOnScreen(state: {
  activeReviewKey: { path: string } | null;
  repoPath: string | null;
}): string | null {
  return state.activeReviewKey?.path ?? state.repoPath;
}

/**
 * Whether an attachment names a branch; a bare directory tab doesn't.
 *
 * A type predicate, so the callers that go on to *use* the ref get it as a
 * string rather than re-asserting what this just checked.
 */
export function hasRef(
  attachment: Attachment,
): attachment is Attachment & { refName: string } {
  return !!attachment.refName;
}

/**
 * Whether an attachment is a checkout of its own — a linked worktree — rather
 * than the repository's main tree (or a plain directory, where the two are the
 * same string). The one predicate every "is this a second tab of one repo?"
 * question asks.
 */
export function isWorktreeTab(attachment: Attachment): boolean {
  return attachment.path !== attachment.repoRoot;
}

/**
 * How an attachment reads on a tab and in a chip: the repo's own name, and the
 * ref it is pointed at when it has one. The same shape the backend's derived
 * title uses, so a workspace titled after its first attachment and the tab for
 * that attachment say the same thing.
 *
 * A linked worktree is named by its own directory rather than the repo's
 * resolved name: the repo name is what it shares with the main tree's tab, and
 * the directory is what tells the two apart.
 */
export function attachmentLabel(
  attachment: Attachment,
  repoName?: string,
): string {
  const name =
    (isWorktreeTab(attachment) ? undefined : repoName) ??
    basenameOf(attachment.path);
  return attachment.refName ? `${name} · ${attachment.refName}` : name;
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/**
 * An attachment as a target: the review is the repository's, the tab is the
 * checkout. The two coordinates pull apart for a worktree tab, and this is the
 * one place they are spelled out.
 */
export function targetOf(attachment: Attachment): ReviewTarget {
  return {
    repoPath: attachment.repoRoot,
    ref: attachment.refName ?? CHECKOUT_REF,
    path: attachment.path,
  };
}

/**
 * The key with its tab named: the attachment of `attachments` the comparison
 * belongs in — the one already pointed at that ref, else the repository's own
 * tree, else the first of them. Falls back to the repository when the
 * attachments hold no checkout of it, which is exactly when the focus is stale.
 */
export function withTabPath<K extends { repoPath: string; ref: string }>(
  key: K,
  attachments: readonly Attachment[],
): K & { path: string } {
  const ofRepo = attachments.filter(
    (attachment) => attachment.repoRoot === key.repoPath,
  );
  const tab =
    ofRepo.find((attachment) => attachment.refName === key.ref) ??
    ofRepo.find((attachment) => attachment.path === key.repoPath) ??
    ofRepo[0];
  return { ...key, path: tab?.path ?? key.repoPath };
}

/**
 * The comparison the code half opens for a workspace with no tab named.
 *
 * The first attachment carrying a ref, because a bare directory has no diff to
 * show: a workspace attached to a scratch directory is live and has terminals,
 * and the code half is simply empty for it.
 */
export function comparisonTarget(
  workspace: Workspace | null,
): ReviewTarget | null {
  const attachment = workspace?.attachments.find(hasRef);
  return attachment ? targetOf(attachment) : null;
}

/** Where `path` sits among a workspace's tabs, or -1. Identity is the path. */
export function attachmentIndex(workspace: Workspace, path: string): number {
  return workspace.attachments.findIndex(
    (attachment) => attachment.path === path,
  );
}

/**
 * The workspace the stage is showing, as a plain function of the three pieces
 * of state that decide it.
 *
 * The rules live here rather than in the hook because the commands need the
 * same answer outside React — ⌘T opens a terminal in the focused workspace, and
 * a keystroke has no hooks. `useFocusedWorkspace` is this function memoized.
 *
 * Derivation from the comparison on screen comes first wherever it can: a repo
 * on screen is a repo some workspace has attached, so "which workspace is this"
 * has the same answer here as the router's. `focusedId` is only consulted for
 * the workspaces derivation cannot reach — one with no attachment, or one whose
 * repo nothing on screen names.
 *
 * `repoOnScreen` rather than the comparison's repo, because a folder opened as
 * a folder — browse mode, or a plain directory — has no comparison to derive
 * from and is still a repo tab someone is looking at.
 */
export function focusedWorkspace(
  workspaces: readonly Workspace[],
  focusedId: string | null,
  repoOnScreen: string | null,
): Workspace | null {
  const explicit = workspaces.find((workspace) => workspace.id === focusedId);
  if (explicit) return explicit;
  if (!repoOnScreen) return null;
  return showingRepo(workspaces, repoOnScreen);
}

/**
 * [`focusedWorkspace`] against the store's own shape — the form every caller
 * actually has, since all of them are holding state rather than three
 * arguments. Keeping the positional version underneath is what lets the tests
 * state the three inputs directly.
 */
export function focusedWorkspaceIn(state: {
  workspaces: readonly Workspace[];
  focusedWorkspaceId: string | null;
  activeReviewKey: { path: string } | null;
  repoPath: string | null;
}): Workspace | null {
  return focusedWorkspace(
    state.workspaces,
    state.focusedWorkspaceId,
    repoOnScreen(state),
  );
}

export type RoutePreview =
  /** A workspace already shows this repo; going there joins it. */
  | { kind: "join"; workspace: Workspace }
  /** No workspace shows it; going there starts one of its own. */
  | { kind: "new" };

/** The router's two rungs, indexed: by the checkout, and by its repository. */
export interface RepoHosts {
  byPath: Map<string, Workspace>;
  byRoot: Map<string, Workspace>;
}

/**
 * Every attached checkout in the queue — the O(1) form of "who is showing
 * this?".
 *
 * Queue order decides ties, and the *first* entry wins: attachments are
 * non-exclusive, so several workspaces may show one repo and the queue's order
 * is the priority proxy the router uses to pick between them. Two maps because
 * the rungs are ordered — a workspace showing the exact checkout beats an
 * earlier one showing only the repository — and built once per list change,
 * because ⌘K asks the question for every row of every repo on every keystroke.
 */
export function repoHosts(workspaces: readonly Workspace[]): RepoHosts {
  const byPath = new Map<string, Workspace>();
  const byRoot = new Map<string, Workspace>();
  for (const workspace of workspaces) {
    for (const attachment of workspace.attachments) {
      if (!byPath.has(attachment.path)) byPath.set(attachment.path, workspace);
      if (!byRoot.has(attachment.repoRoot))
        byRoot.set(attachment.repoRoot, workspace);
    }
  }
  return { byPath, byRoot };
}

/**
 * The first workspace in queue order showing the checkout at `path`, else the
 * first showing any checkout of the repository at it.
 *
 * Two scans rather than [`repoHosts`]'s maps: this answers about one path, and
 * the first scan short-circuits on nearly every call. The second rung is keyed
 * on the path too, because its caller ([`focusedWorkspace`]) holds a resolved
 * `activeReviewKey.path` — which is the repository's own tree exactly when no
 * tab was found for it.
 */
export function showingRepo(
  workspaces: readonly Workspace[],
  path: string,
): Workspace | null {
  return (
    workspaces.find((workspace) =>
      workspace.attachments.some((attachment) => attachment.path === path),
    ) ??
    workspaces.find((workspace) =>
      workspace.attachments.some((attachment) => attachment.repoRoot === path),
    ) ??
    null
  );
}

/**
 * Where a branch would land, without landing there.
 *
 * The mirror of `workspace::router::land` — and the *only* implementation of the
 * question in the frontend, which is the point: a row that promises "joins X"
 * and then does something else is worse than no preview at all. A wrong guess
 * is harmless here in a way it wasn't under exclusive claims: the terminal can
 * be dragged, and nothing was taken from anyone.
 *
 * Both coordinates, always: a caller holding a repository's own tree passes it
 * twice, which is what it is.
 */
export function previewRouteIn(
  hosts: RepoHosts,
  path: string,
  repoRoot: string,
): RoutePreview {
  const host = hosts.byPath.get(path) ?? hosts.byRoot.get(repoRoot);
  return host ? { kind: "join", workspace: host } : { kind: "new" };
}
