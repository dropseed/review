import { attachmentIndex } from "../selectors/workspaceData";
import type { Workspace, WorkspaceAncestor, Attachment } from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import { jsonEqual } from "../../utils/equality";
import { getErrorMessage } from "../../utils/errors";

/**
 * How many rows the workspace at `index` occupies — itself and everything
 * nested under it, which is what a drag of it carries.
 *
 * Read off `depth` rather than by walking `parentId`, because the list is in
 * tree order and depth is derived from the same links on every set (see
 * `retree`): a subtree is the run of deeper rows that follows its root.
 */
export function subtreeLength(items: Workspace[], index: number): number {
  const root = items[index];
  if (!root) return 0;
  let size = 1;
  while (items[index + size] && items[index + size].depth > root.depth) size++;
  return size;
}

/**
 * Recompute `depth` and `ancestors` from `parentId`, the mirror of `view_of` in
 * `core/src/work/mod.rs`.
 *
 * The backend derives both on every read, so this only exists for the
 * optimistic move below: the dragged card has to be drawn at its new indent in
 * the same frame it lands, not one round trip later. Entries whose facts didn't
 * change keep their identity, so a move re-renders the rows that moved.
 */
function retree(items: Workspace[]): Workspace[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const chains = new Map<string, WorkspaceAncestor[]>();
  const visiting = new Set<string>();

  function chainFor(item: Workspace): WorkspaceAncestor[] {
    const cached = chains.get(item.id);
    if (cached) return cached;
    const parent = item.parentId ? byId.get(item.parentId) : undefined;
    // `visiting` guards a ring the backend would never send and this file
    // cannot build — cheap insurance against recursing forever on one.
    const chain =
      parent && !visiting.has(item.id)
        ? (visiting.add(item.id),
          [
            ...chainFor(parent),
            { id: parent.id, displayTitle: parent.displayTitle },
          ])
        : [];
    visiting.delete(item.id);
    chains.set(item.id, chain);
    return chain;
  }

  return items.map((item) => {
    const ancestors = chainFor(item);
    return item.depth === ancestors.length &&
      jsonEqual(item.ancestors, ancestors)
      ? item
      : { ...item, depth: ancestors.length, ancestors };
  });
}

/**
 * Move `id` to 0-based row `position`, taking everything nested under it.
 * Returns a new array, or the input array unchanged when nothing moves — which
 * callers use to detect a no-op.
 *
 * This is the mirror of `move_workspace` in `core/src/work/mod.rs`, and it has
 * to agree with it on two things or the list visibly jumps when the
 * authoritative answer lands: the clamp, and **the depth the row lands at** —
 * a sibling of the row it displaces, and at the end of the list, where there is
 * no such row, at the top level.
 */
export function reorderWorkspaces(
  items: Workspace[],
  id: string,
  position: number,
): Workspace[] {
  const from = items.findIndex((item) => item.id === id);
  if (from === -1) return items;
  const size = subtreeLength(items, from);
  const to = Math.max(0, Math.min(position, items.length - size));
  if (from === to) return items;
  const subtree = items.slice(from, from + size);
  const rest = [...items.slice(0, from), ...items.slice(from + size)];
  // Inserting immediately above a row and taking its parent keeps the array in
  // tree order: that row is a direct child of the parent being adopted, so the
  // subtree slots in beside it rather than between a parent and its children.
  const next = [
    ...rest.slice(0, to),
    { ...subtree[0], parentId: rest[to]?.parentId ?? null },
    ...subtree.slice(1),
    ...rest.slice(to),
  ];
  return retree(next);
}

/** A mutation the backend refused, as the sidebar shows it. */
export interface WorkspaceError {
  /** The backend's own message — already user-shaped, e.g. naming the item
   *  that holds a ref another one was just dropped on. */
  message: string;
  /** When it happened, so a repeat of the same message still reads as new. */
  at: number;
}

export interface WorkspaceSlice {
  /** The user's workspaces, in priority order. */
  workspaces: Workspace[];
  /**
   * The workspace the stage is showing, when the user has picked one.
   *
   * Null is not "nothing focused": with no explicit pick the focus is *derived*
   * from whichever workspace is showing the repo on screen (see
   * `useFocusedWorkspace`), so opening a branch from ⌘K puts you in its
   * workspace without a second gesture. The explicit id exists for the case
   * derivation cannot cover — a workspace showing no repo, or one whose repo
   * nothing on screen names.
   */
  focusedWorkspaceId: string | null;
  /**
   * The last mutation that failed, or null.
   *
   * Every gesture here is attempted rather than pre-checked — the backend does
   * the write, and it says why when it can't — so this is where that "why"
   * reaches the user. Cleared on the next attempt, because a message about a
   * drop two drops ago is a message about nothing.
   */
  lastWorkspaceError: WorkspaceError | null;

