import { useSpurStore } from "../stores";
import { findSidebarRow, getSidebarTree } from "../stores/selectors/sidebar";
import {
  CHECKOUT_REF,
  hasRef,
  isCheckoutTarget,
  repoOnScreen,
  targetOf,
  type ReviewTarget,
} from "../stores/selectors/workspaceData";
import { ackAttention } from "../utils/attention";
import { makeReviewKey, refFromReviewKey } from "../utils/review-key";
import { rowWorktree, type SidebarRow } from "../utils/sidebar-tree";
import { openTerminalTab } from "../components/Terminal/newTab";
import { getCommandUi } from "./host";
import type { Attachment, Workspace } from "../types";
import type { Command } from "./types";

/**
 * Only the first nine get a positional shortcut; the rest are typed for. The
 * queue reads it too — the cards that reveal a digit under ⌘ have to be exactly
 * the cards a digit would reach.
 */
export const SHORTCUT_LIMIT = 9;

/**
 * Open one target — a repo tab, the menu's "Open", a ⌘K branch row.
 *
 * Resolves to whether it opened anything. A **named** ref nothing represents —
 * the branch was deleted, or its repo isn't registered here — deliberately
 * opens no review: showing a diff of something that isn't there is worse than
 * showing nothing. The caller is what decides what "nothing" looks like.
 *
 * A checkout target names no ref, so there is nothing for that gate to be about
 * and it doesn't apply: the path is the whole of what was asked for, and it is
 * always openable as itself. That is what keeps a repo the sidebar has no row
 * for — one `git init`-ed a moment ago, with no commit to build a row out of —
 * from falling through to the empty state.
 */
export function activateReviewTarget(target: ReviewTarget): boolean {
  if (isCheckoutTarget(target)) {
    getCommandUi().openPath(target.repoPath);
    return true;
  }

  const key = makeReviewKey(target.repoPath, target.ref);
  if (!findSidebarRow(useSpurStore.getState(), key)) return false;

  getCommandUi().activateReviewKey(target.repoPath, target.ref);
  return true;
}

/**
 * What a repo tab opens.
 *
 * A tab that names a ref opens that ref or nothing — falling back to whatever
 * the repo has checked out would put another branch's diff under a label that
 * says "· feature". A tab with no ref names only the path, and there the
 * checkout *is* the honest answer: that is what a repo picked without a branch
 * means.
 *
 * Which is why an unknown path still resolves. The sidebar tree is a list of
 * repos with history worth listing, and there are two ordinary ways to attach
 * something that isn't in it — a repo created seconds ago, and a directory that
 * is not a repo at all. Neither has a branch to name and both have files to
 * show, so both resolve to their own path and let `activateReviewTarget` open
 * it. A directory says so up front, before the ref is even consulted: a plain
 * folder has no branches, so a stale `refName` on one names nothing.
 *
 * Still nullable, and null still means the one thing it always meant: a branch
 * this tab names and nothing on this machine has.
 *
 * The two coordinates pull apart here, and that is the whole of what a worktree
 * tab costs: the *review* is filed under the repository (`repoRoot` — one
 * review per branch however many checkouts of it exist), while the *tab* is the
 * checkout the attachment names. So every join below — the sidebar row, the
 * repo's head — goes by `repoRoot`, and the resolved target carries `path` so
 * whatever opens it knows which of the workspace's checkouts it is in.
 */
export function targetForAttachment(
  attachment: Attachment,
): ReviewTarget | null {
  const state = useSpurStore.getState();
  const checkout: ReviewTarget = {
    repoPath: attachment.path,
    ref: CHECKOUT_REF,
  };
  if (!attachment.isGitRepo) return checkout;

  if (hasRef(attachment)) {
    const target = targetOf(attachment);
    const key = makeReviewKey(target.repoPath, target.ref);
    return findSidebarRow(state, key) ? target : null;
  }
  const head = getSidebarTree(state).find(
    (node) => node.repoPath === attachment.repoRoot,
  )?.head;
  return head ? { ...targetOf(attachment), ref: head.ref } : checkout;
}

