import { vi, describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Hoisted, because the store builds its client the moment the module under
// test is imported — which is before any plain `const` here has run.
const {
  addWorkspace,
  detachWorkspace,
  moveWorkspace,
  terminalAssignWorkspace,
} = vi.hoisted(() => ({
  addWorkspace: vi.fn().mockResolvedValue([]),
  detachWorkspace: vi.fn().mockResolvedValue([]),
  moveWorkspace: vi.fn().mockResolvedValue([]),
  terminalAssignWorkspace: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../api", () => ({
  getApiClient: () => ({
    listWorkspaces: vi.fn().mockResolvedValue([]),
    addWorkspace,
    detachWorkspace,
    moveWorkspace,
    terminalAssignWorkspace,
  }),
}));

import { useReviewStore } from "../../stores";
import { leaf, makeTab, splitLeaf } from "../Terminal/pane-tree";
import type { Workspace } from "../../types";
import { attachment, workspace } from "../../test/fixtures";
import {
  flattenWorkActions,
  terminalActions,
  workActionVerb,
  workspaceActions,
  type WorkAction,
} from "./workspace-actions";
import { describeWorkspace } from "./workspace-status";
import type { WorkspaceContext } from "./workspace-status";

const REPO = "/repo";

function item(
  id: string,
  attachments = [attachment(REPO, "feature")],
): Workspace {
  return workspace(id, { attachments });
}

const EMPTY_CONTEXT: WorkspaceContext = {
  rows: new Map(),
  rowsByRepoRef: new Map(),
  repoNames: new Map(),
  knownRepos: new Set(),
  heads: new Map(),
  shipped: new Map(),
};

function cardActions(items: Workspace[], index: number): WorkAction[] {
  // The move verbs are a function of the *queue* — they reorder a card among
  // its siblings — so the store has to be holding the list they are about.
  useReviewStore.setState({ workspaces: items });
  return workspaceActions({
    workspace: items[index],
    index,
    status: describeWorkspace(items[index], EMPTY_CONTEXT),
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
    workspaces: [],
    terminalTabs: [],
    terminalSessions: {},
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
    gesture: "drag a terminal onto a queue entry",
    noun: "terminal",
    actions: () =>
      terminalActions({
        sessionIds: ["a"],
        attachedItemId: null,
        workspaces: [item("one")],
      }),
    verb: "terminal.addTo",
  },
  {
    gesture: "drop a terminal between entries, making a workspace",
    noun: "terminal",
    actions: () =>
      terminalActions({
        sessionIds: ["a"],
        attachedItemId: null,
        workspaces: [item("one")],
      }),
    verb: "terminal.addTo.new",
  },
  {
    gesture: "drag an entry up the queue",
    noun: "workspace",
    actions: () => cardActions([item("one"), item("two")], 1),
    verb: "workspace.moveUp",
  },
  {
    gesture: "drag an entry down the queue",
    noun: "workspace",
    actions: () => cardActions([item("one"), item("two")], 0),
    verb: "workspace.moveDown",
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
 * Every surface that *offers a menu* over a terminal renders one of the two
 * shared item lists, which is what makes their menus the same menu rather than
 * several that happen to agree — the grep is how that stays true. Both lists
 * come from `useTerminalActions`; they differ only in whether the menu is
 * opened by right-click or by a button.
 *
 * An open pane is not on this list, and deliberately: it offers no menu at all
 * now. Its whole surface is a live shell, so it can carry neither a right-click
 * trigger (see below) nor — once the hover cluster was cut back to the one
 * gesture with no keyboard equivalent — a button. The pane's verbs are its
 * tab's, which is the noun the strip already names them under.
 */
const TERMINAL_SURFACES = [
  "components/Terminal/TerminalPanel.tsx",
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
   * break vim, tmux and anything else that reads the mouse — so `PaneTree` must
   * hold no right-click trigger at all. A folded pane is a different noun — it
   * draws no terminal — and keeps its context menu in `CollapsedPane`.
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
      workspaces: items,
    });
    const many = terminalActions({
      sessionIds: ["a", "b"],
      attachedItemId: "one",
      workspaces: items,
    });
    expect(verbs(one)).toEqual(verbs(many));
  });

  it("declines to move a terminal into the workspace it is already in", () => {
    const items = [item("one"), item("two")];
    const actions = terminalActions({
      sessionIds: ["a"],
      attachedItemId: "one",
      workspaces: items,
    });
    const addTo = actions.find((a) => a.id === "terminal.addTo")?.items ?? [];
    expect(addTo.map((a) => [a.id, a.disabled ?? false])).toEqual([
      ["terminal.addTo:one", true],
      ["terminal.addTo:two", false],
      ["terminal.addTo.new", false],
    ]);
  });
});

