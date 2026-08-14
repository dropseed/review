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
  repoPath: string;
  ref: string;
}

/** Whether an attachment names a branch; a bare directory tab doesn't. */
export function hasRef(attachment: Attachment): boolean {
  return !!attachment.refName;
}

/**
 * How an attachment reads on a tab and in a chip: the repo's own name, and the
 * ref it is pointed at when it has one. The same shape the backend's derived
 * title uses, so a workspace titled after its first attachment and the tab for
 * that attachment say the same thing.
 */
export function attachmentLabel(
  attachment: Attachment,
  repoName?: string,
): string {
  const name = repoName ?? basenameOf(attachment.path);
  return attachment.refName ? `${name} · ${attachment.refName}` : name;
}

function basenameOf(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
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
  return attachment
    ? { repoPath: attachment.path, ref: attachment.refName! }
    : null;
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
 */
export function focusedWorkspace(
  workspaces: readonly Workspace[],
  focusedId: string | null,
  activeReviewKey: { repoPath: string; ref: string } | null,
): Workspace | null {
  const explicit = workspaces.find((workspace) => workspace.id === focusedId);
  if (explicit) return explicit;
  if (!activeReviewKey) return null;
  return showingRepo(workspaces, activeReviewKey.repoPath);
}

export type RoutePreview =
  /** A workspace already shows this repo; going there joins it. */
  | { kind: "join"; workspace: Workspace }
  /** No workspace shows it; going there starts one of its own. */
  | { kind: "new" };

/**
 * Every attached repo in the queue, by path — the O(1) form of "who is showing
 * this?".
 *
 * Queue order decides ties, and the *first* entry wins: attachments are
 * non-exclusive, so several workspaces may show one repo and the queue's order
 * is the priority proxy the router uses to pick between them. Built once per
 * list change and handed to [`previewRouteIn`], because ⌘K asks the question
 * for every row of every repo on every keystroke.
 */
export function repoHosts(
  workspaces: readonly Workspace[],
): Map<string, Workspace> {
  const hosts = new Map<string, Workspace>();
  for (const workspace of workspaces) {
    for (const attachment of workspace.attachments) {
      if (!hosts.has(attachment.path)) hosts.set(attachment.path, workspace);
    }
  }
  return hosts;
}

/** The first workspace in queue order showing `repoPath`, if any. */
export function showingRepo(
  workspaces: readonly Workspace[],
  repoPath: string,
): Workspace | null {
  return repoHosts(workspaces).get(repoPath) ?? null;
}

/**
 * Where a branch would land, without landing there.
 *
 * The mirror of `work::router::land` — and the *only* implementation of the
 * question in the frontend, which is the point: a row that promises "joins X"
 * and then does something else is worse than no preview at all. A wrong guess
 * is harmless here in a way it wasn't under exclusive claims: the terminal can
 * be dragged, and nothing was taken from anyone.
 */
export function previewRouteIn(
  hosts: Map<string, Workspace>,
  repoPath: string,
): RoutePreview {
  const host = hosts.get(repoPath);
  return host ? { kind: "join", workspace: host } : { kind: "new" };
}

/** [`previewRouteIn`] for a caller with one repo and no index to reuse. */
export function previewRoute(
  workspaces: readonly Workspace[],
  repoPath: string,
): RoutePreview {
  return previewRouteIn(repoHosts(workspaces), repoPath);
}