/** Open an attachment's tab on the code side. See [`targetForAttachment`]. */
export function activateAttachment(attachment: Attachment): boolean {
  const target = targetForAttachment(attachment);
  return target !== null && activateReviewTarget(target);
}

/**
 * Make a workspace the one the stage is in, without deciding what it shows.
 *
 * The half every landing shares. Both public verbs are this plus their own
 * ending — `focusWorkspace` opens a comparison after it, `landWorkspace` routes
 * before it and leaves the screen to its caller — and pulling it out is what
 * stops them drifting: `landWorkspace` had already lost the overview reset
 * below, so a CLI landing while the terminal overview was up went to a
 * workspace you could not see.
 */
function takeFocus(
  workspace: Workspace,
  options: { acknowledge?: boolean } = {},
): void {
  const store = useSpurStore.getState();
  // Naming a workspace is asking to be shown it, so it also ends the
  // terminals-only overview. That row spans every workspace at once — left up,
  // a card click, a ⌘K row and ⌘1–9 would each appear to do nothing. Guarded
  // because this is the app's most-used gesture and the flag is almost always
  // already false: an unconditional `set` notifies every subscriber in the app.
  if (store.terminalOverview) store.setTerminalOverview(false);
  store.setFocusedWorkspace(workspace.id);
  // Looking at it *is* the acknowledgement — there is no dismiss button for an
  // attention accent, because a second gesture to say "yes, I saw that" is a
  // notification tray, and this is a queue.
  //
  // Which is why `acknowledge` exists, and why the launch restore is the one
  // caller that passes false: every other route in here is a person doing
  // something, so presence is implied by the gesture. An app coming back up on
  // its own implies nobody — and `useAttentionBadge` acknowledges the focused
  // workspace the moment the window actually has focus, so the signal is still
  // cleared as soon as there is someone to clear it for.
  if (options.acknowledge !== false) {
    store.markWorkspaceSeen(
      workspace.id,
      store.workspaces.map((entry) => entry.id),
    );
    // ...and the same gesture calls off the escalation, so a workspace you have
    // already opened never reaches your phone a minute later.
    ackAttention(workspace.id);
  }
  store.selectWorkspaceTab(workspace.id);
}

/**
 * Point the stage at a workspace: both halves swap to it at once.
 *
 * The one implementation, shared by the queue, the collapsed rail's number, ⌘K
 * and ⌘1–9, so every route into a workspace lands in the same place. The focus
 * id is what the stage reads; the comparison and the terminal tab follow from
 * it, which is why they are set here rather than derived by two components that
 * would each have to re-answer "which repo".
 *
 * A workspace with no attachment has nothing to show, so the code half goes to
 * the workspace's empty state instead of leaving the last workspace's diff on
 * screen under this one's name. So does one whose only tab names a branch that
 * is gone — but not one whose repo is merely unknown here, which now opens as
 * the folder it is. See [`targetForAttachment`].
 */
