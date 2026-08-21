import { vi, describe, it, expect, afterEach } from "vitest";

const backend = vi.hoisted(() => ({
  listWorkspaces: vi.fn(),
  addWorkspace: vi.fn(),
  attachWorkspace: vi.fn(),
  detachWorkspace: vi.fn(),
  moveWorkspace: vi.fn(),
}));

vi.mock("../../api", () => ({ getApiClient: () => backend }));

import {
  dragCarrying,
  gapDepth,
  gapPosition,
  resolveWorkDropTarget,
  terminalsInFlight,
  workspaceDragFrom,
  WORKSPACE_MIME,
  type WorkTargetRects,
} from "./workspace-drag";
import { workspace } from "../../test/fixtures";
import {
  setDraggedPane,
  setDraggedTab,
  setDraggedTerminal,
  TERMINAL_PANE_MIME,
  TERMINAL_SESSION_MIME,
  TERMINAL_TAB_MIME,
} from "../Terminal/pane-drag";
import { useReviewStore } from "../../stores";
import { leaf, makeTab, splitLeaf } from "../Terminal/pane-tree";

describe("gapPosition", () => {
  it("counts the list as it looks before the card is lifted out", () => {
    // Card 0 dropped in the gap below card 2 lands at index 1 once removed.
    expect(gapPosition(0, 2)).toBe(1);
    // Dragging upward needs no adjustment — the gaps above it haven't moved.
    expect(gapPosition(2, 0)).toBe(0);
    // The gaps either side of a card are both no-ops.
    expect(gapPosition(1, 1)).toBe(1);
    expect(gapPosition(1, 2)).toBe(1);
  });

  it("shifts by the whole subtree a parent carries with it", () => {
    // A card holding two nested workspaces leaves a three-row hole, so a gap
    // below it has moved up by three, not by one.
    expect(gapPosition(0, 4, 3)).toBe(1);
    // Gaps above the card are unaffected however much it carries.
    expect(gapPosition(3, 1, 3)).toBe(1);
  });

  it("treats a gap inside the dragged subtree as no move at all", () => {
    // Hovering between a parent and one of its own children: the only thing
    // that gap can mean is "leave it here". Subtracting the subtree there
    // counts rows that are not above the card, and used to send the whole
    // group somewhere it was never dragged.
    expect(gapPosition(3, 4, 3)).toBe(3);
    expect(gapPosition(3, 5, 3)).toBe(3);
    // The gap just past the subtree is the last one that changes nothing.
    expect(gapPosition(3, 6, 3)).toBe(3);
    // One row further down does move it.
    expect(gapPosition(3, 7, 3)).toBe(4);
  });
});

/** A queue: `parent` holding `child`, then a loose card. */
const nested = [
  workspace("parent"),
  workspace("child", { parentId: "parent", depth: 1 }),
  workspace("loose"),
];

describe("workspaceDragFrom", () => {
  it("carries a card's whole subtree, and rules it out as a target", () => {
    expect(workspaceDragFrom(nested, 0)).toEqual({
      id: "parent",
      index: 0,
      size: 2,
      ids: ["parent", "child"],
    });
    // A leaf carries only itself.
    expect(workspaceDragFrom(nested, 1)?.size).toBe(1);
    expect(workspaceDragFrom(nested, 9)).toBeNull();
  });
});

describe("gapDepth", () => {
  const loose = workspaceDragFrom(nested, 2);

  it("draws the line at the depth the drop will land at", () => {
    // Above the parent: the top level.
    expect(gapDepth(nested, loose, 0)).toBe(0);
    // Between the parent and its child: the drop lands as another child, so
    // the line is indented to say so.
    expect(gapDepth(nested, loose, 1)).toBe(1);
    // Past the last row there is nothing to be a sibling of — which is how a
    // nested card is dragged back out.
    expect(gapDepth(nested, loose, 3)).toBe(0);
  });

  it("measures a terminal drag against the list as it stands", () => {
    // A terminal lifts nothing out, and the workspace it mints lands as a
    // sibling of the row it displaces — so the line is drawn there.
    expect(gapDepth(nested, null, 0)).toBe(0);
    expect(gapDepth(nested, null, 1)).toBe(1);
    expect(gapDepth(nested, null, 3)).toBe(0);
  });

  it("holds the line at the card's own depth where nothing would move", () => {
    const child = workspaceDragFrom(nested, 1);
    // The gaps either side of the card it is already in: the line stays at
    // the indent the card is drawn at rather than jumping to whatever row
    // follows its subtree.
    expect(gapDepth(nested, child, 1)).toBe(1);
    expect(gapDepth(nested, child, 2)).toBe(1);

    // And the gaps inside a parent's own subtree say the same thing.
    const parent = workspaceDragFrom(nested, 0);
    expect(gapDepth(nested, parent, 1)).toBe(0);
    expect(gapDepth(nested, parent, 2)).toBe(0);
  });

  it("ignores the rows the drag itself is carrying", () => {
    // Dragging the parent, the gap that was "between parent and child" is
    // measured against the list with both of them lifted out.
    const parent = workspaceDragFrom(nested, 0);
    expect(gapDepth(nested, parent, 3)).toBe(0);
  });
});

