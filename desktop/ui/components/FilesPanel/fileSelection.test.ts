import { describe, it, expect } from "vitest";
import {
  EMPTY_SELECTION,
  applySelectionClick,
  flattenVisibleFilePaths,
  isMultiSelection,
  pruneSelection,
  resolvePaneFiles,
  selectionHunkIds,
  selectionModifier,
  type FileSelection,
  type SelectableTreeEntry,
} from "./fileSelection";

const ORDER = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

function selection(paths: string[], anchor: string | null): FileSelection {
  return { paths, anchor };
}

describe("selectionModifier", () => {
  it("reads shift as range and cmd/ctrl as toggle", () => {
    const base = { shiftKey: false, metaKey: false, ctrlKey: false };
    expect(selectionModifier(base)).toBe("replace");
    expect(selectionModifier({ ...base, shiftKey: true })).toBe("range");
    expect(selectionModifier({ ...base, metaKey: true })).toBe("toggle");
    expect(selectionModifier({ ...base, ctrlKey: true })).toBe("toggle");
  });

  it("prefers range when shift and cmd are held together", () => {
    expect(
      selectionModifier({ shiftKey: true, metaKey: true, ctrlKey: false }),
    ).toBe("range");
  });
});

describe("applySelectionClick", () => {
  it("resets to a single row on a plain click", () => {
    const next = applySelectionClick(
      selection(["a.ts", "b.ts", "c.ts"], "a.ts"),
      "d.ts",
      "replace",
      ORDER,
    );
    expect(next).toEqual({ paths: ["d.ts"], anchor: "d.ts" });
  });

  it("toggles a row in and back out", () => {
    const added = applySelectionClick(
      selection(["b.ts"], "b.ts"),
      "d.ts",
      "toggle",
      ORDER,
    );
    expect(added.paths).toEqual(["b.ts", "d.ts"]);
    expect(added.anchor).toBe("d.ts");

    const removed = applySelectionClick(added, "b.ts", "toggle", ORDER);
    expect(removed.paths).toEqual(["d.ts"]);
    expect(removed.anchor).toBe("b.ts");
  });

  it("keeps toggled rows in visual order, not click order", () => {
    const first = applySelectionClick(EMPTY_SELECTION, "e.ts", "toggle", ORDER);
    const second = applySelectionClick(first, "b.ts", "toggle", ORDER);
    expect(second.paths).toEqual(["b.ts", "e.ts"]);
  });

  it("extends a contiguous range from the anchor", () => {
    const next = applySelectionClick(
      selection(["b.ts"], "b.ts"),
      "d.ts",
      "range",
      ORDER,
    );
    expect(next.paths).toEqual(["b.ts", "c.ts", "d.ts"]);
    expect(next.anchor).toBe("b.ts");
  });

  it("extends upward when the click is above the anchor", () => {
    const next = applySelectionClick(
      selection(["d.ts"], "d.ts"),
      "b.ts",
      "range",
      ORDER,
    );
    expect(next.paths).toEqual(["b.ts", "c.ts", "d.ts"]);
    expect(next.anchor).toBe("d.ts");
  });

  it("re-extends from the same anchor, shrinking the previous range", () => {
    const wide = applySelectionClick(
      selection(["a.ts"], "a.ts"),
      "e.ts",
      "range",
      ORDER,
    );
    expect(wide.paths).toEqual(ORDER);
    const narrowed = applySelectionClick(wide, "b.ts", "range", ORDER);
    expect(narrowed.paths).toEqual(["a.ts", "b.ts"]);
  });

  it("replaces cross-section picks when a range is drawn", () => {
    const next = applySelectionClick(
      selection(["other/x.ts", "b.ts"], "b.ts"),
      "c.ts",
      "range",
      ORDER,
    );
    expect(next.paths).toEqual(["b.ts", "c.ts"]);
  });

  it("adds the clicked row when the anchor is from another section", () => {
    const next = applySelectionClick(
      selection(["other/x.ts"], "other/x.ts"),
      "c.ts",
      "range",
      ORDER,
    );
    expect(next.paths).toEqual(["c.ts", "other/x.ts"]);
    expect(next.anchor).toBe("c.ts");
  });

  it("treats unselectable rows as a plain click, whatever the modifier", () => {
    for (const modifier of ["toggle", "range"] as const) {
      const next = applySelectionClick(
        selection(["a.ts", "b.ts"], "a.ts"),
        "src", // a directory row: never present in the order
        modifier,
        ORDER,
      );
      expect(next).toEqual({ paths: ["src"], anchor: "src" });
    }
  });
});

