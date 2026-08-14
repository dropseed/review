import { attachmentIndex } from "../selectors/workspaceData";
import type { Workspace, Attachment } from "../../types";
import type { ApiClient } from "../../api";
import type { SliceCreatorWithClient } from "../types";
import { jsonEqual } from "../../utils/equality";
import { getErrorMessage } from "../../utils/errors";

/**
 * Move `id` to a 0-based `position`, clamped. Returns a new array, or the input
 * array unchanged when nothing moves — which callers use to detect a no-op.
 *
 * This is the mirror of `move_workspace` in `core/src/work/mod.rs`; the two
 * clamps have to agree or the list visibly jumps when the authoritative answer
 * lands.
 */
export function reorderWorkspaces(
  items: Workspace[],
  id: string,
  position: number,
): Workspace[] {
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
  removeWorkspace: (id: string) => Promise<void>;
  /** Move an item to a 0-based position in the priority order. */
  moveWorkspace: (id: string, position: number) => Promise<void>;
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
          // The response carries one workspace, not the list, so the queue is
          // re-read rather than patched — a landing can also mint an entry this
          // list has never held.
          await get().loadWorkspaces();
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
          // An unchanged list keeps the old array: the watcher and focus
          // refreshes usually change nothing, and a fresh reference re-renders
          // every subscriber for no reason.
          // The focus goes with the read: this is the call that cleans up,
          // and a workspace being read on the stage must survive it.
          const items = await client.listWorkspaces(get().focusedWorkspaceId);
          const prev = get().workspaces;
          set({ workspaces: jsonEqual(prev, items) ? prev : items });
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

      removeWorkspace: async (id) => {
        await commit("remove work item", () => client.removeWorkspace(id));
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

      moveWorkspace: async (id, position) => {
        // The one optimistic path: a dragged row that springs back to its old
        // slot while the write is in flight reads as broken, which is not true
        // of any of the others.
        const next = reorderWorkspaces(get().workspaces, id, position);
        // Dropped where it started — the backend would write nothing either.
        if (next === get().workspaces) return;
        set({ workspaces: next });
        await commit("move work item", () =>
          client.moveWorkspace(id, position),
        );
      },
    };
  };
