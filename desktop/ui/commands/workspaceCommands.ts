import { useReviewStore } from "../stores";
import { findSidebarRow, getSidebarTree } from "../stores/selectors/sidebar";
import type { ReviewTarget } from "../stores/selectors/workspaceData";
import { ackAttention } from "../utils/attention";
import { makeReviewKey, refFromReviewKey } from "../utils/review-key";
import type { SidebarRow } from "../utils/sidebar-tree";
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
 * Open one comparison — a repo tab, the menu's "Open", a ⌘K branch row.
 *
 * Resolves to whether it opened anything. A ref nothing represents — the branch
 * was deleted, or its repo isn't registered here — deliberately opens no
 * review: showing a diff of something that isn't there is worse than showing
 * nothing. The caller is what decides what "nothing" looks like.
 */
export function activateReviewTarget(target: ReviewTarget): boolean {
  const key = makeReviewKey(target.repoPath, target.ref);
  if (!findSidebarRow(useReviewStore.getState(), key)) return false;

  getCommandUi().activateReviewKey(target.repoPath, target.ref);
  return true;
}

/**
 * The comparison a repo tab opens.
 *
 * A tab that names a ref opens that ref or nothing — falling back to whatever
 * the repo has checked out would put another branch's diff under a label that
 * says "· feature". A tab with no ref names only the repo, and there the
 * checkout *is* the honest answer: that is what a repo picked without a branch
 * means.
 */
export function targetForAttachment(
  attachment: Attachment,
): ReviewTarget | null {
  const state = useReviewStore.getState();
  if (attachment.refName) {
    const key = makeReviewKey(attachment.path, attachment.refName);
    return findSidebarRow(state, key)
      ? { repoPath: attachment.path, ref: attachment.refName }
      : null;
  }
  const head = getSidebarTree(state).find(
    (node) => node.repoPath === attachment.path,
  )?.head;
  return head ? { repoPath: head.repoPath, ref: head.ref } : null;
}

/** Open an attachment's tab on the code side. See [`targetForAttachment`]. */
export function activateAttachment(attachment: Attachment): boolean {
  const target = targetForAttachment(attachment);
  return target !== null && activateReviewTarget(target);
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
 * A workspace with no attachment — or one whose repo nothing on this machine
 * represents — has no comparison, so the code half goes to the workspace's
 * empty state instead of leaving the last workspace's diff on screen under this
 * one's name.
 */
export function focusWorkspace(
  workspace: Workspace,
  target?: ReviewTarget,
  options: { acknowledge?: boolean } = {},
): void {
  const store = useReviewStore.getState();
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

  // `target` is the caller naming which comparison to open — a ⌘K row names a
  // branch, not just a workspace, and on a multi-repo workspace that is
  // precisely the one its own first tab is not. Without one, the first tab is
  // what opens, resolved exactly as clicking that tab would resolve it.
  const first = workspace.attachments[0];
  const opening = target ?? (first ? targetForAttachment(first) : null);

  // The empty state is also where a workspace lands when its tab can't be
  // opened — an unregistered repo, a deleted branch — because the alternative
  // is a header naming this workspace over the last one's diff.
  if (!opening || !activateReviewTarget(opening)) getCommandUi().navigate("/");

  store.selectWorkspaceTab(workspace.id);
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
 */
export async function openRowInWorkspace(
  row: SidebarRow,
  options: { withTerminal?: boolean } = {},
): Promise<Workspace | null> {
  const workspace = await useReviewStore
    .getState()
    .routeWorkspace(row.repoPath, row.ref);
  if (!workspace) return null;

  const target: ReviewTarget = {
    repoPath: row.repoPath,
    ref: refFromReviewKey(row.reviewKey, row.repoPath) ?? row.ref,
  };
  focusWorkspace(workspace, target);
  // On the branch that was named, not on whichever repo the workspace happens
  // to list first.
  if (options.withTerminal) void openTerminalTab(workspace, target);
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
  const workspace = await useReviewStore.getState().addWorkspace(null, []);
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
  const items = useReviewStore.getState().workspaces;
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
