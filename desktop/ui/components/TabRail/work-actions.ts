/**
 * What every noun in the sidebar can do, as data.
 *
 * The rule this module exists to keep: a noun's verbs are defined once, and
 * every channel that offers them — a context menu, an overflow dropdown, a drag
 * — reads that one definition. The alternative, which this replaced, was a menu
 * per component: the card knew how to unbind a ref and the chip knew how to
 * drag one onto another card, and neither knew what the other offered, so what
 * you could do depended on which pixel you were over.
 *
 * Every verb whose gesture also exists as a drag runs the *drag's* code —
 * `applyWorkDrop`, or the slice action it calls — rather than its own copy of
 * the mutation. That is what `work-actions.test` asserts, and it is why "move
 * this ref to that item" can't mean two different things.
 *
 * Kept JSX-free: the lists are pure functions of the noun and the store's
 * current answer about it, so they can be walked in a test without a DOM. The
 * renderers live in `ActionMenu`.
 */

import { getApiClient } from "../../api";
import { getPlatformServices } from "../../platform";
import { useReviewStore } from "../../stores";
import { useWorkItems } from "../../stores/selectors/work";
import { activateWorkItem, activateWorkRef } from "../../commands/workCommands";
import { closeTerminals } from "../Terminal/close";
import { jumpToTerminal } from "../Terminal/jump";
import type { ViewerPr, WorkItem, WorkRef } from "../../types";
import { applyWorkDrop } from "./work-drag";
import { workItemTitle, type WorkItemStatus } from "./work-status";

/**
 * One verb.
 *
 * `items` makes it a submenu instead — the shape a verb takes when it needs a
 * target chosen from a list ("move this ref to *which* item"), which is exactly
 * the choice the equivalent drag makes with the pointer.
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
 * The id without its target suffix — `work.ref.move:abc` → `work.ref.move`.
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
 * same act. Gap indices count the list as it looks before the card is lifted
 * out, which is why "down" is `index + 2` — see `gapPosition`.
 */
function moveCard(item: WorkItem, index: number, gapIndex: number): void {
  void applyWorkDrop(
    { kind: "gap", index: gapIndex },
    { kind: "item", drag: { id: item.id, index } },
  );
}

export interface WorkItemActionsInput {
  item: WorkItem;
  index: number;
  /** How many cards there are, so the end of the list can decline "down". */
  count: number;
  /** The card's own derived status — where the PR and the chip labels are. */
  status: WorkItemStatus;
  /** Start the card's inline rename. Component state, so the card supplies it. */
  onRename: () => void;
}

export function workItemActions({
  item,
  index,
  count,
  status,
  onRename,
}: WorkItemActionsInput): WorkAction[] {
  const refVerbs = status.refs.map((refStatus) => ({
    refStatus,
    verbs: [
      {
        id: `work.item.ref.activate:${refStatus.reviewKey}`,
        label: `Activate ${refStatus.ref.ref}`,
        run: () => activateWorkRef(refStatus.ref),
      },
      {
        id: `work.item.ref.unbind:${refStatus.reviewKey}`,
        label: `Unbind ${refStatus.ref.ref}`,
        run: () => void store().unbindWorkItem(item.id, refStatus.ref),
      },
      {
        id: `work.item.ref.copy:${refStatus.reviewKey}`,
        label: "Copy branch name",
        run: () => copy(refStatus.ref.ref),
      },
    ],
  }));

  return [
    {
      id: "work.item.activate",
      label: "Activate",
      disabled: item.refs.length === 0,
      run: () => activateWorkItem(item),
    },
    { id: "work.item.rename", label: "Rename", run: onRename },
    {
      id: "work.item.moveTop",
      label: "Move to top",
      disabled: index === 0,
      run: () => moveCard(item, index, 0),
    },
    {
      id: "work.item.moveUp",
      label: "Move up",
      disabled: index === 0,
      run: () => moveCard(item, index, index - 1),
    },
    {
      id: "work.item.moveDown",
      label: "Move down",
      disabled: index >= count - 1,
      run: () => moveCard(item, index, index + 2),
    },
    // One ref needs no submenu — the three verbs name it themselves. Several
    // do, or the card's menu becomes a list of branches you have to read twice.
    ...(refVerbs.length === 1
      ? refVerbs[0].verbs
      : refVerbs.map(({ refStatus, verbs }) => ({
          id: `work.item.ref:${refStatus.reviewKey}`,
          label: refStatus.chipLabel,
          items: verbs,
        }))),
    ...openPrAction("work.item.openPr", status.openPr),
    {
      id: "work.item.remove",
      label: "Remove",
      danger: true,
      run: () => void store().removeWorkItem(item.id),
    },
  ];
}

