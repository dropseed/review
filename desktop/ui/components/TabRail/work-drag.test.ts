import { vi, describe, it, expect, afterEach, beforeEach } from "vitest";

const backend = vi.hoisted(() => ({
  listWorkItems: vi.fn(),
  addWorkItem: vi.fn(),
  bindWorkItem: vi.fn(),
  unbindWorkItem: vi.fn(),
  moveWorkItem: vi.fn(),
}));

vi.mock("../../api", () => ({ getApiClient: () => backend }));

import {
  applyWorkDrop,
  dragCarrying,
  gapPosition,
  resolveWorkDropTarget,
  terminalsInFlight,
  WORK_ITEM_MIME,
  WORK_REF_MIME,
  type WorkTargetRects,
} from "./work-drag";
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
import type { WorkItem, WorkRef } from "../../types";

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
    expect(dragCarrying([WORK_ITEM_MIME])).toBe("item");
    expect(dragCarrying([WORK_REF_MIME])).toBe("ref");
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
    expect(resolveWorkDropTarget(50, 15, "item", rects)).toEqual({
      kind: "gap",
      index: 0,
    });
    expect(resolveWorkDropTarget(50, 25, "item", rects)).toEqual({
      kind: "gap",
      index: 1,
    });
    expect(resolveWorkDropTarget(50, 90, "item", rects)).toEqual({
      kind: "gap",
      index: 2,
    });
  });

  it("never offers a card to a reorder", () => {
    expect(resolveWorkDropTarget(50, 20, "item", rects)).toEqual({
      kind: "gap",
      index: 1,
    });
  });

  it("binds a ref to the card under the cursor", () => {
    expect(resolveWorkDropTarget(50, 20, "ref", rects)).toEqual({
      kind: "card",
      itemId: "a",
    });
    expect(resolveWorkDropTarget(50, 50, "terminal", rects)).toEqual({
      kind: "card",
      itemId: "b",
    });
  });

  it("inserts a ref at a card's thin edge bands and between cards", () => {
    // Just inside the top edge of card "a" and the bottom edge of card "b".
    expect(resolveWorkDropTarget(50, 11, "ref", rects)).toEqual({
      kind: "gap",
      index: 0,
    });
    expect(resolveWorkDropTarget(50, 59, "ref", rects)).toEqual({
      kind: "gap",
      index: 2,
    });
    // The space between the two cards.
    expect(resolveWorkDropTarget(50, 35, "ref", rects)).toEqual({
      kind: "gap",
      index: 1,
    });
  });

  it("is null outside the section", () => {
    expect(resolveWorkDropTarget(200, 20, "item", rects)).toBeNull();
    expect(resolveWorkDropTarget(50, 120, "item", rects)).toBeNull();
    expect(
      resolveWorkDropTarget(50, 20, "item", { section: null, cards: [] }),
    ).toBeNull();
  });

  it("catches a drop near an empty section", () => {
    // With no cards the container is near zero-height; the padded catch area
    // is what lets the first item be dropped into it at all.
    const empty: WorkTargetRects = { section: box(50, 50), cards: [] };
    expect(resolveWorkDropTarget(50, 60, "ref", empty)).toEqual({
      kind: "gap",
      index: 0,
    });
    expect(resolveWorkDropTarget(50, 80, "ref", empty)).toBeNull();
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

describe("applyWorkDrop moving a ref between cards", () => {
  const REF = { repoPath: "/r", ref: "feature" };

  function item(id: string, refs: WorkRef[] = []): WorkItem {
    return { id, title: id, refs, createdAt: "2026-01-01T00:00:00Z" };
  }

  /** "a" holds the ref, "b" doesn't — the shape every move here starts from. */
  const withRef = [item("a", [REF]), item("b")];
  const withoutRef = [item("a"), item("b")];

  beforeEach(() => {
    for (const fn of Object.values(backend)) fn.mockReset();
    backend.listWorkItems.mockResolvedValue(withoutRef);
    backend.unbindWorkItem.mockResolvedValue(withoutRef);
    useReviewStore.setState({ workItems: withRef, lastWorkError: null });
  });

  const moveOntoCard = (itemId: string) =>
    applyWorkDrop(
      { kind: "card", itemId },
      { kind: "ref", drag: { ref: REF, fromItemId: "a" } },
    );

  it("unbinds then binds when both halves land", async () => {
    backend.bindWorkItem.mockResolvedValue([item("a"), item("b", [REF])]);

    await moveOntoCard("b");

    expect(backend.unbindWorkItem).toHaveBeenCalledTimes(1);
    expect(backend.bindWorkItem.mock.calls.map((c) => c[0])).toEqual(["b"]);
    expect(useReviewStore.getState().lastWorkError).toBeNull();
  });

  // The two halves are separate writes. Without the compensating re-bind the
  // ref is bound to nothing: "a" lost it and "b" never took it.
  it("puts the ref back when the target refuses it", async () => {
    backend.bindWorkItem
      .mockRejectedValueOnce(new Error("feature is already on “Other”"))
      .mockResolvedValueOnce(withRef);

    await moveOntoCard("b");

    expect(backend.bindWorkItem.mock.calls.map((c) => c[0])).toEqual([
      "b",
      "a",
    ]);
    expect(useReviewStore.getState().workItems).toEqual(withRef);
    // And the user still hears why the move failed — a rollback that succeeds
    // must not read as the drop having worked.
    expect(useReviewStore.getState().lastWorkError?.message).toContain(
      "already on",
    );
  });

  it("puts the ref back when the new card can't be created", async () => {
    backend.addWorkItem.mockRejectedValue(new Error("work.json is read-only"));
    backend.bindWorkItem.mockResolvedValue(withRef);

    await applyWorkDrop(
      { kind: "gap", index: 0 },
      { kind: "ref", drag: { ref: REF, fromItemId: "a" } },
    );

    expect(backend.bindWorkItem.mock.calls.map((c) => c[0])).toEqual(["a"]);
    expect(useReviewStore.getState().workItems).toEqual(withRef);
    expect(backend.moveWorkItem).not.toHaveBeenCalled();
  });

  // Nothing to undo, and undoing it would re-create the binding the failed
  // unbind was trying to remove.
  it("does not bind at all when the unbind itself fails", async () => {
    backend.unbindWorkItem.mockRejectedValue(new Error("contended"));

    await moveOntoCard("b");

    expect(backend.bindWorkItem).not.toHaveBeenCalled();
  });
});