describe("dragCarrying", () => {
  it("names what a work drag's MIME types carry", () => {
    expect(dragCarrying([WORKSPACE_MIME])).toBe("item");
    expect(dragCarrying(["text/plain"])).toBeNull();
  });

  it("takes a terminal by any of its three grips", () => {
    // A sidebar row, a panel pane, and a strip tab are one gesture as far as
    // the section is concerned: a terminal arriving to be claimed.
    for (const mime of [
      TERMINAL_SESSION_MIME,
      TERMINAL_PANE_MIME,
      TERMINAL_TAB_MIME,
    ]) {
      expect(dragCarrying([mime])).toBe("terminal");
    }
  });
});

describe("resolveWorkDropTarget", () => {
  const box = (top: number, bottom: number) => ({
    top,
    bottom,
    left: 0,
    right: 100,
  });
  /** Two 20px cards with a 10px gap, inside a 100px section. */
  const rects: WorkTargetRects = {
    section: box(0, 100),
    cards: [
      { rect: box(10, 30), itemId: "a" },
      { rect: box(40, 60), itemId: "b" },
    ],
  };

  it("resolves a reorder to a gap wherever the cursor is", () => {
    // Over a card's body — where the cursor spends the whole drag — the
    // nearest gap wins, decided by the card midpoints (20 and 50).
    expect(resolveWorkDropTarget(50, 15, true, rects)).toEqual({
      kind: "gap",
      index: 0,
    });
    expect(resolveWorkDropTarget(50, 25, true, rects)).toEqual({
      kind: "gap",
      index: 1,
    });
    expect(resolveWorkDropTarget(50, 90, true, rects)).toEqual({
      kind: "gap",
      index: 2,
    });
  });

  it("nests a reorder dropped on the middle of an entry", () => {
    // A card has one thing to say that a vertical position cannot: go one
    // level deeper. It gets the middle third, and the gaps keep the rest —
    // the wider band a terminal drop uses made every reorder over a card body
    // read as "nest under this".
    expect(resolveWorkDropTarget(50, 20, true, rects)).toEqual({
      kind: "card",
      itemId: "a",
    });
    // Just outside the band, the insertion line is back.
    expect(resolveWorkDropTarget(50, 16, true, rects)).toEqual({
      kind: "gap",
      index: 0,
    });
  });

  it("won't offer a card the drag is already carrying", () => {
    // Nesting a workspace under itself, or under something already beneath
    // it, is the one impossible nesting — so it is never highlighted.
    expect(resolveWorkDropTarget(50, 20, true, rects, ["a"])).toEqual({
      kind: "gap",
      index: 1,
    });
  });

  it("drops a terminal onto the entry under the cursor", () => {
    expect(resolveWorkDropTarget(50, 20, false, rects)).toEqual({
      kind: "card",
      itemId: "a",
    });
    expect(resolveWorkDropTarget(50, 50, false, rects)).toEqual({
      kind: "card",
      itemId: "b",
    });
  });

  it("inserts at an entry's thin edge bands and between entries", () => {
    // Just inside the top edge of entry "a" and the bottom edge of entry "b".
    expect(resolveWorkDropTarget(50, 11, false, rects)).toEqual({
      kind: "gap",
      index: 0,
    });
    expect(resolveWorkDropTarget(50, 59, false, rects)).toEqual({
      kind: "gap",
      index: 2,
    });
    // The space between the two entries.
    expect(resolveWorkDropTarget(50, 35, false, rects)).toEqual({
      kind: "gap",
      index: 1,
    });
  });

  it("is null outside the section", () => {
    expect(resolveWorkDropTarget(200, 20, true, rects)).toBeNull();
    expect(resolveWorkDropTarget(50, 120, true, rects)).toBeNull();
    expect(
      resolveWorkDropTarget(50, 20, true, { section: null, cards: [] }),
    ).toBeNull();
  });

  it("catches a drop near an empty section", () => {
    // With no cards the container is near zero-height; the padded catch area
    // is what lets the first item be dropped into it at all.
    const empty: WorkTargetRects = { section: box(50, 50), cards: [] };
    expect(resolveWorkDropTarget(50, 60, false, empty)).toEqual({
      kind: "gap",
      index: 0,
    });
    expect(resolveWorkDropTarget(50, 80, false, empty)).toBeNull();
  });
});

describe("terminalsInFlight", () => {
  afterEach(() => {
    setDraggedTerminal(null);
    setDraggedPane(null);
    setDraggedTab(null);
    useReviewStore.setState({ terminalTabs: [] });
  });

  it("is empty with nothing in flight", () => {
    expect(terminalsInFlight()).toEqual([]);
  });

  /** One tab holding two panes — the thing all three grips resolve to. */
  function splitTab() {
    useReviewStore.setState({
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
    });
  }

  it("reads a sidebar row as the whole tab behind it", () => {
    splitTab();
    setDraggedTerminal("a");
    expect(terminalsInFlight()).toEqual(["a", "b"]);
  });

  it("reads a pane as the whole tab it sits in", () => {
    splitTab();
    setDraggedPane("b");
    expect(terminalsInFlight()).toEqual(["a", "b"]);
  });

  it("reads a tab as every session it holds", () => {
    splitTab();
    setDraggedTab({ tabId: "tabA", index: 0 });
    expect(terminalsInFlight()).toEqual(["a", "b"]);
  });

  it("falls back to the session itself when no tab holds it", () => {
    setDraggedTerminal("a");
    expect(terminalsInFlight()).toEqual(["a"]);
  });
});