// ----- Ref chip (one binding on a card) -----

export interface WorkRefActionsInput {
  ref: WorkRef;
  /** The card it is bound to — a chip always has one. */
  fromItemId: string;
  items: WorkItem[];
}

export function workRefActions({
  ref,
  fromItemId,
  items,
}: WorkRefActionsInput): WorkAction[] {
  const others = items.filter((item) => item.id !== fromItemId);

  return [
    {
      id: "work.ref.activate",
      label: "Activate this ref",
      run: () => activateWorkRef(ref),
    },
    {
      id: "work.ref.unbind",
      label: "Unbind",
      run: () => void store().unbindWorkItem(fromItemId, ref),
    },
    {
      id: "work.ref.move",
      label: "Move to",
      disabled: others.length === 0,
      // The chip drag's own drop, target picked from a list instead of with
      // the pointer: unbind here, bind there, in that order.
      items: others.map((item) => ({
        id: `work.ref.move:${item.id}`,
        label: workItemTitle(item),
        run: () =>
          void applyWorkDrop(
            { kind: "card", itemId: item.id },
            { kind: "ref", drag: { ref, fromItemId } },
          ),
      })),
    },
    {
      id: "work.ref.copy",
      label: "Copy branch name",
      run: () => copy(ref.ref),
    },
  ];
}

// ----- Terminal session -----

export interface TerminalActionsInput {
  /** The tab's sessions — one for an unsplit tab, all of them for a split one. */
  sessionIds: string[];
  /** The work item the tab is attached to, or null. */
  attachedItemId: string | null;
  items: WorkItem[];
}

/**
 * The terminal menu — the same one on a band row, a card's child row, a strip
 * tab and a pane.
 *
 * The noun is the tab in every case; what differs is only how many of its panes
 * the surface can see. Every verb applies to all of them, which is what makes
 * one definition possible.
 */
