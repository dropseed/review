/**
 * Shared state for the "Working on" section's drags: a card picked up to
 * reorder it, a branch-bearing tree row picked up to bind it to an item, a ref
 * chip pulled off one card and onto another, and a terminal row dropped onto a
 * card to attach it.
 *
 * Built the way `pane-drag` is, for the same reason: under Tauri the drop
 * arrives on the window after the page's own `dragend`, with `dataTransfer`
 * unreadable, so what is being carried has to be latched in the module. The
 * MIME types still go on the `dataTransfer` because `types` is the only thing a
 * `dragover` handler can read, and that is where a target decides whether it
 * takes the drop at all.
 */

import { useSyncExternalStore } from "react";
import { useReviewStore } from "../../stores";
import {
  draggedPane,
  draggedTabSource,
  draggedTerminal,
  pointerLeft,
  subscribePaneDrag,
  TERMINAL_PANE_MIME,
  TERMINAL_SESSION_MIME,
  TERMINAL_TAB_MIME,
} from "../Terminal/pane-drag";
import { sessionTitle } from "../Terminal/glance";
import { collectLeafIds } from "../Terminal/pane-tree";
import { findTab, tabSessionIds } from "../../stores/slices/terminalSlice";
import type { WorkRef } from "../../types";

/** A branch-bearing row or ref chip in flight. */
export const WORK_REF_MIME = "application/x-review-workref";
/** A work card in flight, being reordered. */
export const WORK_ITEM_MIME = "application/x-review-workitem";

export interface WorkRefDrag {
  ref: WorkRef;
  /** The card it was pulled off, when it came from one — a reassociation. */
  fromItemId: string | null;
}

export interface WorkItemDrag {
  id: string;
  /** Position in the section, so a drop between cards can be a no-op. */
  index: number;
}

/**
 * Where a drop would land: on a card, or in the gap before card `index`
 * (`index === items.length` is the end of the list).
 */
export type WorkDropTarget =
  { kind: "card"; itemId: string } | { kind: "gap"; index: number };

let draggedRef: WorkRefDrag | null = null;
let draggedItem: WorkItemDrag | null = null;
let dropTarget: WorkDropTarget | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setDraggedWorkRef(drag: WorkRefDrag | null): void {
  draggedRef = drag;
  // Nothing in flight, nowhere to land — a target left lit after a cancelled
  // drag is an insertion line with nothing to insert.
  if (drag === null) dropTarget = null;
  notify();
}

export function draggedWorkRef(): WorkRefDrag | null {
  return draggedRef;
}

export function setDraggedWorkItem(drag: WorkItemDrag | null): void {
  draggedItem = drag;
  if (drag === null) dropTarget = null;
  notify();
}

export function draggedWorkItem(): WorkItemDrag | null {
  return draggedItem;
}

function sameTarget(
  a: WorkDropTarget | null,
  b: WorkDropTarget | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "card"
    ? a.itemId === (b as typeof a).itemId
    : a.index === (b as { index: number }).index;
}

export function setWorkDropTarget(target: WorkDropTarget | null): void {
  if (sameTarget(dropTarget, target)) return;
  dropTarget = target;
  notify();
}

/**
 * Clear the target, but only if it is still the one held — crossing from one
 * card to the next fires `dragenter` on the arrival before `dragleave` on the
 * departure, so an unconditional clear erases the highlight just published.
 */
export function clearWorkDropTarget(target: WorkDropTarget): void {
  if (sameTarget(dropTarget, target)) setWorkDropTarget(null);
}

/** The drop target, re-rendering the caller when it changes. */
export function useWorkDropTarget(): WorkDropTarget | null {
  return useSyncExternalStore(
    subscribe,
    () => dropTarget,
    () => null,
  );
}

/**
 * Whether anything the section takes is in flight — what opens the gaps.
 *
 * Terminals are dragged from the other module, so both are subscribed: a gap
 * that stays inert during a terminal drag is a drop the user is shown no way
 * to make. That covers every way a terminal can be picked up, panel panes and
 * tabs included — see `terminalsInFlight`.
 */
