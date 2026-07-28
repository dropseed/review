import { describe, it, expect } from "vitest";
import {
  EMPTY_SELECTION,
  applySelectionClick,
  arePanesOnScreen,
  flattenVisibleFilePaths,
  isMultiSelection,
  pruneSelection,
  refreshedHunkIds,
  resolvePaneFiles,
  selectionHunkIds,
  selectionModifier,
  type FileSelection,
  type SelectableTreeEntry,
} from "./fileSelection";

const ORDER = ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"];

/** The section every fixture click happens in unless it says otherwise. */
const SECTION = "needs-review";

function selection(
  paths: string[],
  anchor: string | null,
  section = SECTION,
): FileSelection {
  return { paths, anchor: anchor === null ? null : { path: anchor, section } };
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
      SECTION,
    );
    expect(next).toEqual(selection(["d.ts"], "d.ts"));
  });

  it("toggles a row in and back out", () => {
    const added = applySelectionClick(
      selection(["b.ts"], "b.ts"),
      "d.ts",
      "toggle",
      ORDER,
      SECTION,
    );
    expect(added.paths).toEqual(["b.ts", "d.ts"]);
    expect(added.anchor).toEqual({ path: "d.ts", section: SECTION });

    const removed = applySelectionClick(
      added,
      "b.ts",
      "toggle",
      ORDER,
      SECTION,
    );
    expect(removed.paths).toEqual(["d.ts"]);
    expect(removed.anchor).toEqual({ path: "b.ts", section: SECTION });
  });

  it("keeps toggled rows in visual order, not click order", () => {
    const first = applySelectionClick(
      EMPTY_SELECTION,
      "e.ts",
      "toggle",
      ORDER,
      SECTION,
    );
    const second = applySelectionClick(first, "b.ts", "toggle", ORDER, SECTION);
    expect(second.paths).toEqual(["b.ts", "e.ts"]);
  });

  it("extends a contiguous range from the anchor", () => {
    const next = applySelectionClick(
      selection(["b.ts"], "b.ts"),
      "d.ts",
      "range",
      ORDER,
      SECTION,
    );
    expect(next.paths).toEqual(["b.ts", "c.ts", "d.ts"]);
    expect(next.anchor).toEqual({ path: "b.ts", section: SECTION });
  });

  it("extends upward when the click is above the anchor", () => {
    const next = applySelectionClick(
      selection(["d.ts"], "d.ts"),
      "b.ts",
      "range",
      ORDER,
      SECTION,
    );
    expect(next.paths).toEqual(["b.ts", "c.ts", "d.ts"]);
    expect(next.anchor).toEqual({ path: "d.ts", section: SECTION });
  });

  it("re-extends from the same anchor, shrinking the previous range", () => {
    const wide = applySelectionClick(
      selection(["a.ts"], "a.ts"),
      "e.ts",
      "range",
      ORDER,
      SECTION,
    );
    expect(wide.paths).toEqual(ORDER);
    const narrowed = applySelectionClick(wide, "b.ts", "range", ORDER, SECTION);
    expect(narrowed.paths).toEqual(["a.ts", "b.ts"]);
  });

  it("replaces cross-section picks when a range is drawn", () => {
    const next = applySelectionClick(
      selection(["other/x.ts", "b.ts"], "b.ts"),
      "c.ts",
      "range",
      ORDER,
      SECTION,
    );
    expect(next.paths).toEqual(["b.ts", "c.ts"]);
  });

  it("adds the clicked row when the anchor is from another section", () => {
    const next = applySelectionClick(
      selection(["other/x.ts"], "other/x.ts", "trusted"),
      "c.ts",
      "range",
      ORDER,
      SECTION,
    );
    expect(next.paths).toEqual(["c.ts", "other/x.ts"]);
    expect(next.anchor).toEqual({ path: "c.ts", section: SECTION });
  });

  // Sections overlap by path on purpose: a file with one pending hunk and
  // three trusted ones is a row in Needs Review *and* in Trusted. An anchor
  // that is only a path can't tell those two rows apart.
  describe("across sections that list the same file", () => {
    const NEEDS_REVIEW = ["foo.ts", "zed.ts"];
    const TRUSTED = ["aaa.ts", "bbb.ts", "foo.ts"];

    it("does not extend a Needs Review anchor through Trusted", () => {
      const anchored = applySelectionClick(
        EMPTY_SELECTION,
        "foo.ts",
        "toggle",
        NEEDS_REVIEW,
        "needs-review",
      );
      const next = applySelectionClick(
        anchored,
        "aaa.ts",
        "range",
        TRUSTED,
        "trusted",
      );
      // One row added, not the whole aaa → foo sweep of the Trusted list.
      expect(next.paths).toEqual(["aaa.ts", "foo.ts"]);
      expect(next.anchor).toEqual({ path: "aaa.ts", section: "trusted" });
    });

    it("still extends within the section that set the anchor", () => {
      const anchored = applySelectionClick(
        EMPTY_SELECTION,
        "foo.ts",
        "toggle",
        TRUSTED,
        "trusted",
      );
      const next = applySelectionClick(
        anchored,
        "aaa.ts",
        "range",
        TRUSTED,
        "trusted",
      );
      expect(next.paths).toEqual(TRUSTED);
    });
  });

  it("treats unselectable rows as a plain click, whatever the modifier", () => {
    for (const modifier of ["toggle", "range"] as const) {
      const next = applySelectionClick(
        selection(["a.ts", "b.ts"], "a.ts"),
        "src", // a directory row: never present in the order
        modifier,
        ORDER,
        SECTION,
      );
      expect(next).toEqual(selection(["src"], "src"));
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
    expect(next.anchor).toEqual({ path: "a.ts", section: SECTION });
  });

  it("re-anchors within the same section when the anchor disappeared", () => {
    const next = pruneSelection(
      selection(["a.ts", "b.ts", "c.ts"], "a.ts"),
      new Set(["b.ts", "c.ts"]),
    );
    expect(next).toEqual(selection(["b.ts", "c.ts"], "b.ts"));
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

describe("refreshedHunkIds", () => {
  const hunks: Record<string, { id: string }[]> = {
    "a.ts": [{ id: "a.ts:old" }],
    "b.ts": [{ id: "b.ts:1" }],
  };

  it("reports nothing to do while the ids still match", () => {
    expect(
      refreshedHunkIds(
        ["a.ts:old", "b.ts:1"],
        ["a.ts", "b.ts"],
        (p) => hunks[p],
      ),
    ).toBeNull();
  });

  it("re-derives ids a re-diff invalidated", () => {
    // Editing a.ts rewrites its content hash, so every id it had is retired.
    const edited: Record<string, { id: string }[]> = {
      ...hunks,
      "a.ts": [{ id: "a.ts:new" }],
    };
    expect(
      refreshedHunkIds(
        ["a.ts:old", "b.ts:1"],
        ["a.ts", "b.ts"],
        (p) => edited[p],
      ),
    ).toEqual(["a.ts:new", "b.ts:1"]);
  });

  it("notices hunks appearing and disappearing", () => {
    expect(
      refreshedHunkIds(["a.ts:old", "b.ts:1"], ["a.ts"], (p) => hunks[p]),
    ).toEqual(["a.ts:old"]);
    expect(refreshedHunkIds([], ["b.ts"], (p) => hunks[p])).toEqual(["b.ts:1"]);
  });
});

describe("arePanesOnScreen", () => {
  it("is true only with no rolling diff over the panes", () => {
    expect(arePanesOnScreen(null, null)).toBe(true);
    expect(arePanesOnScreen("adhoc-group", null)).toBe(false);
    expect(arePanesOnScreen(null, { paths: [] })).toBe(false);
  });
});

describe("resolvePaneFiles", () => {
  it("points at the primary file when there is no split", () => {
    expect(resolvePaneFiles("a.ts", null, "primary", true)).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });

  it("ignores a stale focusedPane when the split is closed", () => {
    expect(resolvePaneFiles("a.ts", null, "secondary", true)).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });

  it("follows focus into the secondary pane", () => {
    expect(resolvePaneFiles("a.ts", "b.ts", "secondary", true)).toEqual({
      activePath: "b.ts",
      companionPath: "a.ts",
    });
  });

  it("marks the secondary file weakly while the primary has focus", () => {
    expect(resolvePaneFiles("a.ts", "b.ts", "primary", true)).toEqual({
      activePath: "a.ts",
      companionPath: "b.ts",
    });
  });

  it("treats the empty-split placeholder as no split", () => {
    expect(resolvePaneFiles("a.ts", "", "secondary", true)).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });

  it("does not mark the same file twice", () => {
    expect(resolvePaneFiles("a.ts", "a.ts", "primary", true)).toEqual({
      activePath: "a.ts",
      companionPath: null,
    });
  });

  it("marks nothing while a rolling diff has replaced the panes", () => {
    // Opening an ad-hoc group clears selectedFile but leaves secondaryFile and
    // focusedPane behind, so the split's file would otherwise keep the "you
    // are here" accent while nothing of it is on screen.
    expect(resolvePaneFiles(null, "b.ts", "secondary", false)).toEqual({
      activePath: null,
      companionPath: null,
    });
    expect(resolvePaneFiles("a.ts", "b.ts", "primary", false)).toEqual({
      activePath: null,
      companionPath: null,
    });
  });
});
