import type { ReviewTarget } from "../stores/selectors/workspaceData";
import type { Workspace } from "../types";

/**
 * What a launching app should do about the workspace it was last showing, as a
 * plain function of what it knows so far.
 *
 * Kept apart from the hook because the whole question is *timing* — the queue,
 * the sidebar's rows and the repo init all land in whatever order they land in
 * — and timing is the one thing a rendered test reproduces badly. The hook is
 * this decided on each change, and nothing else.
 */
export type RestoreDecision =
  /** Nothing to decide yet: something this depends on hasn't landed. */
  | { kind: "wait" }
  /** Nothing to restore, now or ever. */
  | { kind: "done" }
  /**
   * Take the focus, and leave the screen alone — a comparison is already open,
   * put there by a URL, the CLI, or the directory the app was launched from.
   * That is a person naming what to look at, and it outranks a restore; the
   * workspace's tabs coming back is the part that was missing.
   */
  | { kind: "focus"; workspace: Workspace }
  /** Focus it and open `target` — the app comes back where it was. */
  | { kind: "open"; workspace: Workspace; target: ReviewTarget | null };

export interface RestoreInput {
  /** The workspace the stage was showing when the app last ran, if any. */
  lastWorkspaceId: string | null;
  /** The queue as it stands — empty means it hasn't answered yet. */
  workspaces: readonly Workspace[];
  /** The workspace the stage is showing now, explicit or derived. */
  focused: Workspace | null;
  /** Whether a comparison is on screen. */
  hasComparison: boolean;
  /**
   * The comparison the restored workspace would open — its first attachment
   * the sidebar can actually resolve, or null while it can resolve none.
   *
   * Null is ambiguous on purpose, and `expired` is what disambiguates it: a
   * repo whose rows haven't loaded yet and a branch that is gone look exactly
   * the same from here, and the first one is worth waiting a moment for.
   */
  target: ReviewTarget | null;
  /**
   * Whether the launch has finished deciding which repo, if any, it opens —
   * `repoStatus` off `useRepositoryInit`, past "loading".
   *
   * Restoring before that answer lands is worse than not restoring: the init
   * navigates last, and opening its comparison drops a focus the workspace
   * doesn't show (see `setActiveReviewKey`), leaving the stage exactly where
   * this started.
   */
  initSettled: boolean;
  /** Whether the wait — for `initSettled`, then for `target` — has run out. */
  expired: boolean;
}

/**
 * The restore, decided.
 *
 * The order is the argument: anything already on the stage outranks what was
 * on it last time, so a workspace reached by any other route — derived from an
 * open comparison, clicked in the queue, named by a notification — settles this
 * without the restore ever running.
 */
export function restoreDecision(input: RestoreInput): RestoreDecision {
  const { lastWorkspaceId, workspaces, focused, hasComparison } = input;

  // Someone got here first. That includes derivation succeeding on its own,
  // which is the ordinary case and the reason this is cheap.
  if (focused) return { kind: "done" };
  if (!lastWorkspaceId) return { kind: "done" };

  // The launch's own repo decision goes first, always: it is what the person
  // typed (or the directory they launched from), and it navigates when it
  // lands. The bound is there because an init that throws never answers, and a
  // restore held hostage to that is a restore that never runs.
  if (!input.initSettled && !input.expired) return { kind: "wait" };

  const workspace = workspaces.find((entry) => entry.id === lastWorkspaceId);
  if (!workspace) {
    // An id nothing matches means one of two things, and only the queue can
    // say which: it hasn't loaded, or that workspace is gone.
    return workspaces.length === 0 ? { kind: "wait" } : { kind: "done" };
  }

  if (hasComparison) return { kind: "focus", workspace };

  // A workspace showing no repo has nothing to wait for — its stage is the
  // empty state either way.
  if (workspace.attachments.length === 0) {
    return { kind: "open", workspace, target: null };
  }

  if (input.target) return { kind: "open", workspace, target: input.target };
  return input.expired
    ? { kind: "open", workspace, target: null }
    : { kind: "wait" };
}