describe("a menu verb runs the drag's own mutation", () => {
  it("moves a card to the position the drag would have put it", async () => {
    const items = [item("one"), item("two"), item("three")];
    useReviewStore.setState({ workspaces: items });

    // Card 0 moved down lands on row 1 — the row index counts the list after
    // the card has been lifted out — and keeps whatever it is nested under,
    // which is what separates a menu move from a drag.
    run(cardActions(items, 0), "workspace.moveDown");
    await vi.waitFor(() =>
      expect(moveWorkspace).toHaveBeenCalledWith("one", 1, true),
    );
  });

  it("moves a card past everything nested under its next sibling", async () => {
    // one, two (holding a child), three: moving `one` down has to clear the
    // child too, or it lands inside the group it was stepping over.
    const items = [
      item("one"),
      item("two"),
      workspace("child", { parentId: "two", depth: 1 }),
      item("three"),
    ];

    run(cardActions(items, 0), "workspace.moveDown");
    await vi.waitFor(() =>
      expect(moveWorkspace).toHaveBeenCalledWith("one", 2, true),
    );
  });

  it("moves a nested card among its siblings, never out of the group", async () => {
    // The row above `second` is `first`, its sibling; the row above *that* is
    // their parent, which "move up" must never make it a sibling of.
    const items = [
      item("parent"),
      workspace("first", { parentId: "parent", depth: 1 }),
      workspace("second", { parentId: "parent", depth: 1 }),
    ];

    run(cardActions(items, 2), "workspace.moveUp");
    await vi.waitFor(() =>
      expect(moveWorkspace).toHaveBeenCalledWith("second", 1, true),
    );
  });

  it("offers a nested card the way out, and a top-level one nothing to leave", () => {
    const items = [
      item("parent"),
      workspace("child", { parentId: "parent", depth: 1 }),
    ];
    const has = (index: number) =>
      flattenWorkActions(cardActions(items, index)).some(
        (action) => workActionVerb(action.id) === "workspace.unnest",
      );
    expect(has(1)).toBe(true);
    expect(has(0)).toBe(false);
  });

  it("closes a repo through the slice the tab bar writes with", async () => {
    const items = [item("one")];
    useReviewStore.setState({ workspaces: items });

    run(cardActions(items, 0), "workspace.repo.remove");

    await vi.waitFor(() =>
      expect(detachWorkspace).toHaveBeenCalledWith("one", REPO),
    );
  });

  it("attaches a terminal to the item its verb names", async () => {
    const items = [item("one")];
    useReviewStore.setState({
      workspaces: items,
      terminalTabs: [makeTab("tabA", "a")],
    });

    run(
      terminalActions({
        sessionIds: ["a"],
        attachedItemId: null,
        workspaces: items,
      }),
      "terminal.addTo",
    );

    await vi.waitFor(() =>
      expect(terminalAssignWorkspace).toHaveBeenCalledWith("a", "one"),
    );
  });

  it("attaches the tab a split's panes belong to, not the pane named", async () => {
    const items = [item("one")];
    useReviewStore.setState({
      workspaces: items,
      terminalTabs: [
        {
          ...makeTab("tabA", "a"),
          root: splitLeaf(leaf("a"), "a", "b", "row"),
        },
      ],
    });

    run(
      terminalActions({
        sessionIds: ["a", "b"],
        attachedItemId: null,
        workspaces: items,
      }),
      "terminal.addTo",
    );

    // Every pane of the tab moves, not just the one the verb named.
    await vi.waitFor(() => {
      expect(terminalAssignWorkspace).toHaveBeenCalledWith("a", "one");
      expect(terminalAssignWorkspace).toHaveBeenCalledWith("b", "one");
    });
  });
});

describe("what a noun declines to offer", () => {
  it("won't move the first sibling up, or the last one down", () => {
    const items = [item("one"), item("two")];
    const first = cardActions(items, 0);
    const last = cardActions(items, 1);
    const find = (actions: WorkAction[], verb: string) =>
      flattenWorkActions(actions).find((a) => workActionVerb(a.id) === verb);

    expect(find(first, "workspace.moveUp")?.disabled).toBe(true);
    expect(find(first, "workspace.moveTop")?.disabled).toBe(true);
    expect(find(last, "workspace.moveDown")?.disabled).toBe(true);
    expect(find(last, "workspace.moveUp")?.disabled).toBe(false);
  });

  /** A tab with no ref has no branch name to copy. */
  it("greys out copying the branch of a ref-less repo", () => {
    const bare = item("bare", [attachment("/tmp/scratch")]);
    const find = flattenWorkActions(cardActions([bare], 0)).find(
      (a) => workActionVerb(a.id) === "workspace.repo.copy",
    );
    expect(find?.disabled).toBe(true);
  });
});
