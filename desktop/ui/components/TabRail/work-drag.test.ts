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
  gapPosition,
  isWorkCardDrag,
  isWorkDrag,
  terminalsInFlight,
  WORK_ITEM_MIME,
  WORK_REF_MIME,
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

describe("what each drop target accepts", () => {
  it("takes a ref, a card and a terminal into the section", () => {
    expect(isWorkDrag([WORK_REF_MIME])).toBe(true);
    expect(isWorkDrag([WORK_ITEM_MIME])).toBe(true);
    expect(isWorkDrag([TERMINAL_SESSION_MIME])).toBe(true);
    expect(isWorkDrag(["text/plain"])).toBe(false);
  });

  it("takes everything but another card onto a card", () => {
    // A card dropped on a card is a reorder with no position — it lands in a
    // gap or nowhere.
    expect(isWorkCardDrag([WORK_ITEM_MIME])).toBe(false);
    expect(isWorkCardDrag([WORK_REF_MIME])).toBe(true);
    expect(isWorkCardDrag([TERMINAL_SESSION_MIME])).toBe(true);
  });

  it("takes a terminal by any of its three grips", () => {
    // A sidebar row, a panel pane, and a strip tab are one gesture as far as
    // the section is concerned: a terminal arriving to be claimed.
    for (const mime of [
      TERMINAL_SESSION_MIME,
      TERMINAL_PANE_MIME,
      TERMINAL_TAB_MIME,
    ]) {
      expect(isWorkDrag([mime])).toBe(true);
      expect(isWorkCardDrag([mime])).toBe(true);
    }
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