  /** Re-read the queue. A failed read leaves `workspaces` alone. */
  loadWorkspaces: () => Promise<void>;
  /**
   * Create a workspace. A null title leaves it deriving one from whatever
   * lands in it. Resolves to the item created, or null if the write failed.
   */
  addWorkspace: (
    title: string | null,
    attachments: Attachment[],
  ) => Promise<Workspace | null>;
  /**
   * Remove a workspace. `recursive` takes everything nested under it too;
   * without it the sub-workspaces come up to its level and stay in the queue.
   */
  removeWorkspace: (id: string, recursive?: boolean) => Promise<void>;
  /**
   * Put a workspace under another, or — with a null `parentId` — back at the
   * top level. The whole subtree travels with it.
   */
  nestWorkspace: (id: string, parentId: string | null) => Promise<void>;
  /**
   * Move an item to a 0-based row in the queue, taking everything nested under
   * it. `keepParent` reorders it among its siblings instead of letting the
   * destination decide the depth — see `ApiClient.moveWorkspace`.
   */
  moveWorkspace: (
    id: string,
    position: number,
    keepParent?: boolean,
  ) => Promise<void>;
  /**
   * Show a repo in a workspace — opening a repo tab. Attaching a path the
   * workspace already shows moves its ref hint rather than opening a second
   * tab. Resolves to whether the write landed.
   */
  attachWorkspace: (
    id: string,
    path: string,
    refName?: string | null,
  ) => Promise<boolean>;
  /** Stop showing a repo. A path that isn't attached is a no-op. */
  detachWorkspace: (id: string, path: string) => Promise<boolean>;
  /** Retitle. Null (or empty) clears it and the derived title resumes. */
  renameWorkspace: (id: string, title: string | null) => Promise<void>;
  /** Point the stage at a workspace. Both halves follow. */
  setFocusedWorkspace: (id: string | null) => void;
  /**
   * Land a repo+branch in a workspace and commit it — ⌘K's Enter.
   *
   * Resolves to the workspace it landed in, or null when the write failed
   * (`lastWorkspaceError` says why). A landing that minted a workspace re-reads
   * the queue, because that entry is one this list has never held.
   */
  routeWorkspace: (
    repoPath: string,
    ref: string,
    workspaceId?: string,
  ) => Promise<Workspace | null>;
}

