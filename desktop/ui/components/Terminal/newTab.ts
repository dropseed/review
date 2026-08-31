import { useSpurStore } from "../../stores";
import {
  CHECKOUT_REF,
  type ReviewTarget,
} from "../../stores/selectors/workspaceData";
import type { Attachment, Workspace } from "../../types";

/**
 * Open a terminal in a new tab, in the directory the workspace is working in.
 *
 * There's no cwd picker — a shell that landed somewhere else than you wanted is
 * one `cd` away. What it must never do is land in *another workspace's*
 * checkout, which is why the cwd comes from this workspace's own repo tabs
 * rather than from whatever review the store was last pointed at.
 *
 * The workspace is named to the backend rather than being inferred from the
 * cwd, so the session and the workspace stay together: routing by cwd and
 * moving the session afterwards left the two disagreeing.
 *
 * Three cases:
 * - no workspace at all (⌘T with nothing focused), or one showing no repo →
 *   no directory to name, so the backend starts in `$HOME` and the router
 *   places the session by its cwd, exactly as it would a shell started outside
 *   the app;
 * - a repo tab with a checkout → that checkout;
 * - a repo tab with none → materialize it (which asks first, so a declined
 *   prompt simply starts no terminal).
 *
 * Resolves to the new session's id, or null when nothing could be started.
 */
export async function openTerminalTab(
  workspace?: Workspace | null,
  /**
   * Which comparison the shell is about. Named by a caller that has one in
   * hand — a ⌘K branch row landed on *that* branch, which on a multi-repo
   * workspace is precisely the one its active tab is not.
   */
  on?: ReviewTarget | null,
  /**
   * Whether to put the terminal on screen (see `reveal`). True for every
   * caller whose gesture *was* "give me a terminal"; the repo picker passes
   * false, because there the shell is a courtesy and the repo just opened is
   * what the person asked to look at.
   */
  opts: { reveal?: boolean } = {},
): Promise<string | null> {
  const show = opts.reveal !== false;
  const store = useSpurStore.getState();
  const target = on ?? activeTabTarget(workspace ?? null);

  if (!workspace || !target) {
    const id = await store.startTerminal(
      "",
      "",
      80,
      24,
      undefined,
      workspace?.id,
    );
    return show ? reveal(id) : id;
  }

  const cwd = await checkoutFor(target.repoPath, target.ref);
  if (!cwd) return null;
  const id = await store.startTerminal(
    target.repoPath,
    cwd,
    80,
    24,
    undefined,
    workspace.id,
  );
  return show ? reveal(id) : id;
}

/**
 * Put the shell that was just started on screen.
 *
 * Starting a terminal is the one gesture that says "I want to use a terminal",
 * so it is also what gives the terminal the room to be used in — otherwise the
 * two surfaces where the stage is *not* already showing it both answer a tap
 * with nothing: on the desktop a code-focused stage keeps the panel collapsed
 * to its rail, and at phone width only one half is drawn at a time. The shell
 * started either way; it was simply invisible, which reads as a dead button.
 *
 * `toggleTerminalPanel` guarded on `code` is the same move `jump.ts` makes to
 * reach a terminal that wants a human, and it lands on `split` — beside what is
 * already there rather than instead of it. Nothing here asks whether this is a
 * phone: `Stage/compact.ts` already resolves `split` to the terminal half at
 * that width, and writing the phone's answer into `contentFocus` would edit the
 * layout the desktop chose, which is exactly what the compact layout must never
 * do.
 *
 * Nothing happens when the terminal is already on screen, so a ⌘T from inside a
 * shell never rearranges the stage — and nothing happens when no session
 * started, so a declined worktree prompt or a failed start leaves the stage
 * where it was.
 */
function reveal(id: string | null): string | null {
  if (id === null) return null;
  const store = useSpurStore.getState();
  if (store.contentFocus === "code") store.toggleTerminalPanel();
  return id;
}

/**
 * The repo tab a new shell follows: the one on screen, else the workspace's
 * first. An empty ref is honest — the repo root is where a shell in a repo the
 * app isn't showing a branch of belongs.
 *
 * Exported so the offer to start one can name the same directory the start
 * would use; a caller rendering it has to subscribe to `activeReviewKey`
 * itself, since this reads the store rather than watching it.
 */
export function activeTabTarget(
  workspace: Workspace | null,
): ReviewTarget | null {
  if (!workspace) return null;
  const store = useSpurStore.getState();
  const activePath = store.activeReviewKey?.repoPath;
  const active: Attachment | undefined =
    workspace.attachments.find(
      (attachment) => attachment.path === activePath,
    ) ?? workspace.attachments[0];
  if (!active) return null;
  return { repoPath: active.path, ref: active.refName ?? CHECKOUT_REF };
}

/**
 * Where a comparison's files are: its worktree when it has one, the repo root
 * when the ref is what's checked out there, and otherwise a materialized
 * worktree — which asks the user first.
 */
async function checkoutFor(
  repoPath: string,
  ref: string,
): Promise<string | null> {
  const store = useSpurStore.getState();
  if (!ref) return repoPath;
  const branch = store.localActivity
    .find((repo) => repo.repoPath === repoPath)
    ?.branches.find((b) => b.name === ref);

  if (branch?.worktreePath) return branch.worktreePath;
  if (branch?.isCurrent) return repoPath;

  // Only the review the app currently has open can be materialized — the
  // prompt and the worktree both hang off it. For any other ref the repo root
  // is the honest answer: the files there are that repo's, and `cd` is one
  // keystroke.
  if (store.repoPath !== repoPath || store.reviewRef !== ref) return repoPath;
  return store.ensureMaterialized("run a terminal in it");
}