export function focusWorkspace(
  workspace: Workspace,
  target?: ReviewTarget,
  options: { acknowledge?: boolean } = {},
): void {
  // Clicking the workspace you are already in must not disturb the code half.
  // It is the app's most-repeated gesture — the card you are working in is the
  // one nearest the pointer — and re-opening a comparison you are already
  // reading throws away the tab you had chosen, the file you were on, and the
  // scroll position with it.
  //
  // Judged by what is *on screen*, not by the focus id alone: the code half can
  // be showing this workspace's repo while the pointer arrives from anywhere,
  // and `repoOnScreen` is the same answer the repo tabs mark themselves active
  // with, so the strip and this agree by construction. An explicit `target` is
  // a caller naming a comparison and always wins.
  const before = useSpurStore.getState();
  const onScreen = repoOnScreen(before);
  const undisturbed =
    !target &&
    before.focusedWorkspaceId === workspace.id &&
    onScreen !== null &&
    workspace.attachments.some((attachment) => attachment.path === onScreen);

  // Still taken even then: the overview closes, the attention accent clears,
  // and the terminal half re-selects this workspace's tab. Those are what the
  // click asked for; the code half is what it did not.
  takeFocus(workspace, options);
  if (undisturbed) return;

  // `target` is the caller naming which comparison to open — a ⌘K row names a
  // branch, not just a workspace, and on a multi-repo workspace that is
  // precisely the one its own first tab is not. Without one, the tab this
  // workspace was last left on opens, and the first attachment is the fallback
  // for a workspace that has never been opened — each resolved exactly as
  // clicking that tab would resolve it.
  const first = workspace.attachments[0];
  const candidates: (ReviewTarget | null)[] = target
    ? [target]
    : [rememberedTarget(workspace), first ? targetForAttachment(first) : null];

  // The remembered tab can fail to open where the first one still would — its
  // branch may have been deleted since — so the fallback is tried rather than
  // assumed unnecessary.
  for (const candidate of candidates) {
    if (candidate && activateReviewTarget(candidate)) return;
  }

  // The empty state is also where a workspace lands when its tab can't be
  // opened — a deleted branch — because the alternative is a header naming this
  // workspace over the last one's diff.
  getCommandUi().navigate("/");
}

/**
 * The comparison this workspace was last showing, if it still has that repo.
 *
 * The attachment check is the whole guard: detaching a tab must not leave a
 * memory that re-opens it, and a workspace whose repos changed under it should
 * fall back to its first rather than to something it no longer lists.
 *
 * Checked against the remembered *tab* — `path`, which `setActiveReviewKey`
 * resolves before storing the key — rather than the repository, which two
 * checkouts of one repo share.
 */
function rememberedTarget(workspace: Workspace): ReviewTarget | null {
  const remembered = useSpurStore.getState().workspaceCodeKeys[workspace.id];
  if (!remembered) return null;
  const stillAttached = workspace.attachments.some(
    (attachment) => attachment.path === remembered.path,
  );
  return stillAttached ? remembered : null;
}

/**
 * Land a sidebar row in a workspace and show it there — ⌘K's Enter, and the
 * pull-requests drawer's click.
 *
 * One verb because the two halves have to agree: the workspace is routed by
 * the row's **branch** (`row.ref`, which is what an attachment names and what a
 * card joins its PR badge on), while the comparison is opened by the row's
 * **key**, which is not the same string for an `open-pr` row — that one is
 * keyed `pr/N`, and opening it by branch finds no row at all, so the stage
 * would fall through to the empty state on a row that clearly named something.
 * Splitting those two apart is exactly the mistake this function exists to stop
 * anyone making twice.
 *
 * Resolves once the routing has committed, so a caller can await the landing.
 *
 * A row living in a linked worktree routes by *that* directory rather than by
 * the repository, so the shell and the tab both land in the checkout the row
 * names — and so a workspace already holding that worktree wins over one
 * holding only the main tree, which is the router's first rung. The tab is
 * named only when it is one: a row at the repo's own tree leaves `path` unset
 * and lets `setActiveReviewKey` pick whichever checkout the workspace has.
 */
export async function openRowInWorkspace(
  row: SidebarRow,
  options: { withTerminal?: boolean } = {},
): Promise<Workspace | null> {
  const worktree = rowWorktree(row);
  const workspace = await useSpurStore
    .getState()
    .routeWorkspace(worktree ?? row.repoPath, row.ref);
  if (!workspace) return null;

  const target: ReviewTarget = {
    repoPath: row.repoPath,
    ref: refFromReviewKey(row.reviewKey, row.repoPath) ?? row.ref,
    ...(worktree ? { path: worktree } : {}),
  };
  focusWorkspace(workspace, target);
  // On the branch that was named, not on whichever repo the workspace happens
  // to list first.
  if (options.withTerminal) void openTerminalTab(workspace, target);
  return workspace;
}