describe("pruneSelection", () => {
  it("returns the same object when nothing disappeared", () => {
    const current = selection(["a.ts", "b.ts"], "a.ts");
    expect(pruneSelection(current, new Set(ORDER))).toBe(current);
  });

  it("drops files that left the list", () => {
    const next = pruneSelection(
      selection(["a.ts", "b.ts", "c.ts"], "a.ts"),
      new Set(["a.ts", "c.ts"]),
    );
    expect(next.paths).toEqual(["a.ts", "c.ts"]);
    expect(next.anchor).toBe("a.ts");
  });

  it("re-anchors when the anchor itself disappeared", () => {
    const next = pruneSelection(
      selection(["a.ts", "b.ts", "c.ts"], "a.ts"),
      new Set(["b.ts", "c.ts"]),
    );
    expect(next).toEqual({ paths: ["b.ts", "c.ts"], anchor: "b.ts" });
  });

  it("clears entirely once fewer than two survive", () => {
    expect(
      pruneSelection(selection(["a.ts", "b.ts"], "a.ts"), new Set(["b.ts"])),
    ).toBe(EMPTY_SELECTION);
    expect(pruneSelection(selection(["a.ts", "b.ts"], "a.ts"), new Set())).toBe(
      EMPTY_SELECTION,
    );
  });
});

describe("isMultiSelection", () => {
  it("needs two rows", () => {
    expect(isMultiSelection(EMPTY_SELECTION)).toBe(false);
    expect(isMultiSelection(selection(["a.ts"], "a.ts"))).toBe(false);
    expect(isMultiSelection(selection(["a.ts", "b.ts"], "a.ts"))).toBe(true);
  });
});

describe("flattenVisibleFilePaths", () => {
  function file(
    path: string,
    total = 1,
    matchesFilter = true,
  ): SelectableTreeEntry {
    return { path, isDirectory: false, matchesFilter, hunkStatus: { total } };
  }
  function dir(
    path: string,
    children: SelectableTreeEntry[],
    matchesFilter = true,
  ): SelectableTreeEntry {
    return {
      path,
      isDirectory: true,
      matchesFilter,
      hunkStatus: { total: 0 },
      children,
    };
  }

  const tree: SelectableTreeEntry[] = [
    dir("src", [
      file("src/a.ts"),
      dir("src/deep", [file("src/deep/z.ts")]),
      file("src/b.ts"),
    ]),
    file("root.ts"),
  ];

  it("walks depth-first in render order and omits directories", () => {
    const expanded = new Set(["src", "src/deep"]);
    expect(flattenVisibleFilePaths(tree, expanded)).toEqual([
      "src/a.ts",
      "src/deep/z.ts",
      "src/b.ts",
      "root.ts",
    ]);
  });

  it("skips the subtree of a collapsed directory", () => {
    expect(flattenVisibleFilePaths(tree, new Set(["src"]))).toEqual([
      "src/a.ts",
      "src/b.ts",
      "root.ts",
    ]);
    expect(flattenVisibleFilePaths(tree, new Set())).toEqual(["root.ts"]);
  });

  it("skips filtered-out rows and rows with no hunks", () => {
    const entries = [
      file("visible.ts"),
      file("filtered.ts", 1, false),
      file("no-hunks.ts", 0),
    ];
    expect(flattenVisibleFilePaths(entries, new Set())).toEqual(["visible.ts"]);
  });
});

describe("selectionHunkIds", () => {
  it("collects hunks in selection order and tolerates unknown files", () => {
    const hunks: Record<string, { id: string }[]> = {
      "a.ts": [{ id: "a.ts:1" }, { id: "a.ts:2" }],
      "b.ts": [{ id: "b.ts:1" }],
    };
    expect(
      selectionHunkIds(["b.ts", "a.ts", "gone.ts"], (p) => hunks[p]),
    ).toEqual(["b.ts:1", "a.ts:1", "a.ts:2"]);
  });
});

describe("resolvePaneFiles", () => {
  it("points at the primary file when there is no split", () => {
    expect(resolvePaneFiles("a.ts", null, "primary")).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });

  it("ignores a stale focusedPane when the split is closed", () => {
    expect(resolvePaneFiles("a.ts", null, "secondary")).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });

  it("follows focus into the secondary pane", () => {
    expect(resolvePaneFiles("a.ts", "b.ts", "secondary")).toEqual({
      activePath: "b.ts",
      companionPath: "a.ts",
    });
  });

  it("marks the secondary file weakly while the primary has focus", () => {
    expect(resolvePaneFiles("a.ts", "b.ts", "primary")).toEqual({
      activePath: "a.ts",
      companionPath: "b.ts",
    });
  });

  it("treats the empty-split placeholder as no split", () => {
    expect(resolvePaneFiles("a.ts", "", "secondary")).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });

  it("does not mark the same file twice", () => {
    expect(resolvePaneFiles("a.ts", "a.ts", "primary")).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });
});