export function useWorkDragActive(): boolean {
  const own = useSyncExternalStore(
    subscribe,
    () => draggedRef !== null || draggedItem !== null,
    () => false,
  );
  const terminal = useSyncExternalStore(
    subscribePaneDrag,
    () => terminalDragActive(),
    () => false,
  );
  return own || terminal;
}

/** Whether a terminal is being carried by any of its three grips. */
function terminalDragActive(): boolean {
  return (
    draggedTerminal() !== null ||
    draggedPane() !== null ||
    draggedTabSource() !== null
  );
}

/**
 * The sessions a terminal drag is carrying, whichever grip started it: a
 * sidebar row, a panel pane, or a panel tab.
 *
 * Always the whole tab. The three grips differ in what they *name* — a session,
 * a pane, a tab — but the tab is the terminal as far as anything outside the
 * panel is concerned, so all three resolve to the same set. That is where "the
 * panel's drags and the sidebar's drags are one drag" is actually true: a card
 * doesn't have to know which grip the terminal arrived by.
 */
export function terminalsInFlight(): string[] {
  const tabs = useReviewStore.getState().terminalTabs;
  // A pane *is* a session — the leaf's id is the terminal's.
  const terminal = draggedTerminal() ?? draggedPane();
  if (terminal) return tabSessionIds(tabs, terminal);
  const tab = draggedTabSource();
  return tab ? sessionsOfTab(tab.tabId) : [];
}

/**
 * Every session a strip tab holds. Exported for the Tauri drop path, which
 * latches the tab id at `over` and resolves it after its own `dragend`.
 */
export function sessionsOfTab(tabId: string): string[] {
  const tab = findTab(useReviewStore.getState().terminalTabs, tabId);
  return tab ? collectLeafIds(tab.root) : [];
}

/**
 * Attach the payload every work drag carries: the module latch, the MIME the
 * targets test for, and a text fallback, since some webviews won't start a drag
 * without one and an empty string is the payload that can't be pasted into
 * whatever the drag is released over.
 */
export function startWorkRefDrag(
  event: React.DragEvent,
  drag: WorkRefDrag,
): void {
  setDraggedWorkRef(drag);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(
    WORK_REF_MIME,
    `${drag.ref.repoPath}\n${drag.ref.ref}`,
  );
  event.dataTransfer.setData("text/plain", "");
}

export function startWorkItemDrag(
  event: React.DragEvent,
  drag: WorkItemDrag,
): void {
  setDraggedWorkItem(drag);
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData(WORK_ITEM_MIME, drag.id);
  event.dataTransfer.setData("text/plain", "");
}

/** The three ways a terminal announces itself to a target mid-drag. */
const TERMINAL_MIMES = [
  TERMINAL_SESSION_MIME,
  TERMINAL_PANE_MIME,
  TERMINAL_TAB_MIME,
];

function carriesTerminal(types: readonly string[]): boolean {
  return TERMINAL_MIMES.some((mime) => types.includes(mime));
}

/** Whether a dragover carries something the section can take. */
export function isWorkDrag(types: readonly string[]): boolean {
  return (
    types.includes(WORK_REF_MIME) ||
    types.includes(WORK_ITEM_MIME) ||
    carriesTerminal(types)
  );
}

/**
 * Whether a dragover carries something a *card* can take — everything the
 * section takes except another card, which lands in a gap or nowhere.
 *
 * Beside `isWorkDrag` so the two accept-rules are read together rather than one
 * of them being spelled out inline at the target that applies it.
 */
export function isWorkCardDrag(types: readonly string[]): boolean {
  return types.includes(WORK_REF_MIME) || carriesTerminal(types);
}

