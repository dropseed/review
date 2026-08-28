import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import type { Attachment, TerminalSessionInfo } from "../../types";
import type { TerminalTab } from "./pane-tree";

vi.mock("../../api", () => ({
  getApiClient: () => ({}),
}));

vi.mock("./registry", () => ({ disposeTerminal: vi.fn() }));

const toasted = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: toasted }));

const confirm = vi.hoisted(() =>
  vi.fn(async (_message: string, _title?: string): Promise<boolean> => true),
);
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({ dialogs: { confirm } }),
}));

import {
  closeFocusedTerminal,
  closeTerminalPane,
  closeTerminalTab,
  flushPendingCloses,
  hasPendingClose,
  removeWorkspaceAndTerminals,
  undoCloseTerminal,
  UNDO_CLOSE_TIMEOUT_MS,
} from "./close";
import { useReviewStore } from "../../stores";
import { collectLeafIds, makeTab, splitLeaf } from "./pane-tree";
import { attachment, terminalStatus, workspace } from "../../test/fixtures";

const REMOVED: string[] = [];
const CASCADED: boolean[] = [];

// A close holds its shell for the undo window before anything reaches the
// daemon; `lapse` is that window going by.
beforeEach(() => {
  vi.useFakeTimers();
  toasted.mockClear();
});
afterEach(async () => {
  await vi.runAllTimersAsync();
  vi.useRealTimers();
});

async function lapse(): Promise<void> {
  await vi.advanceTimersByTimeAsync(UNDO_CLOSE_TIMEOUT_MS);
}

function session(id: string, workspaceId: string | null): TerminalSessionInfo {
  return {
    id,
    repoPath: "/repo",
    workspaceId,
    cwd: "/repo",
    title: null,
    cols: 80,
    rows: 24,
    status: {
      id,
      phase: "idle",
      runningCommand: null,
      lastExitCode: null,
      cwd: "/repo",
      title: null,
      enteredStateAt: 0,
      shellIntegrationActive: false,
      attentionMessage: null,
    },
  };
}

/**
 * One workspace holding `sessions`, with the store's kill wired to drop the
 * session the way `killTerminal` does.
 */
function seed(
  overrides: { title?: string | null; attachments?: Attachment[] },
  sessionIds: string[],
): void {
  REMOVED.length = 0;
  CASCADED.length = 0;
  confirm.mockClear();
  confirm.mockResolvedValue(true);
  const item = workspace("ws-1", {
    title: overrides.title ?? null,
    attachments: overrides.attachments ?? [attachment("/repo", "main")],
  });
  const sessions: Record<string, TerminalSessionInfo> = {};
  for (const id of sessionIds) sessions[id] = session(id, "ws-1");

  useReviewStore.setState({
    workspaces: [item],
    terminalSessions: sessions,
    terminalStatuses: {},
    terminalExited: {},
    killTerminal: async (id: string) => {
      const next = { ...useReviewStore.getState().terminalSessions };
      delete next[id];
      useReviewStore.setState({ terminalSessions: next });
    },
    removeWorkspace: async (id: string, cascade?: boolean) => {
      REMOVED.push(id);
      CASCADED.push(Boolean(cascade));
      useReviewStore.setState({
        workspaces: useReviewStore
          .getState()
          .workspaces.filter((entry) => entry.id !== id),
      });
    },
  });
}

/**
 * `seed`, plus a workspace nested under ws-1 with its own terminal — the
 * shape `chooseRemovalScope` exists for.
 */
function seedNested(childSessionIds: string[] = ["t2"]): void {
  seed({ title: "the migration" }, ["t1"]);
  const child = workspace("ws-2", { parentId: "ws-1", title: "sub-task" });
  const sessions = { ...useReviewStore.getState().terminalSessions };
  for (const id of childSessionIds) sessions[id] = session(id, "ws-2");
  useReviewStore.setState({
    workspaces: [...useReviewStore.getState().workspaces, child],
    terminalSessions: sessions,
  });
}

