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
