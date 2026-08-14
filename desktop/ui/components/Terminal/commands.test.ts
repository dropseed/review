import { describe, it, expect, vi, beforeEach } from "vitest";
import { TERMINAL_COMMANDS } from "./commands";
import type { Command, CommandContext } from "../../commands";
import { leaf, splitLeaf, type TerminalTab } from "./pane-tree";
import type { Attachment, Workspace } from "../../types";
import { attachment, workspace as makeWorkspace } from "../../test/fixtures";

const opened = vi.hoisted(() => ({ calls: [] as (Workspace | null)[] }));
vi.mock("./newTab", () => ({
  openTerminalTab: (workspace?: Workspace | null) => {
    opened.calls.push(workspace ?? null);
    return Promise.resolve("term-1");
  },
}));

/**
 * These commands answer "is there a pane to fold?" from the store rather than
 * from what has DOM focus, because they have to resolve the same way whether
 * they are run by their chord or picked out of the ⌘K palette — which holds
 * focus itself while it is resolving them. Both bugs this guards against were
 * silent: the entry appeared, greyed, and nothing said why.
 */

function tab(id: string, panes: string[]): TerminalTab {
  let root = leaf(panes[0]);
  for (const next of panes.slice(1))
    root = splitLeaf(root, panes[0], next, "row");
  return { id, root, focused: panes[0] };
}

/** The slice fields these commands read, with everything else left out. */
function context(store: Record<string, unknown>): CommandContext {
  return {
    store: {
      repoPath: "/repo",
      reviewRef: "main",
      contentFocus: "split",
      terminalsSupported: true,
      terminalCheckouts: {},
      terminalTabs: [],
      activeTabId: null,
      ...store,
    },
    keys: {},
  } as unknown as CommandContext;
}

function command(id: string): Command {
  const found = TERMINAL_COMMANDS.find((c) => c.id === id);
  if (!found) throw new Error(`no command ${id}`);
  return found;
}

const enabled = (id: string, store: Record<string, unknown>): boolean => {
  const cmd = command(id);
  return cmd.isEnabled ? cmd.isEnabled(context(store)) : true;
};

describe("⌘T", () => {
  const workspace = (id: string, attachments: Attachment[]): Workspace =>
    makeWorkspace(id, { title: id, attachments });

  beforeEach(() => {
    opened.calls = [];
  });

  const run = (store: Record<string, unknown>) =>
    command("terminal.new").run(
      context({
        workspaces: [],
        focusedWorkspaceId: null,
        activeReviewKey: null,
        ...store,
      }),
    );

  it("starts in the focused workspace, asking nothing", () => {
    const mine = workspace("ws-1", [attachment("/repo", "feature")]);
    run({ workspaces: [mine], focusedWorkspaceId: "ws-1" });
    expect(opened.calls).toEqual([mine]);
  });

  /**
   * The same answer the stage reads: the repo on screen names the workspace
   * showing it, so ⌘T lands there without anyone having clicked its card
   * first.
   */
  it("finds the workspace showing the repo on screen", () => {
    const mine = workspace("ws-1", [attachment("/repo", "feature")]);
    run({
      workspaces: [mine],
      activeReviewKey: { repoPath: "/repo", ref: "feature" },
    });
    expect(opened.calls).toEqual([mine]);
  });

  /** No workspace is not a reason to refuse — the router places it. */
  it("still starts a terminal with nothing focused", () => {
    run({});
    expect(opened.calls).toEqual([null]);
  });
});

describe("fold/unfold commands", () => {
  const twoPanes = [tab("tabA", ["a", "b"])];

  it("offers folding for the tab on screen", () => {
    const store = { terminalTabs: twoPanes, activeTabId: "tabA" };
    expect(enabled("view.collapseTerminalPane", store)).toBe(true);
    // Nothing folded yet, so there is nothing to unfold.
    expect(enabled("view.expandTerminalPanes", store)).toBe(false);
  });

  it("offers nothing while no tab is active", () => {
    expect(
      enabled("view.collapseTerminalPane", {
        terminalTabs: twoPanes,
        activeTabId: null,
      }),
    ).toBe(false);
  });

  it("stops offering folding once one pane is left showing", () => {
    const folded = tab("tabA", ["a", "b"]);
    folded.root = {
      type: "split",
      direction: "row",
      sizes: [0.5, 0.5],
      children: [leaf("a"), { type: "leaf", terminalId: "b", collapsed: true }],
    };
    const store = { terminalTabs: [folded], activeTabId: "tabA" };
    expect(enabled("view.collapseTerminalPane", store)).toBe(false);
    expect(enabled("view.expandTerminalPanes", store)).toBe(true);
  });

  it("offers neither with the panel closed", () => {
    const store = {
      contentFocus: "code",
      terminalTabs: twoPanes,
      activeTabId: "tabA",
    };
    expect(enabled("view.collapseTerminalPane", store)).toBe(false);
    expect(enabled("view.expandTerminalPanes", store)).toBe(false);
  });
});