/**
 * Land something from *outside* the app in a workspace: the `spur` CLI, the
 * `spur://` deep link, Finder's "Open with", the directory the app was
 * launched from.
 *
 * The third landing verb, beside [`focusWorkspace`] and [`openRowInWorkspace`],
 * and the one that takes **the focus and not the screen**: its callers own the
 * comparison. It must be called *before* they open it, and both halves of that
 * are load-bearing — see `landReview` in `hooks/useRepositoryInit.ts`, which is
 * where the reasoning lives and where every caller goes through.
 *
 * A null `ref` lands on `CHECKOUT_REF`, which the backend reads as a bare path
 * attachment. Resolves to the workspace, or null when routing failed.
 */
export async function landWorkspace(
  repoPath: string,
  ref: string | null,
): Promise<Workspace | null> {
  const workspace = await useSpurStore
    .getState()
    .routeWorkspace(repoPath, ref ?? CHECKOUT_REF);
  if (!workspace) return null;

  // Typing `spur` is a person doing something, so it acknowledges the card's
  // attention signal exactly as clicking that card would.
  takeFocus(workspace);
  return workspace;
}

/**
 * Start a fresh workspace and show it: ⌘N, the sidebar's +, and ⌘K's "New
 * Workspace".
 *
 * Deliberately empty and unnamed — a workspace is a container that becomes
 * whatever is put in it, so asking for a title or a repo up front would be
 * asking for the one thing the user has not decided yet. Attaching a repo or
 * starting a shell in it is what gives it both.
 */
export async function newWorkspace(): Promise<Workspace | null> {
  const workspace = await useSpurStore.getState().addWorkspace(null, []);
  if (workspace) focusWorkspace(workspace);
  return workspace;
}

/**
 * The queue's static commands — the per-item ones are built by
 * [`workspaceCommands`], which rebuilds whenever the queue changes.
 */
export const WORKSPACE_COMMANDS: readonly Command[] = [
  {
    id: "workspace.new",
    title: "New Workspace",
    category: "Workspaces",
    keywords: ["add", "card", "working on", "queue"],
    // ⌘N used to open a second app window. Windows and macOS tabs are both
    // gone: a workspace is how this app holds two things at once, so ⌘N makes
    // one of those instead.
    shortcut: { code: "KeyN", mod: true },
    // Same reach as ⌘1–9 for the same reason — starting somewhere new must not
    // depend on whether the caret is in a shell or a search field.
    allowInInput: true,
    allowInTerminal: true,
    run: () => void newWorkspace(),
  },
];

/**
 * One command per work item, ⌘1–9 for the first nine.
 *
 * The digits used to walk the sidebar's rows, which meant the app's most-used
 * navigation was positional over a list the app reordered on its own. They
 * follow the one list the user orders by hand instead: ⌘3 is the third card,
 * and it stays the third card until the user drags it.
 */
let cache: { items: Workspace[]; commands: Command[] } | null = null;

export function workspaceCommands(): Command[] {
  const items = useSpurStore.getState().workspaces;
  // Every keystroke in the palette re-resolves every dynamic source, so the
  // list is rebuilt only when the queue itself changes. `loadWorkspaces` keeps
  // the previous array when a refresh returns an identical list, which is what
  // makes identity the right test.
  if (cache?.items === items) return cache.commands;

  const commands: Command[] = items.map((item, index) => ({
    id: `workspace.focus.${item.id}`,
    title: item.displayTitle,
    category: "Workspaces",
    keywords: item.attachments.flatMap((attachment) =>
      attachment.refName ? [attachment.refName] : [],
    ),
    shortcut:
      index < SHORTCUT_LIMIT
        ? { code: `Digit${index + 1}`, mod: true }
        : undefined,
    // Switching workspaces is the app's most-used gesture and it must not
    // depend on where the caret is. ⌘ combinations are never forwarded to a
    // PTY, and no text field wants ⌘3 either, so these answer from inside a
    // shell and inside a search box exactly as they do from the sidebar.
    allowInInput: true,
    allowInTerminal: true,
    run: () => focusWorkspace(item),
  }));

  cache = { items, commands };
  return commands;
}
