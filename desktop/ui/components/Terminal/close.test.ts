import { vi, describe, it, expect, beforeEach } from "vitest";
import type { Attachment, TerminalSessionInfo } from "../../types";

vi.mock("../../api", () => ({
  getApiClient: () => ({}),
}));

vi.mock("./registry", () => ({ disposeTerminal: vi.fn() }));

const confirm = vi.hoisted(() =>
  vi.fn(async (_message: string, _title?: string): Promise<boolean> => true),
);
vi.mock("../../platform", () => ({
  getPlatformServices: () => ({ dialogs: { confirm } }),
}));

import { closeFocusedTerminal, closeTerminalPane } from "./close";
import { useReviewStore } from "../../stores";
import { makeTab } from "./pane-tree";
import { attachment, terminalStatus, workspace } from "../../test/fixtures";

const REMOVED: string[] = [];

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
    removeWorkspace: async (id: string) => {
      REMOVED.push(id);
      useReviewStore.setState({
        workspaces: useReviewStore
          .getState()
          .workspaces.filter((entry) => entry.id !== id),
      });
    },
  });
}

describe("closing the last terminal in a workspace", () => {
  beforeEach(() => {
    useReviewStore.setState({ focusedWorkspaceId: null });
  });

  it("drops a workspace nobody named or built out", async () => {
    seed({}, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("drops one with no attachment at all", async () => {
    seed({ attachments: [] }, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("keeps one the user named", async () => {
    seed({ title: "the migration" }, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual([]);
  });

  it("keeps one showing more than one repo", async () => {
    seed({ attachments: [attachment("/repo"), attachment("/other")] }, ["t1"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual([]);
  });

  it("does not wait for the teardown to reach the store", async () => {
    // The reap answers from the ids it is closing, not from whether
    // `killTerminal` happened to drop its session first — so a kill that
    // resolves without touching the map reaps exactly the same.
    seed({}, ["t1"]);
    useReviewStore.setState({ killTerminal: async () => {} });
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual(["ws-1"]);
  });

  it("keeps one that still has a terminal running", async () => {
    seed({}, ["t1", "t2"]);
    await closeTerminalPane("t1");
    expect(REMOVED).toEqual([]);

    // ...and goes once the second one closes too.
    await closeTerminalPane("t2");
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
    expect(KILLED).toEqual(["t1"]);
  });

  it("closes the pane the panel is showing when focus is nowhere", async () => {
    // The caret is on `body` — after a dialog, after the palette, after any
    // click that didn't land on something focusable. This closed the window.
    panel();
    expect(await closeFocusedTerminal()).toBe(true);
    expect(KILLED).toEqual(["t1"]);
  });

  it("closes it with focus off in the sidebar too", async () => {
    panel();
    focusIn("data-sidebar");
    expect(await closeFocusedTerminal()).toBe(true);
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
  beforeEach(() => {
    confirm.mockClear().mockResolvedValue(true);
    seed({ title: "kept" }, ["t1"]);
  });

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
