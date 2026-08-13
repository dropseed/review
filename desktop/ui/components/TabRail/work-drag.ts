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

/** The drop target, re-rendering the caller when it changes. */
export function useWorkDropTarget(): WorkDropTarget | null {
  return useSyncExternalStore(
    subscribe,
    () => dropTarget,
    () => null,
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

/**
 * What a dragover's MIME types say is being carried, or null for a drag the
 * section doesn't take. `types` is all a dragover can read — the payloads
 * themselves are in the module latches — but the *kind* decides which targets
 * exist at all: a card being reordered can only land in a gap, everything else
 * can land on a card too (see `resolveWorkDropTarget`).
 */
export function dragCarrying(
  types: readonly string[],
): WorkDropPayload["kind"] | null {
  if (types.includes(WORK_ITEM_MIME)) return "item";
  if (types.includes(WORK_REF_MIME)) return "ref";
  if (carriesTerminal(types)) return "terminal";
  return null;
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
 * The HTML5 drop handlers, mounted once on the section's list container.
 *
 * On the section rather than on each card and gap: the target is *computed*
 * from the cursor position (`resolveWorkDropTarget`), not read off whichever
 * element happened to catch the event. Per-element handlers made the 4px gap
 * strips the only way to hit a gap — a reorder over a card's body had no
 * target at all — and meant the two drop paths (this one and the Tauri
 * window-level one) could disagree about what was under the cursor. Now both
 * ask the same geometry.
 */
export function workSectionDropHandlers(): {
  onDragOver: (event: React.DragEvent) => void;
  onDragLeave: (event: React.DragEvent) => void;
  onDrop: (event: React.DragEvent) => void;
} {
  return {
    onDragOver: (event) => {
      const carrying = dragCarrying(event.dataTransfer.types);
      if (!carrying) return;
      const target = workDropTargetAt(event.clientX, event.clientY, carrying);
      setWorkDropTarget(target);
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
    },
    onDragLeave: (event) => {
      if (pointerLeft(event)) setWorkDropTarget(null);
    },
    onDrop: (event) => {
      // The drop lands where the highlight said it would — the published
      // target, not a re-resolve that could disagree with what was shown.
      const target = dropTarget;
      setWorkDropTarget(null);
      forgetWorkTargets();
      const payload = takeWorkDragPayload();
      if (!target || !payload) return;
      event.preventDefault();
      event.stopPropagation();
      void applyWorkDrop(target, payload);
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

// ----- Drop-target geometry, shared by both drop paths -----

/** The edges the geometry needs — a `DOMRect` qualifies. */
interface Box {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** The measured section, in list order. */
export interface WorkTargetRects {
  /** The list container — outside it there is no target at all. */
  section: Box | null;
  cards: { rect: Box; itemId: string }[];
}

/**
 * The target a drag carrying `carrying` would land on at (x, y).
 *
 * Computed from the geometry rather than read off whichever element contains
 * the point. The gap elements are 4px strips — as literal hit targets they
 * made the insertion line unreachable except by threading the cursor between
 * two rows, and left a reorder with *no* target while over a card's body,
 * which is where the cursor spends the whole drag. Here every position in the
 * section resolves to something:
 *
 * - a reorder ("item") always lands in a gap — the one whose neighboring
 *   card midpoints bracket the cursor, the way the insertion feels;
 * - a ref or terminal lands on the card it is over — the drag's own ghost
 *   covers a card-height around the cursor, so anything but a thin band at
 *   the card's vertical edges has to read as "onto this card" — and in the
 *   nearest gap when in those bands or between cards, which keeps creating a
 *   new item at a position reachable without making the bind hard to hit.
 */
export function resolveWorkDropTarget(
  x: number,
  y: number,
  carrying: WorkDropPayload["kind"],
  rects: WorkTargetRects,
): WorkDropTarget | null {
  const { section, cards } = rects;
  if (!section) return null;
  // An empty section is a near-zero-height container; give it a catch area so
  // the first item can be dropped into it at all.
  const pad = cards.length === 0 ? 16 : 6;
  if (
    x < section.left ||
    x > section.right ||
    y < section.top - pad ||
    y > section.bottom + pad
  ) {
    return null;
  }
  if (carrying !== "item") {
    const hit = cards.find(({ rect }) => y >= rect.top && y <= rect.bottom);
    if (hit) {
      const height = Math.max(hit.rect.bottom - hit.rect.top, 1);
      const t = (y - hit.rect.top) / height;
      if (t >= 0.15 && t <= 0.85) {
        return { kind: "card", itemId: hit.itemId };
      }
    }
  }
  // The gap index is how many card midpoints sit above the cursor — above the
  // first card's midpoint is gap 0, below the last card's is the end.
  const index = cards.filter(
    ({ rect }) => (rect.top + rect.bottom) / 2 <= y,
  ).length;
  return { kind: "gap", index };
}

/**
 * How long measured rects are trusted, matching `useTerminalFileDrop`: the
 * section scrolls and its rows change height as statuses stream in, so rects
 * measured once at pickup drift away from what is on screen.
 */
const REMEASURE_MS = 150;

let measured: WorkTargetRects = { section: null, cards: [] };
let measuredAt: number | null = null;

function measure(): void {
  measured = {
    section:
      document
        .querySelector<HTMLElement>("[data-work-section]")
        ?.getBoundingClientRect() ?? null,
    cards: [...document.querySelectorAll<HTMLElement>("[data-work-card]")].map(
      (el) => ({
        rect: el.getBoundingClientRect(),
        itemId: el.dataset.workCard ?? "",
      }),
    ),
  };
  measuredAt = performance.now();
}

/**
 * [`resolveWorkDropTarget`] against the live DOM. Re-measures on the same
 * throttle the terminal drop path uses, so the caller only has to ask.
 */
export function workDropTargetAt(
  x: number,
  y: number,
  carrying: WorkDropPayload["kind"],
): WorkDropTarget | null {
  if (measuredAt === null || performance.now() - measuredAt > REMEASURE_MS) {
    measure();
  }
  return resolveWorkDropTarget(x, y, carrying, measured);
}

/** Drop the measurement cache — called when a drag ends. */
export function forgetWorkTargets(): void {
  measured = { section: null, cards: [] };
  measuredAt = null;
}
