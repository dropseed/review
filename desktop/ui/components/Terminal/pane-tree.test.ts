import { describe, it, expect } from "vitest";
import {
  type PaneNode,
  leaf,
  makeTab,
  evenSizes,
  collectLeafIds,
  firstLeafId,
  splitLeaf,
  removeLeaf,
  pruneLeaves,
  nodeAtPath,
  setSizesAtPath,
  reorderTabs,
  movePane,
  setLeafCollapsed,
  expandedLeafIds,
  showsTerminal,
  sanitizeTabs,
} from "./pane-tree";

describe("makeTab / leaf", () => {
  it("creates a single-leaf tab focused on that terminal", () => {
    const tab = makeTab("tab1", "t1");
    expect(tab).toEqual({
      id: "tab1",
      root: { type: "leaf", terminalId: "t1" },
      focused: "t1",
    });
  });
});

describe("evenSizes", () => {
  it("splits evenly and sums to 1", () => {
    expect(evenSizes(2)).toEqual([0.5, 0.5]);
    const three = evenSizes(3);
    expect(three).toHaveLength(3);
    expect(three.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe("splitLeaf", () => {
  it("turns a lone leaf into a split of [old, new]", () => {
    const root = leaf("a");
    const next = splitLeaf(root, "a", "b", "row");
    expect(next).toEqual({
      type: "split",
      direction: "row",
      children: [leaf("a"), leaf("b")],
      sizes: [0.5, 0.5],
    });
  });

  it("appends into a same-direction parent and evens sizes", () => {
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [leaf("a"), leaf("b")],
      sizes: [0.5, 0.5],
    };
    // split "b" again in the same direction → append as a third sibling
    const next = splitLeaf(root, "b", "c", "row");
    expect(next.type).toBe("split");
    if (next.type !== "split") return;
    expect(collectLeafIds(next)).toEqual(["a", "b", "c"]);
    expect(next.children).toHaveLength(3);
    expect(next.sizes).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it("nests when the requested direction differs from the parent", () => {
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [leaf("a"), leaf("b")],
      sizes: [0.6, 0.4],
    };
    // split "b" in the opposite (column) direction → nested split in b's slot
    const next = splitLeaf(root, "b", "c", "column");
    expect(next.type).toBe("split");
    if (next.type !== "split") return;
    // parent sizes unchanged
    expect(next.sizes).toEqual([0.6, 0.4]);
    const bSlot = next.children[1];
    expect(bSlot).toEqual({
      type: "split",
      direction: "column",
      children: [leaf("b"), leaf("c")],
      sizes: [0.5, 0.5],
    });
  });

  it("leaves the tree unchanged when the target is absent", () => {
    const root = leaf("a");
    expect(splitLeaf(root, "zzz", "b", "row")).toBe(root);
  });
});

describe("removeLeaf", () => {
  it("removes a leaf and collapses a now-single-child split into the child", () => {
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [leaf("a"), leaf("b")],
      sizes: [0.5, 0.5],
    };
    const next = removeLeaf(root, "b");
    expect(next).toEqual(leaf("a"));
  });

  it("renormalizes sizes when removing from a 3-way split", () => {
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [leaf("a"), leaf("b"), leaf("c")],
      sizes: [0.2, 0.3, 0.5],
    };
    const next = removeLeaf(root, "b");
    if (next?.type !== "split") throw new Error("expected split");
    expect(collectLeafIds(next)).toEqual(["a", "c"]);
    expect(next.sizes[0]).toBeCloseTo(0.2 / 0.7);
    expect(next.sizes[1]).toBeCloseTo(0.5 / 0.7);
    expect(next.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it("returns null when the whole tree is the removed leaf (last pane)", () => {
    expect(removeLeaf(leaf("a"), "a")).toBeNull();
  });
});

describe("pruneLeaves", () => {
  it("keeps only surviving leaves and collapses", () => {
    const root: PaneNode = {
      type: "split",
      direction: "column",
      children: [leaf("a"), leaf("b"), leaf("c")],
      sizes: [1 / 3, 1 / 3, 1 / 3],
    };
    const next = pruneLeaves(root, new Set(["b"]));
    expect(next).toEqual(leaf("b"));
  });

  it("returns null when nothing survives", () => {
    expect(pruneLeaves(leaf("a"), new Set(["x"]))).toBeNull();
  });
});

describe("firstLeafId", () => {
  it("descends to the first leaf for focus re-pick", () => {
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [
        {
          type: "split",
          direction: "column",
          children: [leaf("x"), leaf("y")],
          sizes: [0.5, 0.5],
        },
        leaf("z"),
      ],
      sizes: [0.5, 0.5],
    };
    expect(firstLeafId(root)).toBe("x");
  });
});

describe("reorderTabs", () => {
  const tabs = [makeTab("t1", "a"), makeTab("t2", "b"), makeTab("t3", "c")];

  it("moves a tab forward, landing it at the target index", () => {
    expect(reorderTabs(tabs, 0, 2).map((t) => t.id)).toEqual([
      "t2",
      "t3",
      "t1",
    ]);
  });

  it("moves a tab backward, landing it at the target index", () => {
    expect(reorderTabs(tabs, 2, 0).map((t) => t.id)).toEqual([
      "t3",
      "t1",
      "t2",
    ]);
  });

  it("leaves the tabs themselves untouched (same objects, new array)", () => {
    const next = reorderTabs(tabs, 0, 1);
    expect(next).not.toBe(tabs);
    expect(next[0]).toBe(tabs[1]);
    expect(tabs.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
  });

  it("returns the original array for a no-op or out-of-range move", () => {
    expect(reorderTabs(tabs, 1, 1)).toBe(tabs);
    expect(reorderTabs(tabs, -1, 0)).toBe(tabs);
    expect(reorderTabs(tabs, 0, 3)).toBe(tabs);
  });
});

describe("nodeAtPath / setSizesAtPath", () => {
  const root: PaneNode = {
    type: "split",
    direction: "row",
    children: [
      leaf("a"),
      {
        type: "split",
        direction: "column",
        children: [leaf("b"), leaf("c")],
        sizes: [0.5, 0.5],
      },
    ],
    sizes: [0.5, 0.5],
  };

  it("resolves a nested split by path", () => {
    const node = nodeAtPath(root, [1]);
    expect(node?.type).toBe("split");
    if (node?.type === "split") expect(node.direction).toBe("column");
  });

  it("sets sizes at the root split", () => {
    const next = setSizesAtPath(root, [], [0.7, 0.3]);
    expect(next.type).toBe("split");
    if (next.type === "split") expect(next.sizes).toEqual([0.7, 0.3]);
  });

  it("sets sizes at a nested split without touching the parent", () => {
    const next = setSizesAtPath(root, [1], [0.2, 0.8]);
    if (next.type !== "split") throw new Error("expected split");
    expect(next.sizes).toEqual([0.5, 0.5]); // parent untouched
    const nested = next.children[1];
    if (nested.type !== "split") throw new Error("expected nested split");
    expect(nested.sizes).toEqual([0.2, 0.8]);
  });
});

describe("movePane", () => {
  const row = (...ids: string[]): PaneNode => ({
    type: "split",
    direction: "row",
    children: ids.map(leaf),
    sizes: evenSizes(ids.length),
  });

  it("swaps two panes when one is dropped past the other", () => {
    expect(movePane(row("a", "b"), "a", "b", "right")).toEqual(row("b", "a"));
  });

  it("returns the original tree for a drop that changes nothing", () => {
    // Sizes the user dragged to survive a drop that lands where the pane
    // already is — same object back, so no state write either.
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [leaf("a"), leaf("b")],
      sizes: [0.7, 0.3],
    };
    expect(movePane(root, "a", "b", "left")).toBe(root);
    expect(movePane(root, "b", "a", "right")).toBe(root);
  });

  it("re-nests a pane into a new direction against its sibling", () => {
    expect(movePane(row("a", "b"), "a", "b", "bottom")).toEqual({
      type: "split",
      direction: "column",
      children: [leaf("b"), leaf("a")],
      sizes: [0.5, 0.5],
    });
  });

  it("collapses the split the pane left behind", () => {
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [
        leaf("a"),
        {
          type: "split",
          direction: "column",
          children: [leaf("b"), leaf("c")],
          sizes: [0.5, 0.5],
        },
      ],
      sizes: [0.5, 0.5],
    };
    // b leaves the column, which then holds only c and collapses into it.
    expect(movePane(root, "b", "a", "left")).toEqual(row("b", "a", "c"));
  });

  it("moves a pane out of a nested split into the root row", () => {
    const root: PaneNode = {
      type: "split",
      direction: "row",
      children: [
        leaf("a"),
        {
          type: "split",
          direction: "column",
          children: [leaf("b"), leaf("c"), leaf("d")],
          sizes: evenSizes(3),
        },
      ],
      sizes: [0.5, 0.5],
    };
    const next = movePane(root, "c", "a", "right");
    if (next.type !== "split") throw new Error("expected split");
    expect(collectLeafIds(next)).toEqual(["a", "c", "b", "d"]);
    expect(next.children).toHaveLength(3);
    expect(next.sizes).toEqual(evenSizes(3));
  });

  it("declines a move naming a pane the tree doesn't hold", () => {
    const root = row("a", "b");
    expect(movePane(root, "a", "zz", "left")).toBe(root);
    expect(movePane(root, "zz", "a", "left")).toBe(root);
    expect(movePane(root, "a", "a", "left")).toBe(root);
  });
});

describe("collapsing panes", () => {
  const row = (...ids: string[]): PaneNode => ({
    type: "split",
    direction: "row",
    children: ids.map(leaf),
    sizes: evenSizes(ids.length),
  });

  it("folds and unfolds one leaf, leaving the sizes alone", () => {
    const root = row("a", "b");
    const folded = setLeafCollapsed(root, "b", true);
    if (folded.type !== "split") throw new Error("expected split");
    expect(folded.children[1]).toEqual({
      type: "leaf",
      terminalId: "b",
      collapsed: true,
    });
    expect(folded.sizes).toEqual([0.5, 0.5]);
    expect(setLeafCollapsed(folded, "b", false)).toEqual(root);
  });

  it("returns the same tree when nothing changes", () => {
    const root = row("a", "b");
    expect(setLeafCollapsed(root, "b", false)).toBe(root);
    expect(setLeafCollapsed(root, "zz", true)).toBe(root);
  });

  it("reports which leaves are still showing a terminal", () => {
    const folded = setLeafCollapsed(row("a", "b", "c"), "b", true);
    expect(expandedLeafIds(folded)).toEqual(["a", "c"]);
    expect(collectLeafIds(folded)).toEqual(["a", "b", "c"]);
    expect(showsTerminal(folded)).toBe(true);
  });

  it("says a split holding only folded leaves shows nothing", () => {
    let node: PaneNode = row("a", "b");
    node = setLeafCollapsed(node, "a", true);
    node = setLeafCollapsed(node, "b", true);
    expect(showsTerminal(node)).toBe(false);
    expect(expandedLeafIds(node)).toEqual([]);
  });

  it("unfolds a pane when removal retires the last one showing", () => {
    // Folding is only allowed while something else shows, but closing that
    // something else can leave a tab of nothing but title bars.
    let node: PaneNode = row("a", "b", "c");
    node = setLeafCollapsed(node, "b", true);
    node = setLeafCollapsed(node, "c", true);

    const closed = removeLeaf(node, "a");
    expect(closed).not.toBeNull();
    expect(showsTerminal(closed!)).toBe(true);
    expect(expandedLeafIds(closed!)).toEqual(["b"]);

    // The same hole reached from a backend reconcile rather than a close.
    const pruned = pruneLeaves(node, new Set(["b", "c"]));
    expect(expandedLeafIds(pruned!)).toEqual(["b"]);
  });

  it("unfolds a folded pane left alone at the root", () => {
    // Closing the last sibling of a folded pane would otherwise leave a tab
    // that is nothing but a title bar.
    const folded = setLeafCollapsed(row("a", "b"), "b", true);
    expect(removeLeaf(folded, "a")).toEqual(leaf("b"));
    expect(pruneLeaves(folded, new Set(["b"]))).toEqual(leaf("b"));
  });

  it("keeps a folded pane folded when its split survives", () => {
    const folded = setLeafCollapsed(row("a", "b", "c"), "c", true);
    const next = removeLeaf(folded, "a");
    if (next?.type !== "split") throw new Error("expected split");
    expect(next.children[1]).toMatchObject({
      terminalId: "c",
      collapsed: true,
    });
  });
});

describe("sanitizeTabs", () => {
  it("restores a split tab with the sizes it was dragged to", () => {
    expect(
      sanitizeTabs([
        {
          id: "tab1",
          focused: "b",
          root: {
            type: "split",
            direction: "column",
            children: [leaf("a"), leaf("b")],
            sizes: [0.7, 0.3],
          },
        },
      ]),
    ).toEqual([
      {
        id: "tab1",
        focused: "b",
        root: {
          type: "split",
          direction: "column",
          children: [leaf("a"), leaf("b")],
          sizes: [0.7, 0.3],
        },
      },
    ]);
  });

  it("takes nothing from a value that isn't a stored layout", () => {
    expect(sanitizeTabs(null)).toEqual([]);
    expect(sanitizeTabs({ tabs: [] })).toEqual([]);
    expect(sanitizeTabs(["tab1", 3, null])).toEqual([]);
    // A tab needs an id and a tree; neither is invented for it.
    expect(sanitizeTabs([{ root: leaf("a") }])).toEqual([]);
    expect(sanitizeTabs([{ id: "tab1", root: { type: "pane" } }])).toEqual([]);
  });

  it("gives a split with unusable sizes even ones", () => {
    const [tab] = sanitizeTabs([
      {
        id: "tab1",
        focused: "a",
        // One fraction short, and one of them nonsense: the row is redrawn
        // even rather than half-honored.
        root: { type: "split", children: [leaf("a"), leaf("b")], sizes: ["x"] },
      },
    ]);
    if (tab.root.type !== "split") throw new Error("expected split");
    expect(tab.root.sizes).toEqual(evenSizes(2));
    expect(tab.root.direction).toBe("row");
  });

  it("drops panes it can't draw, collapsing what they leave behind", () => {
    const [tab] = sanitizeTabs([
      {
        id: "tab1",
        focused: "b",
        root: {
          type: "split",
          direction: "row",
          children: [leaf("a"), { type: "leaf" }, 7],
          sizes: [0.5, 0.25, 0.25],
        },
      },
    ]);
    // A split down to one child is that child, and focus lands on what's left.
    expect(tab.root).toEqual(leaf("a"));
    expect(tab.focused).toBe("a");
  });

  it("lets no terminal be claimed twice, in one tab or across two", () => {
    const tabs = sanitizeTabs([
      {
        id: "tab1",
        focused: "a",
        root: {
          type: "split",
          direction: "row",
          children: [leaf("a"), leaf("a")],
          sizes: [0.5, 0.5],
        },
      },
      { id: "tab2", focused: "a", root: leaf("a") },
      // Same tab id twice: the second is a tab the strip could not address.
      { id: "tab1", focused: "b", root: leaf("b") },
    ]);
    expect(tabs).toEqual([{ id: "tab1", root: leaf("a"), focused: "a" }]);
  });

  it("unfolds a tab stored as nothing but title bars", () => {
    const [tab] = sanitizeTabs([
      {
        id: "tab1",
        focused: "a",
        root: {
          type: "split",
          direction: "row",
          children: [
            { type: "leaf", terminalId: "a", collapsed: true },
            { type: "leaf", terminalId: "b", collapsed: true },
          ],
          sizes: [0.5, 0.5],
        },
      },
    ]);
    expect(showsTerminal(tab.root)).toBe(true);
    expect(expandedLeafIds(tab.root)).toEqual(["a"]);
    expect(tab.focused).toBe("a");
  });
});