export function terminalActions({
  sessionIds,
  attachedItemId,
  items,
}: TerminalActionsInput): WorkAction[] {
  const attach = (target: Parameters<typeof applyWorkDrop>[0]) =>
    void applyWorkDrop(target, { kind: "terminal", sessionIds });

  return [
    {
      id: "terminal.addTo",
      label: "Add to",
      items: [
        ...items.map((item) => ({
          id: `terminal.addTo:${item.id}`,
          label: workItemTitle(item),
          disabled: item.id === attachedItemId,
          run: () => attach({ kind: "card", itemId: item.id }),
        })),
        {
          id: "terminal.addTo.new",
          label: "New item",
          // The section's end, which is where a drop past the last card lands
          // — and, like that drop, the new card takes the shell's name.
          run: () => attach({ kind: "gap", index: items.length }),
        },
      ],
    },
    ...(attachedItemId
      ? [
          {
            id: "terminal.detach",
            label: "Detach from work item",
            // Naming one pane detaches the tab it belongs to — the attachment
            // was never a per-pane fact.
            run: () => store().detachTerminal(sessionIds[0]),
          },
        ]
      : []),
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

// ----- Branch-bearing tree rows -----

/** The "Add to Working on" verb's state as well as its action. */
export interface AddToWork {
  bound: boolean;
  label: string;
  add: () => void;
}

/**
 * "Add this ref to Working on", for whatever menu is asking.
 *
 * The state as well as the action, because the two belong together: once an
 * item holds the ref the backend rejects a second binding, so the entry has
 * nothing left to offer and says so instead of firing a failure.
 */
export function useAddToWork(repoPath: string, reviewRef: string): AddToWork {
  const addWorkItem = useReviewStore((s) => s.addWorkItem);
  // One ref against the queue, so this asks rather than building the set of
  // every covered key — it runs on every row of the tree and every open menu.
  const bound = useWorkItems().some((item) =>
    item.refs.some((ref) => ref.repoPath === repoPath && ref.ref === reviewRef),
  );

  return {
    bound,
    label: bound ? "In Working on" : "Add to Working on",
    add: () => void addWorkItem("", [{ repoPath, ref: reviewRef }]),
  };
}

export interface RefRowActionsInput {
  ref: string;
  addToWork: AddToWork;
  openPr?: ViewerPr;
  /** What clicking the row does — the menu says it out loud. */
  onOpen: () => void;
}

/** A local branch, a review, a remote branch, or an open PR: one row, one menu. */
export function refRowActions({
  ref,
  addToWork,
  openPr,
  onOpen,
}: RefRowActionsInput): WorkAction[] {
  return [
    {
      id: "row.addToWork",
      label: addToWork.label,
      disabled: addToWork.bound,
      run: addToWork.add,
    },
    { id: "row.open", label: "Open", run: onOpen },
    { id: "row.copyBranch", label: "Copy branch name", run: () => copy(ref) },
    ...openPrAction("row.openPr", openPr),
  ];
}

// ----- Repo rows -----

/** Fetch, then re-read: a no-op fetch only moves FETCH_HEAD, which the watcher
 *  ignores, so the "last fetched" stamp would otherwise never tick. */
export async function fetchRepoOrigins(repoPaths: string[]): Promise<void> {
  const client = getApiClient();
  await Promise.allSettled(repoPaths.map((path) => client.fetchOrigin(path)));
  await store().loadLocalActivity();
}

export interface RepoRowActionsInput {
  repoPath: string;
  /** Null when the repo has nothing checked out — no ref to add. */
  addToWork: AddToWork | null;
  /** The repo's page on its forge, when the remote resolved to one. */
  browseUrl: string | null;
  onRemove: () => void;
}

export function repoRowActions({
  repoPath,
  addToWork,
  browseUrl,
  onRemove,
}: RepoRowActionsInput): WorkAction[] {
  return [
    ...(addToWork
      ? [
          {
            id: "repo.addToWork",
            label: addToWork.label,
            disabled: addToWork.bound,
            run: addToWork.add,
          },
        ]
      : []),
    {
      id: "repo.fetch",
      label: "Fetch from origin",
      run: () => void fetchRepoOrigins([repoPath]),
    },
    { id: "repo.copyPath", label: "Copy path", run: () => copy(repoPath) },
    ...(browseUrl
      ? [
          {
            id: "repo.openOnGitHub",
            label: "Open on GitHub",
            run: () => open(browseUrl),
          },
        ]
      : []),
    {
      id: "repo.remove",
      label: "Remove from sidebar",
      danger: true,
      run: onRemove,
    },
  ];
}

/**
 * A repo this machine doesn't have, or a PR in one: the only two nouns whose
 * every verb points off the machine, so both get the same pair.
 */
export function externalActions(
  noun: "unclonedRepo" | "unclonedPr",
  url: string,
): WorkAction[] {
  return [
    { id: `${noun}.open`, label: "Open on GitHub", run: () => open(url) },
    { id: `${noun}.copyUrl`, label: "Copy URL", run: () => copy(url) },
  ];
}

// ----- Org header -----

export interface OrgActionsInput {
  org: string;
  /** Every org in the sidebar, so "collapse the others" knows who they are. */
  allOrgs: string[];
  /** The org's cloned repos — the ones a fetch can reach. */
  repoPaths: string[];
}

export function orgActions({
  org,
  allOrgs,
  repoPaths,
}: OrgActionsInput): WorkAction[] {
  return [
    {
      id: "org.collapseOthers",
      label: "Collapse other orgs",
      disabled: allOrgs.length < 2,
      run: () => {
        const setOrgCollapsed = store().setOrgCollapsed;
        for (const other of allOrgs) {
          if (other !== org) setOrgCollapsed(other, true);
        }
      },
    },
    {
      id: "org.fetchAll",
      label: "Fetch all repos in org",
      disabled: repoPaths.length === 0,
      run: () => void fetchRepoOrigins(repoPaths),
    },
  ];
}
