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
  gapPosition,
  resolveWorkDropTarget,
  terminalsInFlight,
  WORKSPACE_MIME,
  type WorkTargetRects,
} from "./workspace-drag";
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

  it("never offers an entry to a reorder", () => {
    expect(resolveWorkDropTarget(50, 20, true, rects)).toEqual({
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
