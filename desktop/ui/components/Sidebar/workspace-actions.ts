/**
 * What every noun in the sidebar can do, as data.
 *
 * The rule this module exists to keep: a noun's verbs are defined once, and
 * every channel that offers them — a context menu, an overflow dropdown, a drag
 * — reads that one definition. The alternative, which this replaced, was a menu
 * per component: each surface knew half the verbs, so what you could do
 * depended on which pixel you were over.
 *
 * Every verb whose gesture also exists as a drag runs the *drag's* code —
 * `applyWorkDrop`, or the slice action it calls — rather than its own copy of
 * the mutation. That is what `workspace-actions.test` asserts, and it is why
 * "move this terminal to that workspace" can't mean two different things.
 *
 * Kept JSX-free: the lists are pure functions of the noun and the store's
 * current answer about it, so they can be walked in a test without a DOM. The
 * renderers live in `ActionMenu`.
 */

import { getPlatformServices } from "../../platform";
import { useReviewStore } from "../../stores";
import {
  focusWorkspace,
  activateAttachment,
} from "../../commands/workspaceCommands";
import { closeTerminals } from "../Terminal/close";
import { jumpToTerminal } from "../Terminal/jump";
import { openTerminalTab } from "../Terminal/newTab";
import type { ViewerPr, Workspace } from "../../types";
import { applyWorkDrop } from "./workspace-drag";
import { type WorkspaceStatus } from "./workspace-status";

/**
 * One verb.
 *
 * `items` makes it a submenu instead — the shape a verb takes when it needs a
 * target chosen from a list ("move this terminal to *which* workspace"), which
 * is exactly the choice the equivalent drag makes with the pointer.
 */
export interface WorkAction {
  id: string;
  label: string;
  run?: () => void;
  /** Nested verbs. Set instead of `run`, never alongside it. */
  items?: WorkAction[];
  disabled?: boolean;
  /** Destructive — the renderers colour it. */
  danger?: boolean;
}

/** Every verb in `actions`, submenu contents included. */
export function flattenWorkActions(actions: WorkAction[]): WorkAction[] {
  return actions.flatMap((action) =>
    action.items ? [action, ...flattenWorkActions(action.items)] : [action],
  );
}

/**
 * The id without its target suffix — `terminal.addTo:abc` → `terminal.addTo`.
 *
 * Verbs aimed at a chosen target carry that target in the id so React keys and
 * the parity test can both tell two of them apart; the verb itself is the half
 * in front.
 */
export function workActionVerb(id: string): string {
  const colon = id.indexOf(":");
  return colon === -1 ? id : id.slice(0, colon);
}

function store(): ReturnType<typeof useReviewStore.getState> {
  return useReviewStore.getState();
}

function copy(text: string): void {
  void getPlatformServices()
    .clipboard.writeText(text)
    .catch((err) => console.error("Failed to copy:", err));
}

function open(url: string): void {
  void getPlatformServices()
    .opener.openUrl(url)
    .catch((err) => console.error("Failed to open URL:", err));
}

/** The PR verb, when the noun has a PR to offer it for. */
function openPrAction(id: string, pr: ViewerPr | undefined): WorkAction[] {
  if (!pr) return [];
  return [
    { id, label: `Open #${pr.number} on GitHub`, run: () => open(pr.url) },
  ];
}

// ----- Work item (a card) -----

/**
 * Reorder through the drop path, so a menu move and a dragged move are the
 * same act. Gap indices count the list as it looks before the entry is lifted
 * out, which is why "down" is `index + 2` — see `gapPosition`.
 */
function moveEntry(
  workspace: Workspace,
  index: number,
  gapIndex: number,
): void {
  void applyWorkDrop(
    { kind: "gap", index: gapIndex },
    { kind: "item", drag: { id: workspace.id, index } },
  );
}

export interface WorkspaceActionsInput {
  workspace: Workspace;
  index: number;
  /** How many entries there are, so the end of the list declines "down". */
  count: number;
  /** The entry's derived status — where the PR and the chip labels are. */
  status: WorkspaceStatus;
  /** Start the inline rename. Component state, so the entry supplies it. */
  onRename: () => void;
}

