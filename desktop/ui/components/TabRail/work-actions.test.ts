import { vi, describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Hoisted, because the store builds its client the moment the module under
// test is imported — which is before any plain `const` here has run.
const { addWorkItem, bindWorkItem, unbindWorkItem, moveWorkItem } = vi.hoisted(
  () => ({
    addWorkItem: vi.fn().mockResolvedValue([]),
    bindWorkItem: vi.fn().mockResolvedValue([]),
    unbindWorkItem: vi.fn().mockResolvedValue([]),
    moveWorkItem: vi.fn().mockResolvedValue([]),
  }),
);

vi.mock("../../api", () => ({
  getApiClient: () => ({
    listWorkItems: vi.fn().mockResolvedValue([]),
    addWorkItem,
    bindWorkItem,
    unbindWorkItem,
    moveWorkItem,
  }),
}));

import { useReviewStore } from "../../stores";
import { itemHome } from "../../stores/slices/terminalSlice";
import { leaf, makeTab, splitLeaf } from "../Terminal/pane-tree";
import type { WorkItem } from "../../types";
import {
  flattenWorkActions,
  refRowActions,
  terminalActions,
  workActionVerb,
  workItemActions,
  workRefActions,
  type WorkAction,
} from "./work-actions";
import { describeWorkItem } from "./work-status";
import type { WorkContext } from "./work-status";

const REPO = "/repo";

function item(
  id: string,
  refs = [{ repoPath: REPO, ref: "feature" }],
): WorkItem {
  return { id, title: "", refs, createdAt: new Date().toISOString() };
}

const EMPTY_CONTEXT: WorkContext = {
  rows: new Map(),
  repoNames: new Map(),
  knownRepos: new Set(),
  reviews: {},
};

function cardActions(items: WorkItem[], index: number): WorkAction[] {
  return workItemActions({
    item: items[index],
    index,
    count: items.length,
    status: describeWorkItem(items[index], EMPTY_CONTEXT),
    onRename: () => {},
  });
}

/** Every verb id a noun offers, submenu contents included, verbs only. */
function verbs(actions: WorkAction[]): string[] {
  return flattenWorkActions(actions).map((action) => workActionVerb(action.id));
}

/**
 * Run `verb`. A verb that picks a target is a submenu whose *children* are the
 * runnable half, so the first runnable match is what a click would reach — for
 * "move this ref to…", the first other item.
 */
function run(actions: WorkAction[], verb: string): void {
  const action = flattenWorkActions(actions).find(
    (candidate) => workActionVerb(candidate.id) === verb && candidate.run,
  );
  if (!action?.run) throw new Error(`no runnable verb ${verb}`);
  action.run();
}

afterEach(() => {
  useReviewStore.setState({
    workItems: [],
    terminalTabs: [],
    terminalAttachments: {},
  });
  vi.clearAllMocks();
});

/**
 * The parity this whole module exists for: anything you can do by dragging,
 * you can also do from a menu.
 *
 * Each row names a gesture, the noun it is performed on, and the verb that noun
 * must offer for it. A drag added without its verb — or a verb renamed out from
 * under one — fails here rather than at the next person who tried to do it
 * without a mouse.
 */
const DRAG_PARITY: {
  gesture: string;
  noun: string;
  actions: () => WorkAction[];
  verb: string;
}[] = [
  {
    gesture: "drag a branch row onto the section",
    noun: "tree row",
    actions: () =>
      refRowActions({
        ref: "feature",
        addToWork: { bound: false, label: "Add to Working on", add: () => {} },
        onOpen: () => {},
      }),
    verb: "row.addToWork",
  },
  {
    gesture: "drag a ref chip onto another card",
    noun: "ref chip",
    actions: () =>
      workRefActions({
        ref: { repoPath: REPO, ref: "feature" },
        fromItemId: "one",
        items: [item("one"), item("two")],
      }),
    verb: "work.ref.move",
  },
  {
    gesture: "drag a terminal onto a card",
    noun: "terminal",
    actions: () =>
      terminalActions({
        sessionIds: ["a"],
        attachedItemId: null,
        items: [item("one")],
      }),
    verb: "terminal.addTo",
  },
  {
    gesture: "drop a terminal between cards, making one",
    noun: "terminal",
    actions: () =>
      terminalActions({
        sessionIds: ["a"],
        attachedItemId: null,
        items: [item("one")],
      }),
    verb: "terminal.addTo.new",
  },
  {
    gesture: "drag a card up the list",
    noun: "work item",
    actions: () => cardActions([item("one"), item("two")], 1),
    verb: "work.item.moveUp",
  },
  {
    gesture: "drag a card down the list",
    noun: "work item",
    actions: () => cardActions([item("one"), item("two")], 0),
    verb: "work.item.moveDown",
  },
];

describe("every drag has a menu verb", () => {
  for (const { gesture, noun, actions, verb } of DRAG_PARITY) {
    it(`${gesture} — ${noun} offers ${verb}`, () => {
      const offered = flattenWorkActions(actions()).find(
        (action) => workActionVerb(action.id) === verb,
      );
      expect(offered, `${noun} has no ${verb}`).toBeDefined();
      expect(offered?.run ?? offered?.items).toBeDefined();
      expect(offered?.disabled).not.toBe(true);
    });
  }
});

function surfaceSource(path: string): string {
  return readFileSync(resolve(process.cwd(), "ui", path), "utf8");
}

/**
 * Every surface that shows a terminal renders one of the two shared item
 * lists, which is what makes their menus the same menu rather than several
 * that happen to agree — the grep is how that stays true. Both lists come from
 * `useTerminalActions`; they differ only in whether the menu is opened by
 * right-click or by a button.
 */
const TERMINAL_SURFACES = [
  "components/TabRail/TerminalRow.tsx",
  "components/TabRail/UnclaimedTerminals.tsx",
  "components/Terminal/TerminalPanel.tsx",
  "components/Terminal/PaneTree.tsx",
  "components/Terminal/CollapsedPane.tsx",
];

describe("the terminal menu is one menu", () => {
  for (const surface of TERMINAL_SURFACES) {
    it(`${surface} renders the shared items`, () => {
      expect(surfaceSource(surface)).toMatch(
        /<Terminal(MenuItems|DropdownItems)\b/,
      );
    });
  }

  /**
   * The live terminal surface is the shell's, right button included: a TUI
   * with mouse reporting on is *sent* that press, and intercepting it would
   * break vim, tmux and anything else that reads the mouse. So the open pane's
   * menu hangs off a button in its hover chrome, and `PaneTree` must hold no
   * right-click trigger at all. A folded pane is a different noun — it draws no
   * terminal — and keeps its context menu in `CollapsedPane`.
   */
  it("keeps right-click off the pane's terminal surface", () => {
    expect(surfaceSource("components/Terminal/PaneTree.tsx")).not.toMatch(
      /ContextMenu|onContextMenu/,
    );
  });

  it("offers the same verbs however many sessions the noun names", () => {
    const items = [item("one")];
    // A band row or a pane names one session; a strip tab names its panes.
    const one = terminalActions({
      sessionIds: ["a"],
      attachedItemId: "one",
      items,
    });
    const many = terminalActions({
      sessionIds: ["a", "b"],
      attachedItemId: "one",
      items,
    });
    expect(verbs(one)).toEqual(verbs(many));
  });

  it("offers Detach only where there is something to detach from", () => {
    const items = [item("one")];
    expect(
      verbs(
        terminalActions({ sessionIds: ["a"], attachedItemId: null, items }),
      ),
    ).not.toContain("terminal.detach");
    expect(
      verbs(
        terminalActions({ sessionIds: ["a"], attachedItemId: "one", items }),
      ),
    ).toContain("terminal.detach");
  });
});

describe("a menu verb runs the drag's own mutation", () => {
  it("moves a card to the position the drag would have put it", async () => {
    const items = [item("one"), item("two"), item("three")];
    useReviewStore.setState({ workItems: items });

    // Card 0 moved down lands at 1 — the gap below it counts the list as it
    // looks before the card is lifted out, which is the drop path's own rule.
    run(cardActions(items, 0), "work.item.moveDown");
    await vi.waitFor(() => expect(moveWorkItem).toHaveBeenCalledWith("one", 1));
  });

  it("moves a chip's binding by unbinding then binding", async () => {
    const items = [item("one"), item("two")];
    useReviewStore.setState({ workItems: items });

    run(
      workRefActions({
        ref: { repoPath: REPO, ref: "feature" },
        fromItemId: "one",
        items,
      }),
      "work.ref.move",
    );

    await vi.waitFor(() => {
      expect(unbindWorkItem).toHaveBeenCalledWith("one", REPO, "feature");
      expect(bindWorkItem).toHaveBeenCalledWith("two", REPO, "feature");
    });
  });

  it("attaches a terminal to the item its verb names", async () => {
    const items = [item("one")];
    useReviewStore.setState({
      workItems: items,
      terminalTabs: [makeTab("tabA", "a")],
    });

    run(
      terminalActions({ sessionIds: ["a"], attachedItemId: null, items }),
      "terminal.addTo",
    );

    await vi.waitFor(() =>
      expect(useReviewStore.getState().terminalAttachments["tabA"]).toBe(
        itemHome("one"),
      ),
    );
  });

  it("attaches the tab a split's panes belong to, not the pane named", async () => {
    const items = [item("one")];
    useReviewStore.setState({
      workItems: items,
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
    });

    run(
      terminalActions({ sessionIds: ["a", "b"], attachedItemId: null, items }),
      "terminal.addTo",
    );

    await vi.waitFor(() => {
      const attachments = useReviewStore.getState().terminalAttachments;
      expect(attachments["tabA"]).toBe(itemHome("one"));
      expect(attachments["a"]).toBe(itemHome("one"));
      expect(attachments["b"]).toBe(itemHome("one"));
    });
  });

  it("detaches the whole tab from one of its panes", async () => {
    const items = [item("one")];
    useReviewStore.setState({
      workItems: items,
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
      terminalAttachments: {
        tabA: itemHome("one"),
        a: itemHome("one"),
        b: itemHome("one"),
      },
    });

    run(
      terminalActions({ sessionIds: ["a", "b"], attachedItemId: "one", items }),
      "terminal.detach",
    );

    await vi.waitFor(() =>
      expect(useReviewStore.getState().terminalAttachments).toEqual({}),
    );
  });
});

describe("what a noun declines to offer", () => {
  it("won't move the top card up, or the last one down", () => {
    const items = [item("one"), item("two")];
    const first = cardActions(items, 0);
    const last = cardActions(items, 1);
    const find = (actions: WorkAction[], verb: string) =>
      flattenWorkActions(actions).find((a) => workActionVerb(a.id) === verb);

    expect(find(first, "work.item.moveUp")?.disabled).toBe(true);
    expect(find(first, "work.item.moveTop")?.disabled).toBe(true);
    expect(find(last, "work.item.moveDown")?.disabled).toBe(true);
    expect(find(last, "work.item.moveUp")?.disabled).toBe(false);
  });

  it("won't move a chip when there is nowhere to move it", () => {
    const actions = workRefActions({
      ref: { repoPath: REPO, ref: "feature" },
      fromItemId: "one",
      items: [item("one")],
    });
    const move = actions.find((a) => a.id === "work.ref.move");
    expect(move?.disabled).toBe(true);
    expect(move?.items).toEqual([]);
  });

  it("says a ref is already in Working on rather than failing the add", () => {
    const actions = refRowActions({
      ref: "feature",
      addToWork: { bound: true, label: "In Working on", add: () => {} },
      onOpen: () => {},
    });
    const add = actions.find((a) => a.id === "row.addToWork");
    expect(add?.label).toBe("In Working on");
    expect(add?.disabled).toBe(true);
  });
});