export const createWorkspaceSlice: SliceCreatorWithClient<WorkspaceSlice> =
  (client: ApiClient) => (set, get) => {
    /**
     * Run a mutation. The response is the whole list (see `ApiClient`), so it
     * replaces state outright; the caller gets it back for the one question a
     * list can't answer by itself — which entry is new.
     *
     * A failure re-reads rather than rolling back: the list on screen is not
     * necessarily the last good one — the file is shared with the CLI. Null
     * means the write didn't happen and `lastWorkspaceError` says why.
     */
    async function commit(
      what: string,
      run: () => Promise<Workspace[]>,
    ): Promise<Workspace[] | null> {
      set({ lastWorkspaceError: null });
      try {
        const items = await run();
        set({ workspaces: items });
        return items;
      } catch (err) {
        console.error(`Failed to ${what}:`, err);
        set({
          lastWorkspaceError: { message: getErrorMessage(err), at: Date.now() },
        });
        await get().loadWorkspaces();
        return null;
      }
    }

    /**
     * The item with `id` as the store currently sees it. `undefined` means the
     * store doesn't know about it, in which case the backend decides — the
     * no-op checks below deliberately don't swallow the call.
     */
    function itemById(id: string): Workspace | undefined {
      return get().workspaces.find((item) => item.id === id);
    }

    /**
     * Take a queue the backend just handed back, keeping the **old array** when
     * it is the same list.
     *
     * A fresh reference re-renders every subscriber and busts the caches keyed
     * on this array's identity (`workspaceCommands`, `useFocusedWorkspace`), so
     * the reads that usually change nothing must not produce one. That is the
     * watcher and the focus refresh — and now routing, which lands on a
     * workspace that already holds the repo on every page refresh.
     */
    function takeWorkspaces(items: Workspace[]): void {
      const prev = get().workspaces;
      set({ workspaces: jsonEqual(prev, items) ? prev : items });
    }

    return {
      workspaces: [],
      focusedWorkspaceId: null,
      lastWorkspaceError: null,

      setFocusedWorkspace: (id) => set({ focusedWorkspaceId: id }),

      routeWorkspace: async (repoPath, ref, workspaceId) => {
        set({ lastWorkspaceError: null });
        try {
          const landing = await client.routeWorkspace(
            repoPath,
            ref,
            workspaceId,
          );
          // The response carries the whole queue, so there is no second read:
          // this used to await `loadWorkspaces`, which is one more round trip
          // on the path every CLI landing and every page refresh now takes.
          takeWorkspaces(landing.workspaces);
          return landing.workspace;
        } catch (err) {
          console.error("Failed to open branch:", err);
          set({
            lastWorkspaceError: {
              message: getErrorMessage(err),
              at: Date.now(),
            },
          });
          return null;
        }
      },

      loadWorkspaces: async () => {
        try {
          // The focus goes with the read: this is the call that cleans up,
          // and a workspace being read on the stage must survive it.
          takeWorkspaces(await client.listWorkspaces(get().focusedWorkspaceId));
        } catch (err) {
          console.error("Failed to load workspaces:", err);
        }
      },

      // These five write and take the backend's answer, with nothing applied
      // ahead of it. The queue is a local JSON file, so the round trip is short
      // enough that pre-applying would buy nothing and cost a second source of
      // truth. Dragging is the exception — see `moveWorkspace`.
      addWorkspace: async (title, attachments) => {
        // Found by diffing ids rather than taking the last entry: the backend
        // appends today, and a caller that has to focus what it just created
        // shouldn't depend on that staying true.
        const before = new Set(get().workspaces.map((item) => item.id));
        const items = await commit("add work item", () =>
          client.addWorkspace(title, attachments),
        );
        return items?.find((item) => !before.has(item.id)) ?? null;
      },

      removeWorkspace: async (id, recursive = false) => {
        await commit("remove work item", () =>
          client.removeWorkspace(id, recursive),
        );
      },

      nestWorkspace: async (id, parentId) => {
        // Nesting is a drop, not a drag in progress, so it takes the backend's
        // answer like the other writes — and the backend is the one that knows
        // whether the nesting is possible at all.
        if (itemById(id)?.parentId === parentId) return;
        await commit("nest workspace", () =>
          client.nestWorkspace(id, parentId),
        );
      },

      attachWorkspace: async (id, path, refName) => {
        const item = itemById(id);
        // Already showing this repo at this ref: the tab exists and points
        // where it is being asked to point, so there is nothing to write.
        const at = item ? attachmentIndex(item, path) : -1;
        if (at !== -1 && item!.attachments[at].refName === (refName ?? null)) {
          return true;
        }
        return (
          (await commit("open a repo", () =>
            client.attachWorkspace(id, path, refName),
          )) !== null
        );
      },

      detachWorkspace: async (id, path) => {
        const item = itemById(id);
        if (item && attachmentIndex(item, path) === -1) return true;
        return (
          (await commit("close a repo", () =>
            client.detachWorkspace(id, path),
          )) !== null
        );
      },

      renameWorkspace: async (id, title) => {
        if (itemById(id)?.title === title) return;
        await commit("rename workspace", () =>
          client.renameWorkspace(id, title),
        );
      },

      moveWorkspace: async (id, position, keepParent = false) => {
        // The one optimistic path: a dragged row that springs back to its old
        // slot while the write is in flight reads as broken, which is not true
        // of any of the others — including a menu move, which is why
        // `keepParent` takes the plain path. Its settling rule is the
        // backend's `reflow`, and a second implementation of that here would
        // buy a frame and cost a source of truth.
        if (!keepParent) {
          const next = reorderWorkspaces(get().workspaces, id, position);
          // Dropped where it started — the backend would write nothing either.
          if (next === get().workspaces) return;
          set({ workspaces: next });
        }
        await commit("move work item", () =>
          client.moveWorkspace(id, position, keepParent),
        );
      },
    };
  };