export function workspaceActions({
  workspace,
  index,
  count,
  status,
  onRename,
}: WorkspaceActionsInput): WorkAction[] {
  const repoVerbs = status.repos.map((repo) => ({
    repo,
    verbs: [
      {
        id: `workspace.repo.open:${repo.reviewKey}`,
        label: `Open ${repo.chipLabel}`,
        run: () => activateAttachment(repo.attachment),
      },
      {
        id: `workspace.repo.remove:${repo.reviewKey}`,
        label: `Close ${repo.chipLabel}`,
        run: () =>
          void store().detachWorkspace(workspace.id, repo.attachment.path),
      },
      {
        id: `workspace.repo.copy:${repo.reviewKey}`,
        label: "Copy branch name",
        disabled: !repo.attachment.refName,
        run: () => copy(repo.attachment.refName ?? ""),
      },
    ],
  }));

  return [
    {
      id: "workspace.focus",
      label: "Open",
      run: () => focusWorkspace(workspace),
    },
    // ⌘T's verb, for the hand that is already on this card. Same call, so a
    // terminal started from the menu lands where ⌘T would put it — after
    // focusing, because the panel only draws the focused workspace's tabs and
    // a shell started into a workspace you are not looking at is a shell you
    // cannot see.
    {
      id: "workspace.newTerminal",
      label: "New terminal",
      run: () => {
        focusWorkspace(workspace);
        void openTerminalTab(workspace);
      },
    },
    { id: "workspace.rename", label: "Rename", run: onRename },
    {
      id: "workspace.moveTop",
      label: "Move to top",
      disabled: index === 0,
      run: () => moveEntry(workspace, index, 0),
    },
    {
      id: "workspace.moveUp",
      label: "Move up",
      disabled: index === 0,
      run: () => moveEntry(workspace, index, index - 1),
    },
    {
      id: "workspace.moveDown",
      label: "Move down",
      disabled: index >= count - 1,
      run: () => moveEntry(workspace, index, index + 2),
    },
    // One repo needs no submenu — the three verbs name it themselves. Several
    // do, or the menu becomes a list of branches you have to read twice.
    ...(repoVerbs.length === 1
      ? repoVerbs[0].verbs
      : repoVerbs.map(({ repo, verbs }) => ({
          id: `workspace.repo:${repo.reviewKey}`,
          label: repo.chipLabel,
          items: verbs,
        }))),
    ...openPrAction("workspace.openPr", status.openPr),
    {
      id: "workspace.remove",
      label: "Remove",
      danger: true,
      run: () => void store().removeWorkspace(workspace.id),
    },
  ];
}

// ----- Terminal session -----

export interface TerminalActionsInput {
  /** The tab's sessions — one for an unsplit tab, all of them for a split one. */
  sessionIds: string[];
  /**
   * The workspace the tab is in, so "Add to" can decline the one it is already
   * in. Null only while its sessions are unknown — every terminal is in a
   * workspace, which is why there is no verb here for leaving one.
   */
  attachedItemId: string | null;
  workspaces: Workspace[];
}

/**
 * The terminal menu — the same one on a card's child row, a strip tab and a
 * pane.
 *
 * The noun is the tab in every case; what differs is only how many of its panes
 * the surface can see. Every verb applies to all of them, which is what makes
 * one definition possible.
 */
export function terminalActions({
  sessionIds,
  attachedItemId,
  workspaces,
}: TerminalActionsInput): WorkAction[] {
  const attach = (target: Parameters<typeof applyWorkDrop>[0]) =>
    void applyWorkDrop(target, { kind: "terminal", sessionIds });

  return [
    {
      id: "terminal.addTo",
      label: "Add to",
      items: [
        ...workspaces.map((workspace) => ({
          id: `terminal.addTo:${workspace.id}`,
          label: workspace.displayTitle,
          disabled: workspace.id === attachedItemId,
          run: () => attach({ kind: "card", itemId: workspace.id }),
        })),
        {
          id: "terminal.addTo.new",
          label: "New workspace",
          // The queue's end, which is where a drop past the last entry lands —
          // and, like that drop, the new workspace takes the shell's name.
          run: () => attach({ kind: "gap", index: workspaces.length }),
        },
      ],
    },
    {
      id: "terminal.jump",
      label: "Jump to terminal",
      run: () => jumpToTerminal(sessionIds[0]),
    },
    {
      id: "terminal.kill",
      label: sessionIds.length > 1 ? "Kill terminals" : "Kill terminal",
      danger: true,
      run: () => void closeTerminals(sessionIds),
    },
  ];
}