/** What a drop carries, whichever latch was set when it landed. */
export type WorkDropPayload =
  | { kind: "ref"; drag: WorkRefDrag }
  | { kind: "item"; drag: WorkItemDrag }
  /** One tab's sessions — whichever grip picked the terminal up. */
  | { kind: "terminal"; sessionIds: string[] };

/**
 * Whichever latch is set, as the payload `applyWorkDrop` takes.
 *
 * The read half of the latch protocol, which both drop paths had grown their
 * own copy of — they find their target differently, but "what is being carried"
 * has one answer. Takes the three values rather than reading them, because the
 * Tauri path can't: the page's `dragend` clears the latches while its drop event
 * is still crossing the IPC, so that path drops from copies it took at `over`.
 */
export function workDragPayload(
  ref: WorkRefDrag | null,
  item: WorkItemDrag | null,
  sessionIds: readonly string[],
): WorkDropPayload | null {
  if (ref) return { kind: "ref", drag: ref };
  if (item) return { kind: "item", drag: item };
  if (sessionIds.length > 0)
    return { kind: "terminal", sessionIds: [...sessionIds] };
  return null;
}

/** [`workDragPayload`] over the live latches — the HTML5 drop path's read. */
export function takeWorkDragPayload(): WorkDropPayload | null {
  return workDragPayload(
    draggedWorkRef(),
    draggedWorkItem(),
    terminalsInFlight(),
  );
}

/**
 * The three drop-target handlers, for a target that accepts `accepts`.
 *
 * Cards and gaps differ only in what they take; sharing the handlers is what
 * keeps the `stopPropagation` (a card sits inside the section's gaps) and the
 * conditional leave-clear from being restated per target.
 */
