import type { WorkItem, WorkRef } from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import { jsonEqual } from "../../utils/equality";
import { getErrorMessage } from "../../utils/errors";

/** Whether two refs name the same review. */
function sameRef(a: WorkRef, b: WorkRef): boolean {
  return a.repoPath === b.repoPath && a.ref === b.ref;
}

/**
 * Move `id` to a 0-based `position`, clamped. Returns a new array, or the input
 * array unchanged when nothing moves — which callers use to detect a no-op.
 *
 * This is the mirror of `move_item` in `core/src/work/mod.rs`; the two clamps
 * have to agree or the list visibly jumps when the authoritative answer lands.
 */
export function reorderWorkItems(
  items: WorkItem[],
  id: string,
  position: number,
): WorkItem[] {
  const from = items.findIndex((item) => item.id === id);
  if (from === -1) return items;
  const to = Math.max(0, Math.min(position, items.length - 1));
  if (from === to) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** A mutation the backend refused, as the sidebar shows it. */
export interface WorkError {
  /** The backend's own message — already user-shaped, e.g. naming the item
   *  that holds a ref another one was just dropped on. */
  message: string;
  /** When it happened, so a repeat of the same message still reads as new. */
  at: number;
}

export interface WorkSlice {
  /** The user's work items, in priority order. */
  workItems: WorkItem[];
  /**
   * The last mutation that failed, or null.
   *
   * Every gesture here is attempted rather than pre-checked — the backend
   * decides whether a ref can move, and it says why — so this is where that
   * "why" reaches the user. Cleared on the next attempt, because a message
   * about a drop two drops ago is a message about nothing.
   */
  lastWorkError: WorkError | null;

  /**
   * Re-read the queue. Resolves to whether the read succeeded — a failure
   * leaves `workItems` alone, so callers that treat the list as authoritative
   * (the attachment migration) have no other way to tell an empty queue from
   * an unread one.
   */
  loadWorkItems: () => Promise<boolean>;
  /** Resolves to the item that was created, or null if the write failed. */
  addWorkItem: (title: string, refs: WorkRef[]) => Promise<WorkItem | null>;
  removeWorkItem: (id: string) => Promise<void>;
  /** Move an item to a 0-based position in the priority order. */
  moveWorkItem: (id: string, position: number) => Promise<void>;
  /**
   * Resolve to whether the ref is now where it was asked to be. A no-op — it
   * already was — counts as success; only a refused write is false.
   *
   * Moving a ref between items is two of these in a row, and the second one
   * failing is what makes the answer worth returning: see `applyWorkDrop`.
   */
  bindWorkItem: (id: string, ref: WorkRef) => Promise<boolean>;
  unbindWorkItem: (id: string, ref: WorkRef) => Promise<boolean>;
  renameWorkItem: (id: string, title: string) => Promise<void>;
}

export const createWorkSlice: SliceCreatorWithClient<WorkSlice> =
  (client: ApiClient) => (set, get) => {
    /**
     * Run a mutation. The response is the whole list (see `ApiClient`), so it
     * replaces state outright; the caller gets it back for the one question a
     * list can't answer by itself — which entry is new.
     *
     * A failure re-reads rather than rolling back: the list on screen is not
     * necessarily the last good one — the file is shared with the CLI. Null
     * means the write didn't happen and `lastWorkError` says why.
     */
    async function commit(
      what: string,
      run: () => Promise<WorkItem[]>,
    ): Promise<WorkItem[] | null> {
      set({ lastWorkError: null });
      try {
        const items = await run();
        set({ workItems: items });
        return items;
      } catch (err) {
        console.error(`Failed to ${what}:`, err);
        set({
          lastWorkError: { message: getErrorMessage(err), at: Date.now() },
        });
        await get().loadWorkItems();
        return null;
      }
    }

    /**
     * The item with `id` as the store currently sees it. `undefined` means the
     * store doesn't know about it, in which case the backend decides — the
     * no-op checks below deliberately don't swallow the call.
     */
    function itemById(id: string): WorkItem | undefined {
      return get().workItems.find((item) => item.id === id);
    }

    return {
      workItems: [],
      lastWorkError: null,

      loadWorkItems: async () => {
        try {
          // An unchanged list keeps the old array: the watcher and focus
          // refreshes usually change nothing, and a fresh reference re-renders
          // every subscriber for no reason.
          const items = await client.listWorkItems();
          const prev = get().workItems;
          set({ workItems: jsonEqual(prev, items) ? prev : items });
          return true;
        } catch (err) {
          console.error("Failed to load work items:", err);
          return false;
        }
      },

      // These five write and take the backend's answer, with nothing applied
      // ahead of it. The queue is a local JSON file, so the round trip is short
      // enough that pre-applying would buy nothing and cost a second source of
      // truth. Dragging is the exception — see `moveWorkItem`.
      addWorkItem: async (title, refs) => {
        // Found by diffing ids rather than taking the last entry: the backend
        // appends today, and a caller that has to attach a terminal to what it
        // just created shouldn't depend on that staying true.
        const before = new Set(get().workItems.map((item) => item.id));
        const items = await commit("add work item", () =>
          client.addWorkItem(title, refs),
        );
        return items?.find((item) => !before.has(item.id)) ?? null;
      },

      removeWorkItem: async (id) => {
        await commit("remove work item", () => client.removeWorkItem(id));
      },

      bindWorkItem: async (id, ref) => {
        const item = itemById(id);
        if (item?.refs.some((r) => sameRef(r, ref))) return true;
        return (
          (await commit("bind work item", () =>
            client.bindWorkItem(id, ref.repoPath, ref.ref),
          )) !== null
        );
      },

      unbindWorkItem: async (id, ref) => {
        const item = itemById(id);
        if (item && !item.refs.some((r) => sameRef(r, ref))) return true;
        return (
          (await commit("unbind work item", () =>
            client.unbindWorkItem(id, ref.repoPath, ref.ref),
          )) !== null
        );
      },

      renameWorkItem: async (id, title) => {
        if (itemById(id)?.title === title) return;
        await commit("rename work item", () =>
          client.renameWorkItem(id, title),
        );
      },

      moveWorkItem: async (id, position) => {
        // The one optimistic path: a dragged row that springs back to its old
        // slot while the write is in flight reads as broken, which is not true
        // of any of the others.
        const next = reorderWorkItems(get().workItems, id, position);
        // Dropped where it started — the backend would write nothing either.
        if (next === get().workItems) return;
        set({ workItems: next });
        await commit("move work item", () => client.moveWorkItem(id, position));
      },
    };
  };
