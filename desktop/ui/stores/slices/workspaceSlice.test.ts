import { describe, it, expect, vi } from "vitest";
import { createWorkspaceSlice, reorderWorkspaces } from "./workspaceSlice";
import type { Attachment, Workspace } from "../../types";
import { attachment, workspace } from "../../test/fixtures";

function item(id: string, attachments: Attachment[] = []): Workspace {
  return workspace(id, { title: id, attachments });
}

const items = [item("a"), item("b"), item("c")];

describe("reorderWorkspaces", () => {
  it("moves an item to a 0-based position", () => {
    expect(reorderWorkspaces(items, "c", 0).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(reorderWorkspaces(items, "a", 2).map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("clamps a position past the ends", () => {
    expect(reorderWorkspaces(items, "a", 99).map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(reorderWorkspaces(items, "c", -5).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  // `moveWorkspace` uses this identity to skip the round trip entirely, so it
  // is a contract, not an implementation detail.
  it("returns the same array when nothing moves", () => {
    expect(reorderWorkspaces(items, "b", 1)).toBe(items);
    expect(reorderWorkspaces(items, "missing", 0)).toBe(items);
    // Clamping to where it already is counts as not moving.
    expect(reorderWorkspaces(items, "c", 99)).toBe(items);
    expect(reorderWorkspaces(items, "a", -1)).toBe(items);
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeSlice(client: any = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let state: any = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const set = (partial: any) => {
    state = { ...state, ...partial };
  };
  const get = () => state;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  state = createWorkspaceSlice(client)(set, get, {} as any);
  return { get, set };
}

describe("addWorkspace", () => {
  it("hands back the entry the list gained", async () => {
    // Deliberately returned first rather than last: the caller needs the item
    // it just made, not wherever the backend happens to put new ones.
    const { get, set } = makeSlice({
      addWorkspace: async () => [item("new"), item("a")],
    });
    set({ workspaces: [item("a")] });

    expect(await get().addWorkspace(null, [])).toEqual(item("new"));
    expect(get().workspaces.map((i: Workspace) => i.id)).toEqual(["new", "a"]);
  });

  it("resolves to null when the write fails", async () => {
    const { get } = makeSlice({
      addWorkspace: async () => {
        throw new Error("nope");
      },
      listWorkspaces: async () => [],
    });
    expect(await get().addWorkspace(null, [])).toBeNull();
  });
});

describe("lastWorkspaceError", () => {
  it("holds the backend's message and re-reads the list", async () => {
    const listWorkspaces = vi.fn().mockResolvedValue([item("a")]);
    const { get, set } = makeSlice({
      attachWorkspace: async () => {
        throw new Error("no such directory");
      },
      listWorkspaces,
    });
    set({ workspaces: [item("a")] });

    await get().attachWorkspace("a", "/r", "feature");

    // The message is what the sidebar shows, so it is the backend's own words.
    expect(get().lastWorkspaceError?.message).toBe("no such directory");
    // The optimistic list is not necessarily the last good one, so a failure
    // asks the file rather than rolling anything back.
    expect(listWorkspaces).toHaveBeenCalled();
  });

  it("clears on the next attempt", async () => {
    const { get, set } = makeSlice({
      renameWorkspace: async () => [item("a")],
    });
    set({
      workspaces: [item("a")],
      lastWorkspaceError: { message: "old", at: 1 },
    });

    await get().renameWorkspace("a", "b");

    expect(get().lastWorkspaceError).toBeNull();
  });
});

describe("attach and detach", () => {
  const shown = () => item("a", [attachment("/r", "feature")]);

  it("skips the write when the repo is already shown at that ref", async () => {
    const attachWorkspace = vi.fn().mockResolvedValue([]);
    const { get, set } = makeSlice({ attachWorkspace });
    set({ workspaces: [shown()] });

    expect(await get().attachWorkspace("a", "/r", "feature")).toBe(true);
    expect(attachWorkspace).not.toHaveBeenCalled();
  });

  /** Same repo, new ref: the tab stays, its hint moves — so this is a write. */
  it("writes when the ref hint moves", async () => {
    const attachWorkspace = vi.fn().mockResolvedValue([]);
    const { get, set } = makeSlice({ attachWorkspace });
    set({ workspaces: [shown()] });

    await get().attachWorkspace("a", "/r", "other");
    expect(attachWorkspace).toHaveBeenCalledWith("a", "/r", "other");
  });

  it("skips detaching a repo that isn't shown", async () => {
    const detachWorkspace = vi.fn().mockResolvedValue([]);
    const { get, set } = makeSlice({ detachWorkspace });
    set({ workspaces: [item("a")] });

    expect(await get().detachWorkspace("a", "/r")).toBe(true);
    expect(detachWorkspace).not.toHaveBeenCalled();
  });
});