export function workDropHandlers(
  self: WorkDropTarget,
  accepts: (types: readonly string[]) => boolean,
): {
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
} {
  return {
    onDragOver: (event) => {
      if (!accepts(event.dataTransfer.types)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setWorkDropTarget(self);
    },
    onDragLeave: (event) => {
      if (pointerLeft(event)) clearWorkDropTarget(self);
    },
    onDrop: (event) => {
      clearWorkDropTarget(self);
      const payload = takeWorkDragPayload();
      if (!payload) return;
      event.preventDefault();
      event.stopPropagation();
      void applyWorkDrop(self, payload);
    },
  };
}

/**
 * The position a card dragged from `from` should end up at, given the gap it
 * was dropped in.
 *
 * Gap indices count the list as it looks on screen; the move happens after the
 * card has been lifted out, so every gap below it has shifted up by one. Off by
 * one here is a drag that lands one row from where the insertion line was.
 */
export function gapPosition(from: number, gapIndex: number): number {
  return gapIndex > from ? gapIndex - 1 : gapIndex;
}

/**
 * Perform a drop.
 *
 * The one implementation, called by the HTML5 handlers in web mode and by the
 * window-level Tauri handler in the desktop app — the two paths have different
 * ways of finding the target and must not have different ways of honoring it.
 *
 * Every mutation is attempted rather than pre-checked: the backend rejects a
 * ref two items would hold, with a message naming the item that has it, and
 * that message is more use than a drop that silently does nothing.
 */
export async function applyWorkDrop(
  target: WorkDropTarget,
  payload: WorkDropPayload,
): Promise<void> {
  const store = useReviewStore.getState();

  if (payload.kind === "item") {
    if (target.kind === "card") return;
    const to = gapPosition(payload.drag.index, target.index);
    if (to === payload.drag.index) return;
    await store.moveWorkItem(payload.drag.id, to);
    return;
  }

  if (payload.kind === "terminal") {
    const first = payload.sessionIds[0];
    if (!first) return;
    // The name a new card takes from the shell it was made by, resolved here
    // rather than at the call sites: both of them had it, and a title is a
    // detail of honoring the drop, not of finding it. A split tab arrives with
    // several sessions and one name — the first pane's, which is the tab's own.
    const title = sessionTitle(
      store.terminalStatuses[first],
      store.terminalSessions[first],
    );
    const itemId =
      target.kind === "card"
        ? target.itemId
        : ((await store.addWorkItem(title, []))?.id ?? null);
    if (!itemId) return;
    // One call: the ids are one tab's panes, and attaching is a fact about the
    // tab. Naming any of them names it.
    store.attachTerminalToItem(first, itemId);
    if (target.kind === "gap") {
      await store.moveWorkItem(itemId, target.index);
    }
    return;
  }

  // Moving a ref is unbind-here then bind-there, two writes with no
  // transaction around them. If the second is refused — the target was removed
  // by the CLI mid-drag, or the write contended out — the ref belongs to
  // nothing: the source card lost it, nobody gained it, and a card left with no
  // refs can never get it back on its own. So the first write is undone.
  const { ref, fromItemId } = payload.drag;
  if (target.kind === "card") {
    if (fromItemId === target.itemId) return;
    if (fromItemId && !(await store.unbindWorkItem(fromItemId, ref))) return;
    const bound = await store.bindWorkItem(target.itemId, ref);
    if (!bound && fromItemId) await restoreRef(fromItemId, ref);
    return;
  }

  if (fromItemId && !(await store.unbindWorkItem(fromItemId, ref))) return;
  const created = await store.addWorkItem("", [ref]);
  if (!created) {
    if (fromItemId) await restoreRef(fromItemId, ref);
    return;
  }
  await store.moveWorkItem(created.id, target.index);
}

/**
 * Put a ref back on the item it was moved off, after the other half of the move
 * failed.
 *
 * The message the user sees has to stay the one the *move* failed with. Every
 * mutation clears `lastWorkError` as it starts, so a rollback that succeeds
 * would otherwise wipe the explanation and leave the drop looking like it
 * worked. A rollback that fails keeps its own message instead — at that point
 * the ref really is bound to nothing, which is the more urgent thing to say.
 */
async function restoreRef(fromItemId: string, ref: WorkRef): Promise<void> {
  const store = useReviewStore.getState();
  const failure = store.lastWorkError;
  if (await store.bindWorkItem(fromItemId, ref)) {
    useReviewStore.setState({ lastWorkError: failure });
  }
}

// ----- Hit testing for the Tauri drop path -----

/**
 * How long measured card rects are trusted, matching `useTerminalFileDrop`:
 * the section scrolls and its rows change height as statuses stream in, so
 * rects measured once at pickup drift away from what is on screen.
 */
const REMEASURE_MS = 150;

interface MeasuredTarget {
  rect: DOMRect;
  target: WorkDropTarget;
}

let measured: MeasuredTarget[] = [];
let measuredAt: number | null = null;

function measure(): void {
  measured = [
    ...document.querySelectorAll<HTMLElement>("[data-work-drop]"),
  ].map((el) => ({
    rect: el.getBoundingClientRect(),
    target:
      el.dataset.workDrop === "card"
        ? { kind: "card" as const, itemId: el.dataset.workItemId ?? "" }
        : { kind: "gap" as const, index: Number(el.dataset.workGap) },
  }));
  measuredAt = performance.now();
}

/**
 * The drop target at a window position, or null. Re-measures on the same
 * throttle the terminal drop path uses, so the caller only has to ask.
 */
export function workDropTargetAt(x: number, y: number): WorkDropTarget | null {
  if (measuredAt === null || performance.now() - measuredAt > REMEASURE_MS) {
    measure();
  }
  // Gaps overlap the cards they sit between, and a gap is the more specific
  // answer — it is the thinner strip, and it is drawn on top.
  const hits = measured.filter(
    ({ rect }) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom,
  );
  const gap = hits.find((hit) => hit.target.kind === "gap");
  return (gap ?? hits[0])?.target ?? null;
}

/** Drop the measurement cache — called when a drag ends. */
export function forgetWorkTargets(): void {
  measured = [];
  measuredAt = null;
}
