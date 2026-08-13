import { describe, it, expect, vi } from "vitest";
import { createWorkSlice, reorderWorkItems } from "./workSlice";
import type { WorkItem } from "../../types";

function item(id: string): WorkItem {
  return { id, title: id, refs: [], createdAt: "2026-01-01T00:00:00Z" };
}

const items = [item("a"), item("b"), item("c")];

describe("reorderWorkItems", () => {
  it("moves an item to a 0-based position", () => {
    expect(reorderWorkItems(items, "c", 0).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
    expect(reorderWorkItems(items, "a", 2).map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("clamps a position past the ends", () => {
    expect(reorderWorkItems(items, "a", 99).map((i) => i.id)).toEqual([
      "b",
      "c",
      "a",
    ]);
    expect(reorderWorkItems(items, "c", -5).map((i) => i.id)).toEqual([
      "c",
      "a",
      "b",
    ]);
  });

  // `moveWorkItem` uses this identity to skip the round trip entirely, so it
  // is a contract, not an implementation detail.
  it("returns the same array when nothing moves", () => {
    expect(reorderWorkItems(items, "b", 1)).toBe(items);
    expect(reorderWorkItems(items, "missing", 0)).toBe(items);
    // Clamping to where it already is counts as not moving.
    expect(reorderWorkItems(items, "c", 99)).toBe(items);
    expect(reorderWorkItems(items, "a", -1)).toBe(items);
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
  state = createWorkSlice(client)(set, get, {} as any);
  return { get, set };
}

describe("addWorkItem", () => {
  it("hands back the entry the list gained", async () => {
    // Deliberately returned first rather than last: the caller needs the item
    // it just made, not wherever the backend happens to put new ones.
    const { get, set } = makeSlice({
      addWorkItem: async () => [item("new"), item("a")],
    });
    set({ workItems: [item("a")] });

    expect(await get().addWorkItem("", [])).toEqual(item("new"));
    expect(get().workItems.map((i: WorkItem) => i.id)).toEqual(["new", "a"]);
  });

  it("resolves to null when the write fails", async () => {
    const { get } = makeSlice({
      addWorkItem: async () => {
        throw new Error("nope");
      },
      listWorkItems: async () => [],
    });
    expect(await get().addWorkItem("", [])).toBeNull();
  });
});

describe("lastWorkError", () => {
  it("holds the backend's message and re-reads the list", async () => {
    const listWorkItems = vi.fn().mockResolvedValue([item("a")]);
    const { get, set } = makeSlice({
      bindWorkItem: async () => {
        throw new Error("feature is already on “Fix the parser”");
      },
      listWorkItems,
    });
    set({ workItems: [item("a")] });

    await get().bindWorkItem("a", { repoPath: "/r", ref: "feature" });

    // The message is what the sidebar shows, so it is the backend's own words.
    expect(get().lastWorkError?.message).toBe(
      "feature is already on “Fix the parser”",
    );
    // The optimistic list is not necessarily the last good one, so a failure
    // asks the file rather than rolling anything back.
    expect(listWorkItems).toHaveBeenCalled();
  });

  it("clears on the next attempt", async () => {
    const { get, set } = makeSlice({
      renameWorkItem: async () => [item("a")],
    });
    set({ workItems: [item("a")], lastWorkError: { message: "old", at: 1 } });

    await get().renameWorkItem("a", "b");

    expect(get().lastWorkError).toBeNull();
  });
});