describe("closing the last terminal in a workspace", () => {
  beforeEach(() => {
    useReviewStore.setState({ focusedWorkspaceId: null });
  });

  it("drops a workspace nobody named or built out", async () => {
    seed({}, ["t1"]);
    await closeTerminalPane("t1");
    await lapse();
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("drops one with no attachment at all", async () => {
    seed({ attachments: [] }, ["t1"]);
    await closeTerminalPane("t1");
    await lapse();
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("keeps one the user named", async () => {
    seed({ title: "the migration" }, ["t1"]);
    await closeTerminalPane("t1");
    await lapse();
    expect(REMOVED).toEqual([]);
  });

  it("keeps one showing more than one repo", async () => {
    seed({ attachments: [attachment("/repo"), attachment("/other")] }, ["t1"]);
    await closeTerminalPane("t1");
    await lapse();
    expect(REMOVED).toEqual([]);
  });

  it("does not wait for the teardown to reach the store", async () => {
    // The reap answers from the ids it is closing, not from whether
    // `killTerminal` happened to drop its session first — so a kill that
    // resolves without touching the map reaps exactly the same.
    seed({}, ["t1"]);
    useReviewStore.setState({ killTerminal: async () => {} });
    await closeTerminalPane("t1");
    await lapse();
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("keeps one that still has a terminal running", async () => {
    seed({}, ["t1", "t2"]);
    await closeTerminalPane("t1");
    await lapse();
    expect(REMOVED).toEqual([]);

    // ...and goes once the second one closes too.
    await closeTerminalPane("t2");
    await lapse();
    expect(REMOVED).toEqual(["ws-1"]);
  });
});

/**
 * ⌘W's target, which is the whole of what made it unreliable: it used to be
 * `document.activeElement` and nothing else, so every click on a tab, a
 * sidebar row, or any chrome that isn't focusable sent the keystroke past the
 * terminal — on to the file, or with nothing else open, the window.
 */
describe("⌘W picks a terminal", () => {
  const KILLED: string[] = [];

  /** One workspace showing one tab, with the keyboard parked on `body`. */
  function panel(overrides: Record<string, unknown> = {}): void {
    KILLED.length = 0;
    document.body.innerHTML = "";
    confirm.mockClear();
    confirm.mockResolvedValue(true);
    useReviewStore.setState({
      workspaces: [workspace("ws-1", { title: "kept" })],
      focusedWorkspaceId: "ws-1",
      terminalTabs: [makeTab("tab-1", "t1")],
      activeTabId: "tab-1",
      contentFocus: "terminal",
      terminalOverview: false,
      terminalSessions: { t1: session("t1", "ws-1") },
      terminalStatuses: {},
      terminalExited: {},
      killTerminal: async (id: string) => {
        KILLED.push(id);
      },
      removeWorkspace: async () => {},
      ...overrides,
    });
  }

  /** Put the keyboard inside an element carrying `attribute`. */
  function focusIn(attribute: string, value = ""): void {
    const host = document.createElement("div");
    host.setAttribute(attribute, value);
    const focusable = document.createElement("button");
    host.append(focusable);
    document.body.append(host);
    focusable.focus();
  }

  it("closes the pane that has the keyboard", async () => {
    // Even with the code holding the content region: a shell you are typing in
    // is the shell ⌘W means.
    panel({ contentFocus: "code" });
    focusIn("data-terminal-id", "t1");
    expect(await closeFocusedTerminal()).toBe(true);
    await lapse();
    expect(KILLED).toEqual(["t1"]);
  });

  it("closes the pane the panel is showing when focus is nowhere", async () => {
    // The caret is on `body` — after a dialog, after the palette, after any
    // click that didn't land on something focusable. This closed the window.
    panel();
    expect(await closeFocusedTerminal()).toBe(true);
    await lapse();
    expect(KILLED).toEqual(["t1"]);
  });

  it("closes it with focus off in the sidebar too", async () => {
    panel();
    focusIn("data-sidebar");
    expect(await closeFocusedTerminal()).toBe(true);
    await lapse();
    expect(KILLED).toEqual(["t1"]);
  });

  it("declines to the code surface, which owns the file ⌘W closes", async () => {
    panel({ contentFocus: "code" });
    expect(await closeFocusedTerminal()).toBe(false);
    expect(KILLED).toEqual([]);
  });

  it("declines in the shared view when focus is outside the panel", async () => {
    // Both halves are on screen, so layout can't say which one ⌘W means and
    // focus arbitrates.
    panel({ contentFocus: "split" });
    focusIn("data-sidebar");
    expect(await closeFocusedTerminal()).toBe(false);
    expect(KILLED).toEqual([]);
  });

  it("takes it in the shared view when focus is on the panel's chrome", async () => {
    panel({ contentFocus: "split" });
    focusIn("data-terminal-panel");
    expect(await closeFocusedTerminal()).toBe(true);
    await lapse();
    expect(KILLED).toEqual(["t1"]);
  });

  it("declines while the overview is up, where every tab is on screen", async () => {
    panel({ terminalOverview: true });
    expect(await closeFocusedTerminal()).toBe(false);
    expect(KILLED).toEqual([]);
  });

  it("declines when the active tab is another workspace's", async () => {
    // The strip filtered it out, so the panel is drawing nothing — closing it
    // would kill a terminal that is not on screen.
    panel({ focusedWorkspaceId: "ws-2" });
    expect(await closeFocusedTerminal()).toBe(false);
    expect(KILLED).toEqual([]);
  });

  it("declines with no tab at all", async () => {
    panel({ activeTabId: null });
    expect(await closeFocusedTerminal()).toBe(false);
    expect(KILLED).toEqual([]);
  });
});

describe("asking before killing a busy shell", () => {
  beforeEach(() => seed({ title: "kept" }, ["t1"]));

  const status = (overrides: Partial<ReturnType<typeof terminalStatus>>) =>
    useReviewStore.setState({
      terminalStatuses: {
        t1: terminalStatus("idle", { id: "t1", ...overrides }),
      },
    });

  it("says nothing about a shell at its prompt", async () => {
    status({ phase: "waiting_for_input" });
    expect(await closeTerminalPane("t1")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("names the command when there is one", async () => {
    status({ phase: "working", runningCommand: "npm test", title: "zsh" });
    await closeTerminalPane("t1");
    expect(confirm.mock.calls[0][0]).toContain("zsh is running `npm test`");
  });

  it("still asks when the phase says working and nothing named it", async () => {
    // `ps` didn't resolve the process group, or the poller hasn't run yet.
    // This used to close in silence.
    status({ phase: "working" });
    await closeTerminalPane("t1");
    expect(confirm.mock.calls[0][0]).toContain("shell is still working");
  });

  it("does not ask on a bare bell, which zsh rings at every completion", async () => {
    status({ phase: "needs_attention" });
    expect(await closeTerminalPane("t1")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("leaves the terminal alone when the answer is no", async () => {
    status({ phase: "working", runningCommand: "npm test" });
    confirm.mockResolvedValue(false);
    expect(await closeTerminalPane("t1")).toBe(false);
    expect(useReviewStore.getState().terminalSessions.t1).toBeDefined();
  });

  it("says nothing about a session that has already exited", async () => {
    status({ phase: "working", runningCommand: "npm test" });
    useReviewStore.setState({ terminalExited: { t1: 0 } });
    expect(await closeTerminalPane("t1")).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe("removing a workspace", () => {
  it("kills the terminals in it", async () => {
    seed({ title: "the migration" }, ["t1", "t2"]);
    // A workspace with someone's title on it — the reap never touches this
    // one, so what removes it is the removal itself.
    expect(await removeWorkspaceAndTerminals("ws-1")).toBe(true);
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([]);
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("asks first, naming what is running", async () => {
    seed({ title: "the migration" }, ["t1"]);
    useReviewStore.setState({
      terminalStatuses: {
        t1: { runningCommand: "npm test", title: "claude" } as never,
      },
    });
    await removeWorkspaceAndTerminals("ws-1");
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm.mock.calls[0][0]).toContain("claude is running `npm test`");
    expect(confirm.mock.calls[0][0]).toContain("its terminal");
  });

  it("keeps everything when the answer is no", async () => {
    seed({ title: "the migration" }, ["t1"]);
    confirm.mockResolvedValue(false);
    expect(await removeWorkspaceAndTerminals("ws-1")).toBe(false);
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([
      "t1",
    ]);
    expect(REMOVED).toEqual([]);
  });

  it("does not ask when there is nothing live to lose", async () => {
    seed({ title: "the migration" }, []);
    await removeWorkspaceAndTerminals("ws-1");
    expect(confirm).not.toHaveBeenCalled();
    expect(REMOVED).toEqual(["ws-1"]);

    // ...nor for panes whose shell has already exited.
    seed({ title: "the migration" }, ["t1"]);
    useReviewStore.setState({ terminalExited: { t1: {} as never } });
    await removeWorkspaceAndTerminals("ws-1");
    expect(confirm).not.toHaveBeenCalled();
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("leaves another workspace's terminals alone", async () => {
    seed({ title: "the migration" }, ["t1", "t2"]);
    useReviewStore.setState({
      terminalSessions: {
        ...useReviewStore.getState().terminalSessions,
        t3: session("t3", "ws-2"),
      },
    });
    await removeWorkspaceAndTerminals("ws-1");
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([
      "t3",
    ]);
  });
});

describe("removing a workspace with nested children", () => {
  it("cascades to the nested workspaces when asked to remove them", async () => {
    seedNested();
    // Both dialogs default to "yes": take the nested workspaces too, then
    // confirm killing the terminals that go with them.
    expect(await removeWorkspaceAndTerminals("ws-1")).toBe(true);
    expect(REMOVED).toEqual(["ws-1"]);
    expect(CASCADED).toEqual([true]);
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([]);
  });

  it("keeps the nested workspaces when asked to, removing this one alone", async () => {
    seedNested();
    // Decline "remove all"; the follow-up "remove this one alone?" and the
    // terminal-kill confirmation both default to "yes".
    confirm.mockResolvedValueOnce(false);
    expect(await removeWorkspaceAndTerminals("ws-1")).toBe(true);
    expect(REMOVED).toEqual(["ws-1"]);
    expect(CASCADED).toEqual([false]);
    // ws-2 was never asked about beyond staying in the queue, so its own
    // terminal is never touched.
    expect(Object.keys(useReviewStore.getState().terminalSessions)).toEqual([
      "t2",
    ]);
  });

  it("cancels the whole removal when both nested-workspace questions are declined", async () => {
    seedNested();
    confirm.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    expect(await removeWorkspaceAndTerminals("ws-1")).toBe(false);
    expect(REMOVED).toEqual([]);
    expect(
      Object.keys(useReviewStore.getState().terminalSessions).sort(),
    ).toEqual(["t1", "t2"]);
  });
});

/**
 * A close leaves the screen at once but holds its shell for a few seconds, so
 * the one you didn't mean can come back exactly as it was — Ghostty's undo
 * window, on the browser's reopen-tab chord.
 */
describe("undoing a close", () => {
  const KILLED: string[] = [];

  function panel(tabs = [makeTab("tab-1", "t1")]): void {
    KILLED.length = 0;
    confirm.mockClear();
    confirm.mockResolvedValue(true);
    const sessions: Record<string, TerminalSessionInfo> = {};
    for (const tab of tabs) {
      for (const id of collectLeafIds(tab.root))
        sessions[id] = session(id, "ws-1");
    }
    useReviewStore.setState({
      workspaces: [workspace("ws-1", { title: "kept" })],
      focusedWorkspaceId: "ws-1",
      terminalTabs: tabs,
      activeTabId: tabs[0]?.id ?? null,
      terminalSessions: sessions,
      terminalStatuses: {},
      terminalExited: {},
      killTerminal: async (id: string) => {
        KILLED.push(id);
        const next = { ...useReviewStore.getState().terminalSessions };
        delete next[id];
        useReviewStore.setState({ terminalSessions: next });
      },
      removeWorkspace: async () => {},
    });
  }

  const tabIds = () => useReviewStore.getState().terminalTabs.map((t) => t.id);

  /** One tab holding two panes side by side. */
  function splitTab(): TerminalTab {
    return {
      id: "tab-1",
      focused: "t1",
      root: {
        type: "split",
        direction: "row",
        children: [
          { type: "leaf", terminalId: "t1" },
          { type: "leaf", terminalId: "t2" },
        ],
        sizes: [0.5, 0.5],
      },
    };
  }

  it("takes the pane off the screen but keeps the shell", async () => {
    panel();
    await closeTerminalPane("t1");
    expect(tabIds()).toEqual([]);
    expect(KILLED).toEqual([]);
    expect(useReviewStore.getState().terminalSessions.t1).toBeDefined();
    expect(hasPendingClose()).toBe(true);
    expect(toasted).toHaveBeenCalledWith(
      "Closed terminal",
      expect.objectContaining({ action: expect.anything() }),
    );
  });

  it("kills it once the window lapses", async () => {
    panel();
    await closeTerminalPane("t1");
    await lapse();
    expect(KILLED).toEqual(["t1"]);
    expect(hasPendingClose()).toBe(false);
  });

  it("brings the tab back, unkilled, within the window", async () => {
    panel();
    await closeTerminalPane("t1");
    expect(undoCloseTerminal()).toBe(true);
    expect(tabIds()).toEqual(["tab-1"]);
    expect(useReviewStore.getState().activeTabId).toBe("tab-1");
    await lapse();
    expect(KILLED).toEqual([]);
  });

  it("has nothing to bring back once the window has lapsed", async () => {
    panel();
    await closeTerminalPane("t1");
    await lapse();
    expect(undoCloseTerminal()).toBe(false);
    expect(tabIds()).toEqual([]);
  });

  it("brings a closed split back as that split", async () => {
    const split = splitTab();
    panel([split]);
    await closeTerminalTab(split);
    expect(tabIds()).toEqual([]);
    expect(undoCloseTerminal()).toBe(true);
    const restored = useReviewStore.getState().terminalTabs;
    expect(restored.map((t) => collectLeafIds(t.root))).toEqual([["t1", "t2"]]);
  });

  it("puts a closed pane back in the split it was one of", async () => {
    panel([splitTab()]);
    await closeTerminalPane("t1");
    expect(
      useReviewStore.getState().terminalTabs.map((t) => collectLeafIds(t.root)),
    ).toEqual([["t2"]]);
    expect(undoCloseTerminal()).toBe(true);
    const back = useReviewStore.getState().terminalTabs;
    expect(back.map((t) => t.id)).toEqual(["tab-1"]);
    expect(collectLeafIds(back[0].root)).toEqual(["t1", "t2"]);
    expect(back[0].focused).toBe("t1");
    await lapse();
    expect(KILLED).toEqual([]);
  });

  it("keeps the tab's place in the strip when it merges back into it", async () => {
    panel([makeTab("tab-0", "t0"), splitTab(), makeTab("tab-2", "t3")]);
    await closeTerminalPane("t2");
    expect(undoCloseTerminal()).toBe(true);
    expect(tabIds()).toEqual(["tab-0", "tab-1", "tab-2"]);
  });

  it("keeps a pane that arrived after the close", async () => {
    panel([splitTab()]);
    await closeTerminalPane("t1");
    // A split opened in the thinned tab while the undo window was still open.
    useReviewStore.setState({
      terminalSessions: {
        ...useReviewStore.getState().terminalSessions,
        t9: session("t9", "ws-1"),
      },
      terminalTabs: useReviewStore.getState().terminalTabs.map((tab) => ({
        ...tab,
        root: splitLeaf(tab.root, "t2", "t9", "row"),
      })),
    });
    expect(undoCloseTerminal()).toBe(true);
    const back = useReviewStore.getState().terminalTabs;
    expect(back).toHaveLength(1);
    expect(collectLeafIds(back[0].root).sort()).toEqual(["t1", "t2", "t9"]);
  });

  it("kills the pane, and only it, once the window lapses", async () => {
    panel([splitTab()]);
    await closeTerminalPane("t1");
    await lapse();
    expect(KILLED).toEqual(["t1"]);
    expect(
      useReviewStore.getState().terminalTabs.map((t) => collectLeafIds(t.root)),
    ).toEqual([["t2"]]);
  });

  it("reopens the most recent close first", async () => {
    panel([makeTab("tab-1", "t1"), makeTab("tab-2", "t2")]);
    await closeTerminalPane("t1");
    await closeTerminalPane("t2");
    expect(undoCloseTerminal()).toBe(true);
    expect(tabIds()).toEqual(["tab-2"]);
    expect(undoCloseTerminal()).toBe(true);
    expect(tabIds()).toEqual(["tab-2", "tab-1"]);
  });

  it("does not hold a shell that already exited", async () => {
    panel();
    useReviewStore.setState({ terminalExited: { t1: 0 } });
    await closeTerminalPane("t1");
    expect(hasPendingClose()).toBe(false);
    expect(useReviewStore.getState().terminalSessions.t1).toBeUndefined();
  });

  it("goes through at once when the window is on its way out", async () => {
    panel();
    await closeTerminalPane("t1");
    await flushPendingCloses();
    expect(KILLED).toEqual(["t1"]);
    expect(hasPendingClose()).toBe(false);
  });

  it("is not offered while nothing is pending", () => {
    panel();
    expect(hasPendingClose()).toBe(false);
    expect(undoCloseTerminal()).toBe(false);
  });
});
